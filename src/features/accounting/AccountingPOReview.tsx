"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { budgetFor, poTotal, quoteForPO, requestForPO } from "@/src/domain/selectors";
import { money } from "@/src/domain/format";
import { initializePoDocument } from "@/src/domain/po-document";
import { releaseBlocker } from "@/src/domain/workflow";
import type { PO, POAdjustment, POFinancial } from "@/src/domain/types";
import { PoFinancialFields, readPoFinancial } from "@/src/features/purchase/PoDocumentFields";
import { syncApprovedPO } from "@/src/features/requests/archive-purchasing";

export function AccountingPOReview({ po }: { po: PO }) {
  const { snapshot: state, run } = useDemo();
  const { perform, jobs } = useArchive();
  const { confirm, confirmation } = useConfirmation();
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"hold" | "return" | "reject" | null>(null);
  const [reviewed, setReviewed] = useState(po.financial?.reviewed || false);
  const [financialDraft, setFinancialDraft] = useState<POFinancial | null>(null);
  const [mode, setMode] = useState(po.paymentMode || "");
  const [charges, setCharges] = useState<POAdjustment[] | null>(null);
  if (!state) return null;
  const request = requestForPO(state, po), quote = quoteForPO(state, po);
  if (!request || !quote) return null;
  const editable = state.role === "Accounting / Auditing" && ["submitted", "hold"].includes(po.status);
  const baseline = structuredClone(po);
  if (!baseline.document || !baseline.financial) {
    initializePoDocument(baseline, request, quote, state.sites.find(site => site.id === request.siteId)!, po.createdAt);
    baseline.document = po.document || baseline.document;
    baseline.financial = po.financial || baseline.financial;
  }
  const adjustments = charges || baseline.adjustments || [];
  const financial = financialDraft || baseline.financial!;
  const total = poTotal(state, { ...baseline, financial, adjustments });
  const budget = budgetFor(state, request.siteId);
  const busy = jobs.some(job => job.id === `po-${po.id}` && job.phase !== "complete" && !job.error);
  const archive = async (snapshot = state, approved = po) => {
    const result = await perform(`po-${approved.id}`, `PO ${approved.ref}`, progress => syncApprovedPO(snapshot, approved, run, progress));
    setError(result.ok ? "" : result.message);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const approve = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "approve";
    if (approve && !await confirm(`Approve ${po.ref}?`, "Accounting will commit the project budget and archive the PO. Purchasing and financial details will lock.", "Approve PO")) return;
    const saved = await run({ type: "saveAccountingPO", id: po.id, paymentMode: mode as PO["paymentMode"], financial: readPoFinancial(form), adjustments });
    if (!saved.ok) { setError(saved.message); return; }
    setError("");
    if (approve) {
      const result = await run({ type: "reviewPO", id: po.id, decision: "approve" });
      if (!result.ok) { setError(result.message); return; }
      await archive(result.snapshot, result.snapshot.pos.find(value => value.id === po.id)!);
    }
  };
  const decide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason"));
    if (!decision || !await confirm(`${decision === "return" ? "Return to Procurement" : decision === "hold" ? "Hold PO" : "Reject PO"}?`, "The reason will be recorded against this purchase order.", "Confirm decision", decision === "reject")) return;
    const result = await run({ type: "reviewPO", id: po.id, decision, reason });
    setError(result.ok ? "" : result.message);
    if (result.ok) setDecision(null);
  };
  const editCharge = (id: string, patch: Partial<POAdjustment>) => { setCharges(adjustments.map(value => value.id === id ? { ...value, ...patch } : value)); setReviewed(false); };
  const blocked = releaseBlocker(state, po);
  return <section className="panel accounting-po-review"><div className="panel-heading"><h2>Accounting PO review</h2><Link className="text-link" href={`/purchase-orders/${po.id}`}>View supplier and materials →</Link></div>
    {po.reviewReason && <div className="callout warn"><strong>Review reason</strong><p>{po.reviewReason}</p></div>}
    {editable ? <>
      <p className="helper-note">Confirm payment terms, taxes and charges. Return supplier or quantity corrections to Procurement.</p>
      <form className="form-stack accounting-po-form" onSubmit={save} onChange={event => { if ((!(event.target instanceof HTMLInputElement) || event.target.name !== "financialReviewed")) setReviewed(false); setFinancialDraft(readPoFinancial(new FormData(event.currentTarget))); }}>
        <Field label="Payment arrangement"><select name="paymentMode" value={mode} onChange={event => setMode(event.target.value as typeof mode)} required><option value="">Choose payment arrangement</option><option value="upfront">Upfront — full disbursement before delivery</option><option value="credit">Credit / terms — delivery can proceed before payment</option></select></Field>
        <p className="helper-note">Supplier terms: {po.document?.terms || quote.terms || "Not entered"}</p>
        <PoFinancialFields financial={baseline.financial!} reviewed={reviewed} onReview={setReviewed}/>
        <h3 className="subheading">PO charges and deductions</h3>
        {adjustments.map(value => <div className="po-adjustment-row" key={value.id}><Field label="Charge label"><input value={value.label} onChange={event => editCharge(value.id, { label: event.target.value, confirmed: false })} required/></Field><Field label="Type"><select value={value.kind} onChange={event => editCharge(value.id, { kind: event.target.value as POAdjustment["kind"], confirmed: false })}>{["shipping", "discount", "tax", "other"].map(kind => <option key={kind}>{kind}</option>)}</select></Field><Field label="Calculation"><select value={value.calculation} onChange={event => editCharge(value.id, { calculation: event.target.value as POAdjustment["calculation"], confirmed: false })}><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></Field><Field label="Amount"><input type="number" min="0" max={value.calculation === "percentage" ? 100 : undefined} step="0.01" value={value.value} onChange={event => editCharge(value.id, { value: Number(event.target.value), confirmed: false })}/></Field><label className="quote-check"><input type="checkbox" checked={value.included} onChange={event => editCharge(value.id, { included: event.target.checked, confirmed: false })}/> Include</label><label className="quote-check"><input type="checkbox" checked={value.taxable !== false} onChange={event => editCharge(value.id, { taxable: event.target.checked, confirmed: false })}/> Taxable</label><label className="quote-check"><input type="checkbox" checked={value.confirmed} onChange={event => editCharge(value.id, { confirmed: event.target.checked })}/> Confirm</label></div>)}
        <button type="button" className="button secondary" onClick={() => { setCharges([...adjustments, { id: crypto.randomUUID(), label: "", kind: "other", calculation: "fixed", value: 0, included: true, taxable: true, confirmed: false }]); setReviewed(false); }}>Add charge or deduction</button>
        <div className="data-rows"><div><span>Net supplier payable</span><strong>{money(total)}</strong></div><div><span>Available budget</span><strong>{money(budget.available)}</strong></div></div>
        {total > budget.available && <p className="callout bad">Approval exceeds available budget by {money(total - budget.available)}.</p>}
        <div className="button-row"><button className="button secondary" value="save">Save financial review</button><button className="button primary" value="approve" disabled={total > budget.available || busy}>Approve PO</button></div>
      </form>
      <div className="button-row subform"><button className="button secondary" onClick={() => setDecision("hold")}>Hold with reason</button><button className="button secondary" onClick={() => setDecision("return")}>Return to Procurement</button><button className="button danger-outline" onClick={() => setDecision("reject")}>Reject with reason</button></div>
      {decision && <form className="decision-panel" onSubmit={decide}><Field label={`${decision} reason`}><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={() => setDecision(null)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}
    </> : <div className="data-rows"><div><span>Payment arrangement</span><strong>{po.paymentMode === "credit" ? "Credit / terms" : po.paymentMode === "upfront" ? "Upfront" : "Awaiting Accounting review"}</strong></div><div><span>Available project budget</span><strong>{money(budget.available)}</strong></div></div>}
    {po.archive && <div className="subform"><h3>Approved PO archive</h3><Badge value={po.archive.status === "complete" ? "Complete" : "Pending"}/>{po.archive.url && <p><a className="text-link" href={po.archive.url} target="_blank" rel="noreferrer">Open approved PO in Drive ↗</a></p>}{po.archive.error && <p className="field-error" role="alert">{po.archive.error}</p>}{po.archive.status === "pending" && ["Accounting / Auditing", "Administrator"].includes(state.role) && <button className="button secondary" disabled={busy} onClick={() => void archive()}>{busy ? "Archiving…" : "Retry Drive archive"}</button>}</div>}
    {po.status === "approved" && <div className="subform"><h3>Release to Logistics</h3><p className="helper-note">{blocked || (po.paymentMode === "credit" ? "Credit terms allow delivery to proceed while Finance handles payment separately." : "Full disbursement is recorded. This PO is ready for delivery.")}</p>{state.role === "Accounting / Auditing" && <button className="button primary" disabled={!!blocked || busy} onClick={async () => { if (!await confirm(`Release ${po.ref} to Logistics?`, "Logistics will be able to schedule material delivery.", "Release to Logistics")) return; const result = await run({ type: "releasePO", id: po.id }); setError(result.ok ? "" : result.message); }}>Release to Logistics</button>}</div>}
    <InlineError message={error}/>{confirmation}
  </section>;
}
