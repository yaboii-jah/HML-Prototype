"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { accountingCommandAction } from "@/app/(workspace)/accounting/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Field } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { formatPhp, moneyCents } from "@/src/domain/projects/projects";
import { paymentIssues, type AccountingAction, type AccountingCommand } from "@/src/domain/purchasing/accounting";
import { PO_FIELDS, type PurchasingRecord, type PurchasingView } from "@/src/domain/purchasing/contracts";
import { businessDate } from "@/src/domain/business-dates";
import { php } from "@/src/domain/quotations/decimal";

const labels: Record<AccountingAction, string> = {
  submitPo: "Submit to Accounting", recallPo: "Recall PO", approvePo: "Approve PO",
  holdPo: "Hold PO", returnPo: "Return for correction", rejectPo: "Reject PO permanently",
  revokePo: "Revoke approval", reconfirmPo: "Confirm corrected MRF applicability", retryPoArchive: "Retry approved PDF archive",
};
type Input = Omit<AccountingCommand, "requestId">;
type Pending = { input: Input; basis: string };
const when = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });

export function PoAccountingPanel({ po, view }: { po: PurchasingRecord; view: PurchasingView }) {
  const live = useFoundationRealtime();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false), retry = useRef<{ key: string; id: string } | null>(null);
  const review = po.review;
  const quote = view.quotations.quotes.find((q) => q.id === po.quoteId);
  if (!review || !quote?.family) return null;
  const budget = review.budget;
  const basis = {
    mrfId: po.mrfId, targetId: po.id, expectedVersion: view.version, expectedDemand: view.demandVersion,
    expectedPoVersion: po.version, expectedProjectVersion: budget?.version || "0", expectedFamily: quote.family.version,
    expectedMrfArchive: quote.family.currentMrfArchiveId || "",
  };
  const basisKey = JSON.stringify(basis), stale = !!pending && pending.basis !== basisKey;
  const userId = live.session?.userId;
  const barred = !userId || review.preparerIds.includes(userId) || review.submitterIds.includes(userId);
  const today = businessDate();
  const termsIssues = paymentIssues(po.body.payment, po.body.fields.date, today);
  const gross = moneyCents(po.calculation?.gross), available = moneyCents(budget?.uncommitted);
  const insufficient = gross === null || available === null || gross > available;
  const approvalBlocked = barred || insufficient || !po.checked || !!po.blockers.length || !!termsIssues.length;
  const sendingLocked = po.issuance?.status === "prepared" || po.issuance?.status === "issued";
  const values = [
    ["Payment arrangement", `${po.body.payment?.mode || "Not recorded"}${po.body.payment?.mode === "credit" ? ` · due ${po.body.payment.dueDate}` : ""}`],
    ["Quoted payment terms", quote.body.paymentTerms || "Not recorded"],
    ["Terms review", po.body.payment?.relation === "matches" ? "Confirmed match" : po.body.payment?.relation === "differs" ? po.body.payment.reason : "Not recorded"],
    ["Budget scope", budget ? `${budget.projectName} / ${budget.scopeName}` : "Unavailable"],
    ["Scope allocation", formatPhp(budget?.allocation ?? null)],
    ["Committed gross", formatPhp(budget?.committed ?? null)],
    ["Gross spent", formatPhp(budget?.spent ?? null)],
    ["Uncommitted allocation", formatPhp(budget?.uncommitted ?? null)],
    ["This PO's gross budget charge", po.calculation ? php(po.calculation.gross) : "Unavailable"],
    ["Supplier net payable", po.calculation ? php(po.calculation.net) : "Unavailable"],
  ];
  const facts = <dl className="data-rows po-accounting-facts">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
  const open = (type: AccountingAction, archiveId?: string) => {
    setError("");
    setUncertain(false);
    retry.current = null;
    setPending({ input: { ...basis, type, reason: "", ...(archiveId ? { archiveId } : {}) }, basis: basisKey });
  };
  const act = async (replay = false) => {
    if (!pending || (!replay && stale) || running.current) return;
    const key = JSON.stringify(pending.input);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await accountingCommandAction({ ...pending.input, requestId: retry.current.id });
      if (result.ok) {
        setNotice(result.message);
        setUncertain(false);
        setPending(null);
        retry.current = null;
      } else {
        setError(result.message);
        setUncertain(!!result.uncertain);
      }
    } catch {
      setError("The response was interrupted. Retry this action to check its saved outcome.");
      setUncertain(true);
    } finally {
      running.current = false;
      setBusy(false);
      live.refresh();
    }
  };
  const button = (type: AccountingAction, disabled = false) => (
    <button type="button" className={`button ${type === "approvePo" || type === "submitPo" ? "primary" : "secondary"}`}
      disabled={busy || disabled} onClick={() => open(type)}>{labels[type]}</button>
  );
  return (
    <>
      <h3>Accounting review</h3>
      <p>Review status: <strong>{review.status}</strong>.</p>
      {facts}
      {notice && <p role="status">{notice}</p>}
      {review.status !== "approved" && termsIssues.length > 0 && <ul>{termsIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      {view.role === "Procurement" && po.state === "active" && (
        <div className="button-row">
          {["draft", "returned"].includes(review.status) && button("submitPo", !po.checked || !!po.blockers.length || !!termsIssues.length || !budget)}
          {["submitted", "held"].includes(review.status) && button("recallPo")}
        </div>
      )}
      {view.role === "Accounting" && ["submitted", "held"].includes(review.status) && (
        <>
          {barred && <p role="status">You prepared or submitted this PO. Another Accounting colleague must approve it.</p>}
          {insufficient && <p role="status">The PO gross exceeds the uncommitted allocation. Approval waits for sufficient budget.</p>}
          <div className="button-row">
            {button("approvePo", approvalBlocked)}
            {review.status !== "held" && button("holdPo")}
            {button("returnPo")}{button("rejectPo")}
          </div>
        </>
      )}
      {view.role === "Accounting" && review.status === "approved" && (
        <div className="button-row">
          {button("revokePo", sendingLocked)}
          {po.issuance?.status === "prepared" && <p>Procurement has prepared this PO to send. They must confirm sending or cancel with a Not sent declaration before revocation.</p>}
          {po.issuance?.status === "issued" && <p>This PO is issued. Approval cannot be revoked; order or financial corrections require the later workflow.</p>}
          {po.blockers.some((b) => b.includes("Accounting must reconfirm")) && button("reconfirmPo", barred || po.blockers.some((b) => b.includes("Procurement must reconfirm") || b.includes("withdrawn") || b.includes("unavailable")))}
        </div>
      )}
      {review.approvals.length > 0 && <>
        <h3>Retained approval versions</h3>
        {review.approvals.map((approval) => (
          <div key={approval.id} className="subform">
            <p><strong>Approval v{approval.version}</strong> · {approval.actor.name} · {when(approval.at)}{approval.id === review.approvalId ? " · Current" : " · Historical"}</p>
            <p>Approved PDF: {approval.archiveState || "Pending"}. {approval.message}</p>
            {approval.archiveState === "complete" && approval.archiveId && <Link className="text-link" target="_blank" href={`/api/approved-purchase-orders/${approval.archiveId}`}>Open approved PDF v{approval.version}</Link>}
            {view.role === "Accounting" && approval.archiveId && ["failed", "paused"].includes(approval.archiveState || "") && (
              <button type="button" className="button secondary" disabled={busy} onClick={() => open("retryPoArchive", approval.archiveId || undefined)}>Retry approved PDF v{approval.version}</button>
            )}
          </div>
        ))}
      </>}
      {review.events.length > 0 && <details><summary>Accounting decision history</summary>
        {review.events.map((event) => <p key={event.id}><strong>{labels[event.action as AccountingAction] || event.action}</strong> · {event.actor.name} ({event.actor.activeRole}) · {when(event.at)}{event.reason ? ` · ${event.reason}` : ""}</p>)}
      </details>}
      <RecordModal open={!!pending} title={pending ? labels[pending.input.type] : "PO review"} onClose={() => { if (!busy) setPending(null); }}>
        {pending && <>
          <p><strong>{po.ref}</strong> · {po.body.fields.vendorName}</p>
          {facts}
          <details open={stale}><summary>Current PO details and source</summary>
            <p>Quotation {quote.body.ref}, revision {quote.revision?.number}.</p>
            {po.body.lines.map((line) => <p key={line.id}>{view.quotations.request?.items.find((item) => item.id === line.itemId)?.name}: {line.quantity} requested; {line.offeredQuantity} offered.</p>)}
            <dl className="data-rows">{(Object.keys(PO_FIELDS) as (keyof typeof PO_FIELDS)[]).map((key) => <div key={key}><dt>{PO_FIELDS[key]}</dt><dd>{po.body.fields[key] || "Not recorded"}</dd></div>)}</dl>
          </details>
          {pending.input.type === "approvePo" && <p>Approval commits gross including VAT before EWT and queues its retained PDF. Supplier issuance is recorded separately.</p>}
          {pending.input.type === "revokePo" && <p>Release the commitment and return this PO for Procurement edits or cancellation. Demand remains allocated.</p>}
          {pending.input.type === "revokePo" && sendingLocked && <p role="status">Procurement prepared or issued this PO while the dialog was open. Revocation is unavailable. Review the Supplier issuance section.</p>}
          {pending.input.type === "rejectPo" && <p>This rejection is permanent. The numbered PO and history remain; its demand becomes available for sourcing.</p>}
          <Field label={["approvePo", "submitPo"].includes(pending.input.type) ? "Review note (optional)" : "Reason (at least five characters)"}>
            <textarea maxLength={2000} disabled={busy || uncertain} value={pending.input.reason} onChange={(e) => setPending({ ...pending, input: { ...pending.input, reason: e.target.value } })}/>
          </Field>
          {stale && <div role="status"><p>The PO, source, MRF or budget changed. Review the latest values above; your reason is preserved.</p>
            <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => { setPending({ input: { ...pending.input, ...basis }, basis: basisKey }); retry.current = null; setError(""); }}>I reviewed the latest values</button>
          </div>}
          {error && <p className="field-error" role="alert">{error}</p>}
          {uncertain && <button type="button" className="button secondary" disabled={busy} onClick={() => void act(true)}>Check saved outcome</button>}
          <div className="button-row"><button type="button" className="button primary"
            disabled={busy || uncertain || stale || (pending.input.type === "approvePo" && approvalBlocked) || (pending.input.type === "revokePo" && sendingLocked) || (!["submitPo", "approvePo"].includes(pending.input.type) && pending.input.reason.trim().length < 5)}
            onClick={() => void act()}>{busy ? "Saving…" : labels[pending.input.type]}</button></div>
        </>}
      </RecordModal>
    </>
  );
}
