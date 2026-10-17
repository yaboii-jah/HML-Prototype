"use client";

import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { FileUpload } from "@/src/components/ui/FileUpload";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { auditTime } from "@/src/domain/audit";
import { money, today } from "@/src/domain/format";
import { archivedProof, externalPaymentLabel } from "@/src/domain/full-disbursement";
import { poTotal } from "@/src/domain/selectors";
import { releaseBlocker } from "@/src/domain/workflow";
import type { PO, Payment, PaymentProof } from "@/src/domain/types";
import { attachPaymentProofFiles, archivePaymentProof } from "./payment-proof-files";

export function ExternalPaymentVerification({ po }: { po: PO }) {
  const { snapshot: state, run, beginOperation } = useDemo();
  const { perform } = useArchive();
  const { confirm, confirmation } = useConfirmation();
  const { notify, update } = useActionFeedback();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reopening, setReopening] = useState(false);
  if (!state) return null;
  const accountant = state.role === "Accounting / Auditing";
  const editable = accountant && po.status === "approved" && !!po.issuance && !po.externalPayment;
  const proofs = po.paymentProofs || [], verified = po.externalPayment;
  const blocked = releaseBlocker(state, po);
  const archive = async (proof: PaymentProof, snapshot = state) => {
    await perform(`proof-${proof.id}`, `Payment proof: ${proof.name}`, async () => archivePaymentProof(snapshot, po.id, proof, await beginOperation({ kind: "payment-proof", poId: po.id, documentId: proof.id })), {kind:"payment-proof",poId:po.id,documentId:proof.id});
  };
  const attach = async (files: File[]) => {
    setBusy(true); setError("");
    const toast = notify({ tone: "progress", title: "Attaching and archiving payment proof…", detail: po.ref });
    try { const added = await attachPaymentProofFiles(state, po.id, files, run); for (const proof of added.proofs) await archive(proof, added.snapshot); update(toast, { tone: "success", title: "Payment proof attached and archived.", detail: `${added.proofs.length} file${added.proofs.length === 1 ? "" : "s"}` }); }
    catch (cause) { const text = cause instanceof Error ? cause.message : "Payment proof needs retry."; setError(text); update(toast, { tone: "error", title: text, detail: po.ref }); }
    finally { setBusy(false); }
  };
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (!await confirm("Confirm full external payment?", `${money(poTotal(state, po))} net supplier payable will be verified using the archived proof. Delivery clearance is a separate step.`, "Confirm full payment")) return;
    setBusy(true);
    const toast = notify({ tone: "progress", title: "Verifying the full external payment…", detail: po.ref });
    try { const result = await run({ type: "verifyExternalPayment", poId: po.id, method: String(data.get("method")) as Payment["method"], reference: String(data.get("reference") || ""), date: String(data.get("date")) }); setError(result.ok ? "" : result.message); update(toast, result.ok ? { tone: "success", title: "Full external payment verified.", detail: `${po.ref} · ${money(poTotal(state, po))}` } : { tone: "error", title: result.message, detail: po.ref }); }
    finally { setBusy(false); }
  };
  return <section className="panel external-payment-panel">
    <div className="panel-heading"><div><h2>External payment verification</h2><p className="helper-note">Finance processes payment outside ConstructSync. Accounting records proof and confirms the full net payable.</p></div><Badge>{externalPaymentLabel(po)}</Badge></div>
    {!po.issuance ? <p className="callout">Procurement must confirm supplier issuance before payment proof can be attached.</p> : <>
      <div className="payment-verification-summary"><div><small>NET PAYABLE AFTER EWT</small><strong>{money(poTotal(state, po))}</strong></div><div><small>SUPPLIER ISSUANCE</small><strong>{po.issuance.by.name}</strong><span>{auditTime(po.issuance.at)}</span></div></div>
      <h3 className="subheading">Payment proof</h3>
      {editable && <FileUpload label="Attach payment proof" hint="Drop PDFs or images here. Up to 12 files · 20 MB each · 45 MB total. Files are saved to the project archive." accept="application/pdf,image/jpeg,image/png,image/webp" busy={busy} onFiles={files => void attach(files)}/>}
      <div className="payment-proof-list">{proofs.map(proof => <div className="payment-proof-row qa-document-record" key={proof.id}><div><strong>{proof.name}</strong><small>{archivedProof(proof) ? "Archived" : proof.archive.error || "Archive pending"}</small></div><div className="button-row">{proof.archive.url && <a className="button secondary" href={proof.archive.url} target="_blank" rel="noreferrer">Open proof</a>}{editable && !archivedProof(proof) && <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await archive(proof); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); } finally { setBusy(false); } }}>Retry archive</button>}{editable && <button className="button danger-outline" disabled={busy} onClick={async () => { if (!await confirm("Remove payment proof?", "This attachment will be removed from the current verification. Archived copies and prior verification history remain available.", "Remove proof", true)) return; const result = await run({ type: "removePaymentProof", poId: po.id, documentId: proof.id }); setError(result.ok ? "" : result.message); }}>Remove</button>}</div></div>)}</div>
      {!proofs.length && <p className="helper-note">Attach at least one payment proof and complete its document archive before verification.</p>}
      {editable && <form className="form-stack subform" onSubmit={verify}><div className="form-grid"><Field label="Payment date"><input type="date" name="date" defaultValue={today()} required/></Field><Field label="Payment method"><select name="method" required><option value="">Choose method</option>{["Bank", "Check", "Cash", "Other"].map(method => <option key={method}>{method}</option>)}</select></Field><Field label="Payment reference"><input name="reference" required placeholder="Bank transaction or check reference"/></Field></div><button className="button primary" disabled={busy || !proofs.some(archivedProof)}>Confirm full payment</button></form>}
      {verified && <div className="subform"><h3>Full payment verified</h3><div className="data-rows"><div><span>Payment</span><strong>{money(verified.amount)} / {verified.method}</strong></div><div><span>Reference / date</span><strong>{verified.reference} / {verified.date}</strong></div><div><span>Verified by</span><strong>{verified.verifiedBy.name} / {auditTime(verified.verifiedAt)}</strong></div></div>{accountant && po.status === "approved" && <button className="button secondary" disabled={busy} onClick={() => setReopening(!reopening)}>Reopen verification</button>}{reopening && <form className="form-stack subform" onSubmit={async event => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || ""); if (!await confirm("Reopen payment verification?", "The payment status and delivery readiness will reset until Accounting verifies payment again. The original verification is retained.", "Reopen verification")) return; const result = await run({ type: "reopenPaymentVerification", poId: po.id, reason }); setError(result.ok ? "" : result.message); if (result.ok) { setReopening(false); notify({ tone: "warning", title: "Payment verification reopened.", detail: `${po.ref} · delivery clearance reset` }); } }}><Field label="Reason for reopening"><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={() => setReopening(false)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}</div>}
      {po.status === "approved" && <div className="subform"><h3>Delivery clearance</h3><p className="helper-note">{blocked || "Full payment is verified. Confirm clearance to let Logistics schedule delivery."}</p>{accountant && <button className="button primary" disabled={busy || !!blocked} onClick={async () => { if (!await confirm("Confirm delivery clearance?", "This PO will be released to Logistics. Payment verification and purchasing details will lock.", "Confirm delivery clearance")) return; const toast = notify({ tone: "progress", title: "Confirming delivery clearance…", detail: po.ref }); const result = await run({ type: "releasePO", id: po.id }); setError(result.ok ? "" : result.message); update(toast, result.ok ? { tone: "success", title: "Delivery clearance confirmed.", detail: `${po.ref} · released to Logistics` } : { tone: "error", title: result.message, detail: po.ref }); }}>Confirm delivery clearance</button>}</div>}
    </>}
    {!!po.verificationHistory?.length && <details className="subform"><summary>Previous verifications ({po.verificationHistory.length})</summary>{po.verificationHistory.map((value, index) => <div className="subform" key={`${value.verifiedAt}-${index}`}><strong>{money(value.amount)} / {value.reference}</strong><p className="helper-note">Verified by {value.verifiedBy.name} at {auditTime(value.verifiedAt)}. Reopened by {value.reopenedBy.name}: {value.reason}</p>{value.proofs.map(proof => <p key={proof.id}><a className="text-link" href={proof.archive.url} target="_blank" rel="noreferrer">{proof.name}</a></p>)}</div>)}</details>}
    {busy && <p className="helper-note" role="status">Working…</p>}<InlineError message={error}/>{confirmation}
  </section>;
}
