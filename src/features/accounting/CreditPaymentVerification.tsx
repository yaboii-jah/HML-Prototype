"use client";

import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { BudgetInput } from "@/src/components/ui/BudgetInput";
import { parseBudgetInput } from "@/src/domain/budget-input";
import { archivedProof, proofAssigned } from "@/src/domain/full-disbursement";
import { creditBalance, creditOverdue, philippineDate } from "@/src/domain/credit-terms";
import { paidTotal, paymentStatus, poTotal } from "@/src/domain/selectors";
import { releaseBlocker } from "@/src/domain/workflow";
import { dateText, money } from "@/src/domain/format";
import { auditTime } from "@/src/domain/audit";
import { newId } from "@/src/domain/ids";
import type { PO, Payment, PaymentProof } from "@/src/domain/types";
import { attachPaymentProofFiles, archivePaymentProof } from "./payment-proof-files";

export function CreditPaymentVerification({ po }: { po: PO }) {
  const { snapshot: state, run, beginOperation } = useDemo(), { perform } = useArchive();
  const { confirm, confirmation } = useConfirmation();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [voiding, setVoiding] = useState<string | null>(null);
  const pending = useRef(false);
  if (!state) return null;
  const accountant = state.role === "Accounting / Auditing", balance = creditBalance(state, po);
  const eligible = !!po.issuance && ["approved", "released"].includes(po.status);
  const editable = accountant && eligible && balance > 0;
  const proofs = (po.paymentProofs || []).filter(proof => !proofAssigned(po, proof.id));
  const blocked = releaseBlocker(state, po), overdue = creditOverdue(state, po);
  const work = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The payment action could not finish. Try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  const archive = async (proof: PaymentProof, snapshot = state) => {
    await perform(`proof-${proof.id}`, `Payment proof: ${proof.name}`, async () => archivePaymentProof(snapshot, po.id, proof, await beginOperation({ kind: "payment-proof", poId: po.id, documentId: proof.id })));
  };
  const record = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form), amount = parseBudgetInput(String(data.get("amount") || ""));
    void work(async () => {
      if (!data.getAll("proofIds").length) throw new Error("Select archived proof belonging to this payment.");
      if (!await confirm("Verify external credit payment?", `${money(amount)} will be recorded against ${po.ref} using the selected archived proof. Delivery status stays unchanged.`, "Verify payment")) return;
      const result = await run({ type: "recordCreditPayment", paymentId: newId("credit-payment"), poId: po.id, amount, method: String(data.get("method")) as Payment["method"], reference: String(data.get("reference") || ""), date: String(data.get("date") || ""), proofIds: data.getAll("proofIds").map(String) });
      if (!result.ok) throw new Error(result.message);
      form.reset(); setMessage(result.message);
    });
  };
  return <section className="panel credit-payment-panel" aria-busy={busy}>
    <div className="panel-heading"><div><h2>Credit / terms payment</h2><p className="helper-note">Finance processes payments outside ConstructSync. Accounting verifies each payment with archived proof.</p></div><Badge value={paymentStatus(state, po)}/></div>
    <div className="metric-strip"><div><small>NET SUPPLIER PAYABLE</small><strong>{money(poTotal(state, po))}</strong></div><div><small>VERIFIED PAID</small><strong>{money(paidTotal(state, po.id))}</strong></div><div><small>OUTSTANDING BALANCE</small><strong>{money(balance)}</strong></div><div><small>PAYMENT DUE</small><strong>{dateText(po.paymentDueDate || "")}</strong>{overdue && <Badge value="hold">Overdue</Badge>}</div></div>
    {overdue && <p className="callout warn">Payment is overdue. Follow up on the remaining {money(balance)}. Delivery can continue.</p>}
    <div className="subform credit-delivery-clearance"><h3>Delivery clearance</h3><p className="helper-note">{po.status === "released" ? "Cleared for Logistics. Payment is tracked separately from receiving." : blocked || "Credit terms allow delivery before payment. Accounting can confirm clearance now."}</p>{accountant && po.status === "approved" && <button className="button primary" disabled={busy || !!blocked} onClick={() => void work(async () => { if (!await confirm("Clear credit delivery?", "Logistics can schedule delivery while payment remains outstanding. This does not record a payment.", "Confirm delivery clearance")) return; const result = await run({ type: "releasePO", id: po.id }); if (!result.ok) throw new Error(result.message); setMessage(result.message); })}>Confirm delivery clearance</button>}</div>
    {!po.issuance ? <p className="callout">Procurement must confirm supplier issuance before payment proof and payments can be recorded.</p> : <>
      {editable && <div className="proof-upload subform"><Field label="Attach proof for a payment" hint="PDF or images. Up to 12 unassigned files, 20 MB each and 45 MB total."><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) void work(async () => { const added = await attachPaymentProofFiles(state, po.id, files, run); for (const proof of added.proofs) await archive(proof, added.snapshot); }); }}/></Field></div>}
      {!!proofs.length && <div className="payment-proof-list"><h3>Unassigned payment proof</h3>{proofs.map(proof => <div className="payment-proof-row" key={proof.id}><div><strong>{proof.name}</strong><small>{archivedProof(proof) ? "Archived and ready to select" : proof.archive.error || "Archive pending"}</small></div><div className="button-row">{proof.archive.url && <a className="button secondary" href={proof.archive.url} target="_blank" rel="noreferrer">Open proof</a>}{accountant && eligible && !archivedProof(proof) && <button className="button secondary" disabled={busy} onClick={() => void work(() => archive(proof))}>Retry archive</button>}{accountant && eligible && <button className="button danger-outline" disabled={busy} onClick={() => void work(async () => { if (!await confirm("Remove unassigned proof?", "The attachment will be removed. Any archived Drive copy remains.", "Remove proof", true)) return; const result = await run({ type: "removePaymentProof", poId: po.id, documentId: proof.id }); if (!result.ok) throw new Error(result.message); })}>Remove</button>}</div></div>)}</div>}
      {editable && <form key={po.creditPayments?.length || 0} className="form-stack subform credit-payment-form" onSubmit={record}><h3>Verify an actual payment</h3><p className="helper-note">Record a partial payment or the full remaining balance after Finance processes it. Select proof belonging to this payment.</p><fieldset disabled={busy}><div className="form-grid"><Field label="Payment amount (PHP)"><BudgetInput name="amount" min={0.01} required/></Field><Field label="Payment method"><select name="method" required><option value="">Choose method</option>{["Bank", "Check", "Cash", "Other"].map(method => <option key={method}>{method}</option>)}</select></Field><Field label="Payment reference"><input name="reference" required/></Field><Field label="Actual payment date"><input name="date" type="date" required defaultValue={philippineDate()} max={philippineDate()}/></Field></div><div className="credit-proof-selection">{proofs.filter(archivedProof).map(proof => <label key={proof.id}><input name="proofIds" type="checkbox" value={proof.id}/><span>{proof.name}</span></label>)}</div></fieldset>{!proofs.some(archivedProof) && <p className="helper-note">Attach and archive payment proof to enable verification.</p>}<button className="button primary" disabled={busy || !proofs.some(archivedProof)}>Verify payment</button></form>}
    </>}
    {!!po.creditPayments?.length && <div className="subform credit-payment-history"><h3>Payment history</h3>{[...po.creditPayments].reverse().map(payment => <details key={payment.id} className="subform"><summary><strong>{money(payment.amount)} / {payment.reference}</strong><span>{payment.voided ? "Voided" : "Verified"} / {dateText(payment.date)}</span></summary><p>{payment.method} / verified by {payment.verifiedBy.name} / {auditTime(payment.verifiedAt)}</p>{payment.proofs.map(proof => <p key={proof.id}><a className="text-link" href={proof.archive.url} target="_blank" rel="noreferrer">{proof.name}</a></p>)}{payment.voided ? <p className="helper-note">Voided by {payment.voided.by.name} / {auditTime(payment.voided.at)} / {payment.voided.reason}</p> : accountant && eligible && <button className="button danger-outline" disabled={busy} onClick={() => setVoiding(voiding === payment.id ? null : payment.id)}>Void incorrect payment</button>}{voiding === payment.id && !payment.voided && <form className="form-stack subform" onSubmit={event => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || ""); void work(async () => { if (!await confirm("Void this payment?", "Its amount will return to the outstanding balance. Payment history, proof and delivery records remain intact.", "Void payment", true)) return; const result = await run({ type: "voidCreditPayment", poId: po.id, paymentId: payment.id, reason }); if (!result.ok) throw new Error(result.message); setVoiding(null); setMessage(result.message); }); }}><Field label="Correction reason"><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setVoiding(null)}>Cancel</button><button className="button danger-outline" disabled={busy}>Continue to confirmation</button></div></form>}</details>)}</div>}
    {message && <p className="helper-note" role="status">{message}</p>}{busy && <p className="helper-note" role="status">Processing payment action...</p>}<InlineError message={error}/>{confirmation}
  </section>;
}
