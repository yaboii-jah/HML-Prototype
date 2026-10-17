"use client";

import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { auditTime } from "@/src/domain/audit";
import { isExternalCredit, isExternalPayment } from "@/src/domain/full-disbursement";
import { procurementReady } from "@/src/domain/request-archive";
import { requestForPO } from "@/src/domain/selectors";
import type { PO } from "@/src/domain/types";

export function ProcurementIssuance({ po }: { po: PO }) {
  const { snapshot: state, run } = useDemo();
  const { confirm, confirmation } = useConfirmation();
  const { notify, update } = useActionFeedback();
  const [error, setError] = useState(""), [reopening, setReopening] = useState(false), [busy, setBusy] = useState(false);
  if (!state || !isExternalPayment(po)) return null;
  const editable = state.role === "Procurement" && po.status === "approved" && !po.issuance;
  const ready = procurementReady(requestForPO(state, po)) && po.archive?.status === "complete";
  return <section className="panel print-hide"><div className="panel-heading"><h2>Supplier issuance</h2><strong>{po.issuance ? "Served" : "Not issued"}</strong></div>
    {po.issuance ? <><p>Issued by {po.issuance.by.name} / {auditTime(po.issuance.at)}</p><p className="helper-note">{isExternalCredit(po) ? "Accounting can clear credit delivery while external payment is tracked separately. Issued purchasing details are locked." : "Accounting verifies the external payment before confirming delivery clearance. Issued purchasing details are locked."}</p></> : <><p className="helper-note">Send the Accounting-approved PO to the supplier, then confirm issuance here. This marks the PO Served.</p>{editable && <div className="button-row"><button className="button primary" disabled={!ready || busy} onClick={async () => { if (!await confirm(`Confirm ${po.ref} was issued?`, "Confirm that the approved PO has been sent to the supplier. Purchasing details will lock, and Accounting can verify external payment.", "Confirm issuance")) return; setBusy(true); try { const toast = notify({ tone: "progress", title: "Confirming supplier issuance…", detail: po.ref }); const result = await run({ type: "issuePO", id: po.id }); setError(result.ok ? "" : result.message); update(toast, result.ok ? { tone: "success", title: "Supplier issuance confirmed. PO is Served.", detail: `${po.ref} · Accounting can verify external payment` } : { tone: "error", title: result.message, detail: po.ref }); } finally { setBusy(false); } }}>Confirm supplier issuance</button><button className="button secondary" disabled={busy} onClick={() => setReopening(!reopening)}>Reopen for costing recheck</button></div>}{editable && !ready && <p className="helper-note">Complete the current MRF and approved PO document archives before issuance.</p>}</>}
    {reopening && editable && <form className="form-stack subform" onSubmit={async event => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || ""); if (!await confirm("Reopen approved PO?", "The previous approval stays in history. Budget commitment and archive readiness will reset until Accounting approves the revised PO.", "Reopen for recheck")) return; const toast = notify({ tone: "progress", title: "Reopening for costing recheck…", detail: po.ref }); const result = await run({ type: "reopenPOReview", id: po.id, reason }); setError(result.ok ? "" : result.message); update(toast, result.ok ? { tone: "warning", title: "PO reopened for costing recheck.", detail: `${po.ref} · budget commitment and archive reset` } : { tone: "error", title: result.message, detail: po.ref }); if (result.ok) setReopening(false); }}><Field label="Costing recheck reason"><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={() => setReopening(false)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}
    {!!po.approvalHistory?.length && <details className="subform"><summary>Previous approvals ({po.approvalHistory.length})</summary>{po.approvalHistory.map((value, index) => <div className="subform" key={index}><strong>{value.by?.name || "User not recorded"} / {auditTime(value.at)}</strong><p>{value.reason}</p>{value.archive?.url && <a className="text-link" href={value.archive.url} target="_blank" rel="noreferrer">Open previous approved PO</a>}</div>)}</details>}
    <InlineError message={error}/>{confirmation}
  </section>;
}
