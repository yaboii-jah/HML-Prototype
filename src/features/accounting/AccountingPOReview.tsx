"use client";

import { isExternalPayment } from "@/src/domain/full-disbursement";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { revealField } from "@/src/components/ui/CollapsibleSection";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { budgetFor, quoteForPO, requestForPO } from "@/src/domain/selectors";
import { scopeBudgetFor, scopeName, scopeValidationError } from "@/src/domain/scope-budgets";
import { poFinancialBreakdown } from "@/src/domain/pricing";
import { money } from "@/src/domain/format";
import { initializePoDocument } from "@/src/domain/po-document";
import { releaseBlocker } from "@/src/domain/workflow";
import type { PO, POFinancial } from "@/src/domain/types";
import { PoDocumentFields, readPoDocument, readPoFinancial } from "@/src/features/purchase/PoDocumentFields";
import { PoContentsFields } from "@/src/features/purchase/PoContentsFields";
import { syncApprovedPO } from "@/src/features/requests/archive-purchasing";

export function AccountingPOReview({ po }: { po: PO }) {
  const { snapshot: state, run, beginOperation } = useDemo();
  const { perform, jobs } = useArchive();
  const { confirm, confirmation } = useConfirmation();
  const { notify, update, dismiss } = useActionFeedback();
  const formRef = useRef<HTMLFormElement>(null);
  const revealReviewError = () => {
    formRef.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(section => { section.open = true; });
    revealField(formRef.current?.querySelector<HTMLElement>("[name=financialReviewed]") || null);
  };
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"hold" | "return" | "reject" | null>(null);
  const [reviewed, setReviewed] = useState(po.financial?.reviewed || false);
  const [financialDraft, setFinancialDraft] = useState<POFinancial | null>(null);
  const [mode, setMode] = useState(po.paymentMode || "");
  const [contents, setContents] = useState<PO | null>(null);
  if (!state) return null;
  const request = requestForPO(state, po), quote = quoteForPO(state, po);
  if (!request || !quote) return null;
  const editable = state.role === "Accounting / Auditing" && ["submitted", "hold"].includes(po.status);
  const baseline = structuredClone(contents || po);
  if (!baseline.document || !baseline.financial) {
    initializePoDocument(baseline, request, quote, state.sites.find(site => site.id === request.siteId)!, po.createdAt);
    baseline.document = po.document || baseline.document;
    baseline.financial = po.financial || baseline.financial;
  }
  const adjustments = baseline.adjustments || [];
  const financial = financialDraft || baseline.financial!;
  const breakdown = poFinancialBreakdown({ ...baseline, financial, adjustments });
  const total = breakdown.net;
  const budget = budgetFor(state, request.siteId);
  const scopeBudget = scopeBudgetFor(state, request.scopeId || "");
  const scopeError = scopeValidationError(state, request.siteId, request.scopeId);
  const approvalBlocked = scopeError || (total > scopeBudget.available ? "This PO exceeds the available scope budget." : total > budget.available ? "This PO exceeds the available project budget." : "");
  const busy = jobs.some(job => job.id === `po-${po.id}` && job.phase !== "complete" && !job.error);
  const archive = async (snapshot = state, approved = po) => {
    try { const result = await perform(`po-${approved.id}`, `PO ${approved.ref}`, async progress => syncApprovedPO(snapshot, approved, await beginOperation({kind:"po",id:approved.id}), progress));
    setError(result.ok ? "" : result.message); } catch(cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const approve = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "approve";
    if (approve && !await confirm(`Approve ${po.ref}?`, "Accounting will commit the project budget and archive the PO. Purchasing and financial details will lock.", "Approve PO")) return;
    const toast = notify({ tone: "progress", title: approve ? `Approving ${po.ref}…` : "Saving the PO review…", detail: approve ? "Committing budget and archiving the approved PO" : undefined });
    const saved = await run({ type: "saveAccountingPO", id: po.id, paymentDueDate: String(form.get("paymentDueDate") || ""), paymentMode: mode as PO["paymentMode"], financial: readPoFinancial(form), adjustments, document: readPoDocument(form), lines: baseline.lines, supplierId: baseline.supplierId || quote.supplierId, notes: baseline.notes });
    if (!saved.ok) { setError(saved.message); revealReviewError(); update(toast, { tone: "error", title: saved.message, detail: po.ref }); return; }
    setError("");
    if (approve) {
      const result = await run({ type: "reviewPO", id: po.id, decision: "approve" });
      if (!result.ok) { setError(result.message); revealReviewError(); update(toast, { tone: "error", title: result.message, detail: po.ref }); return; }
      dismiss(toast);
      await archive(result.snapshot, result.snapshot.pos.find(value => value.id === po.id)!);
    } else update(toast, { tone: "success", title: "PO review saved.", detail: po.ref });
  };
  const decide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason"));
    if (!decision || !await confirm(`${decision === "return" ? "Return to Procurement" : decision === "hold" ? "Hold PO" : "Reject PO"}?`, "The reason will be recorded against this purchase order.", "Confirm decision", decision === "reject")) return;
    const toast = notify({ tone: "progress", title: decision === "return" ? "Returning to Procurement…" : decision === "hold" ? "Holding PO…" : "Rejecting PO…", detail: po.ref });
    const result = await run({ type: "reviewPO", id: po.id, decision, reason });
    setError(result.ok ? "" : result.message);
    update(toast, result.ok ? { tone: decision === "reject" ? "warning" : "success", title: result.message, detail: po.ref } : { tone: "error", title: result.message, detail: po.ref });
    if (result.ok) setDecision(null);
  };
  const blocked = releaseBlocker(state, po);
  return <section className="panel accounting-po-review"><div className="panel-heading"><h2>Accounting PO review</h2><Link className="text-link" href={`/purchase-orders/${po.id}`}>View supplier and materials →</Link></div>
    {po.reviewReason && <div className="callout warn"><strong>Review reason</strong><p>{po.reviewReason}</p></div>}
    {editable ? <>
      <p className="helper-note">Edit the PO directly or return it to Procurement. Confirm materials, document fields, taxes and charges before approval.</p>
      <form ref={formRef} className="form-stack accounting-po-form" onSubmit={save} onChange={event => { if ((!(event.target instanceof HTMLInputElement) || event.target.name !== "financialReviewed")) setReviewed(false); }}>
        <Field label="Payment arrangement"><select name="paymentMode" value={mode} onChange={event => setMode(event.target.value as typeof mode)} required><option value="">Choose payment arrangement</option><option value="upfront">Upfront — full disbursement before delivery</option><option value="credit">Credit / terms — delivery can proceed before payment</option></select></Field>
        {mode === "credit" && po.workflow === "pm-external-v1" && <Field label="Agreed payment due date" hint="Enter the date agreed with the supplier. Finance processes payment outside the app; delivery can proceed unpaid."><input type="date" name="paymentDueDate" defaultValue={po.paymentDueDate || ""} required/></Field>}
        <p className="helper-note">Supplier terms: {po.document?.terms || quote.terms || "Not entered"}</p>
        <PoDocumentFields key={baseline.supplierId || quote.supplierId} document={baseline.document!} financial={financial} reviewed={reviewed} onReview={setReviewed} onFinancialChange={setFinancialDraft} breakdown={breakdown} allowOverride initialCollapsed/>
        <PoContentsFields state={state} po={baseline} onChange={next => { setContents(next); setReviewed(false); }}/>
        <div className="data-rows"><div><span>Net supplier payable</span><strong>{money(total)}</strong></div>{po.paymentDueDate && <div><span>Payment due date</span><strong>{po.paymentDueDate}</strong></div>}<div><span>Available project budget</span><strong>{money(budget.available)}</strong></div></div>
        <div className="data-rows"><div><span>Scope of work</span><strong>{scopeName(state, request.scopeId)}</strong></div><div><span>Available scope budget</span><strong>{money(scopeBudget.available)}</strong></div></div>
        {approvalBlocked && <p className="callout bad" role="alert">{approvalBlocked}</p>}
        {total > budget.available && <p className="callout bad">Approval exceeds available budget by {money(total - budget.available)}.</p>}
        <div className="button-row"><button className="button secondary" value="save">Save PO review</button><button className="button primary" value="approve" disabled={!!approvalBlocked || busy}>Approve PO</button></div>
      </form>
      <div className="button-row subform"><button className="button secondary" onClick={() => setDecision("hold")}>Hold with reason</button><button className="button secondary" onClick={() => setDecision("return")}>Return to Procurement</button><button className="button danger-outline" onClick={() => setDecision("reject")}>Reject with reason</button></div>
      {decision && <form className="decision-panel" onSubmit={decide}><Field label={`${decision} reason`}><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={() => setDecision(null)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}
    </> : <div className="data-rows"><div><span>Payment arrangement</span><strong>{po.paymentMode === "credit" ? "Credit / terms" : po.paymentMode === "upfront" ? "Upfront" : "Awaiting Accounting review"}</strong></div>{po.paymentDueDate && <div><span>Payment due date</span><strong>{po.paymentDueDate}</strong></div>}<div><span>Available project budget</span><strong>{money(budget.available)}</strong></div><div><span>Scope of work</span><strong>{scopeName(state,request.scopeId)}</strong></div><div><span>Available scope budget</span><strong>{money(scopeBudget.available)}</strong></div></div>}
    {po.archive && <div className="subform"><div className="qa-archive-heading"><div className="button-row"><h3>Approved PO archive</h3><Badge value={po.archive.status === "complete" ? "Complete" : "Pending"}/></div><div className="button-row">{po.archive.url && <a className="button secondary" href={po.archive.url} target="_blank" rel="noreferrer">Open approved PO in Drive ↗</a>}{po.archive.status === "pending" && ["Accounting / Auditing", "Administrator"].includes(state.role) && <button className="button secondary" disabled={busy} onClick={() => void archive()}>{busy ? "Archiving…" : "Retry Drive archive"}</button>}</div></div>{po.archive.error && <p className="field-error" role="alert">{po.archive.error}</p>}</div>}
    {po.status === "approved" && !isExternalPayment(po) && <div className="subform"><h3>Release to Logistics</h3><p className="helper-note">{blocked || (po.paymentMode === "credit" ? "Credit terms allow delivery to proceed while Finance handles payment separately." : "Full disbursement is recorded. This PO is ready for delivery.")}</p>{state.role === "Accounting / Auditing" && <button className="button primary" disabled={!!blocked || busy} onClick={async () => { if (!await confirm(`Release ${po.ref} to Logistics?`, "Logistics will be able to schedule material delivery.", "Release to Logistics")) return; const toast = notify({ tone: "progress", title: "Releasing to Logistics…", detail: po.ref }); const result = await run({ type: "releasePO", id: po.id }); setError(result.ok ? "" : result.message); update(toast, result.ok ? { tone: "success", title: "Released to Logistics.", detail: `${po.ref} · delivery can be scheduled` } : { tone: "error", title: result.message, detail: po.ref }); }}>Release to Logistics</button>}</div>}
    <InlineError message={error}/>{confirmation}
  </section>;
}
