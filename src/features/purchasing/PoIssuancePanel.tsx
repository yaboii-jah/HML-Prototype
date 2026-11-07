"use client";
import { useRef, useState } from "react";
import { issuanceCommandAction } from "@/app/(workspace)/purchase-orders/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Field } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { businessDate } from "@/src/domain/business-dates";
import { paymentIssues } from "@/src/domain/purchasing/accounting";
import type { PurchasingRecord, PurchasingView } from "@/src/domain/purchasing/contracts";
import {
  emptySendingDetails, parseSendingDetails, sendingTimeIssue,
  type IssuanceAction, type IssuanceCommand, type SendingDetails,
} from "@/src/domain/purchasing/issuance";

const labels: Record<IssuanceAction, string> = {
  prepareSend: "Prepare to send", cancelSend: "Cancel preparation",
  confirmSent: "Confirm sent", correctSent: "Correct sending details",
};
const channels = { email: "Email", chat: "Chat", physical: "Physical handover", other: "Other" };
const when = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const localTime = (value: string) => value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 19) : "";
const utcTime = (value: string) => {
  const parsed = new Date(`${value}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
};
type Input = Omit<IssuanceCommand, "requestId">;
type Pending = { input: Input; basis: string; declared: boolean };

function SendingFacts({ details }: { details: SendingDetails }) {
  return <dl className="data-rows po-accounting-facts">
    <div><dt>Sending channel</dt><dd>{details.channel ? channels[details.channel] : "Not recorded"}{details.channel === "other" ? ` — ${details.other}` : ""}</dd></div>
    <div><dt>Recipient name / contact</dt><dd>{details.recipient}</dd></div>
    <div><dt>Actually sent (Philippine time)</dt><dd>{when(details.sentAt)}</dd></div>
    {details.notes && <div><dt>Sending notes</dt><dd>{details.notes}</dd></div>}
  </dl>;
}

export function PoIssuancePanel({ po, view }: { po: PurchasingRecord; view: PurchasingView }) {
  const live = useFoundationRealtime();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false), retry = useRef<{ key: string; id: string } | null>(null);
  const state = po.issuance, review = po.review;
  const quote = view.quotations.quotes.find((q) => q.id === po.quoteId);
  if (!state || !review || !quote?.family) return null;
  const prep = state.preparation, issued = state.issuance;
  const basis = {
    mrfId: po.mrfId, targetId: po.id, expectedVersion: view.version, expectedDemand: view.demandVersion,
    expectedPoVersion: po.version, expectedProjectVersion: review.budget?.version || "0",
    expectedFamily: quote.family.version, expectedMrfArchive: quote.family.currentMrfArchiveId || "",
  };
  const basisKey = JSON.stringify(basis), stale = !!pending && pending.basis !== basisKey;
  const currentApproval = review.approvals.find((a) => a.id === review.approvalId);
  const termProblems = paymentIssues(po.body.payment, po.body.fields.date, businessDate());
  const canPrepare = review.status === "approved" && po.state === "active" && !po.blockers.length
    && !termProblems.length && currentApproval?.archiveState === "complete";
  const procurement = view.role === "Procurement";
  const open = (type: IssuanceAction) => {
    setError(""); setUncertain(false); retry.current = null;
    setPending({ basis: basisKey, declared: false, input: {
      ...basis, type, reason: "",
      ...(prep ? { preparationId: prep.id } : {}),
      ...(issued ? { issuanceId: issued.id } : {}),
      ...(["confirmSent", "correctSent"].includes(type) ? { details: issued ? { ...issued.details } : emptySendingDetails() } : {}),
      ...(type === "cancelSend" ? { notSent: true } : {}),
    } });
  };
  const act = async (replay = false) => {
    if (!pending || running.current || (!replay && stale)) return;
    const key = JSON.stringify(pending.input);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    running.current = true; setBusy(true); setError("");
    try {
      const result = await issuanceCommandAction({ ...pending.input, requestId: retry.current.id });
      if (result.ok) {
        setNotice(result.message); setUncertain(false); setPending(null); retry.current = null;
      } else { setError(result.message); setUncertain(!!result.uncertain); }
    } catch {
      setError("The response was interrupted. Check this request's saved outcome."); setUncertain(true);
    } finally {
      running.current = false; setBusy(false); live.refresh();
    }
  };
  const updateDetails = (patch: Partial<SendingDetails>) => {
    if (pending?.input.details) setPending({ ...pending, input: { ...pending.input, details: { ...pending.input.details, ...patch } } });
  };
  const details = pending?.input.details;
  const timeIssue = details && prep && details.sentAt ? sendingTimeIssue(details, prep.at,
    po.body.payment?.mode === "credit" ? po.body.payment.dueDate : null) : null;
  const invalid = !!pending && (pending.input.type === "prepareSend" && !canPrepare
    || ["cancelSend", "correctSent"].includes(pending.input.type) && pending.input.reason.trim().length < 5
    || !!details && (!parseSendingDetails(details) || !!timeIssue)
    || pending.input.type !== "prepareSend" && !pending.declared);
  const documents = prep && <div className="button-row">
    <a className="text-link" target="_blank" rel="noreferrer" href={`/api/approved-purchase-orders/${prep.poArchiveId}`}>Open checked approved PO</a>
    <a className="text-link" target="_blank" rel="noreferrer" href={`/api/mrf-documents/files/${prep.formId}`}>Open checked MRF</a>
    <a className="text-link" target="_blank" rel="noreferrer" href={`/api/mrf-documents/files/${prep.supportingId}`}>Open checked supporting PDF</a>
  </div>;
  return <>
    <h3>Supplier issuance</h3>
    <p>Sending status: <strong>{state.status === "issued" ? "Issued" : state.status === "prepared" ? "Prepared to send" : "Not issued"}</strong></p>
    {notice && <p role="status">{notice}</p>}
    {state.status === "notIssued" && <>
      <p>Prepare to send checks the current approved documents and locks this PO. Procurement sends them outside ConstructSync, then records Confirm sent here.</p>
      {!canPrepare && <p>Preparation needs an approved PO, complete approved archives, current source/MRF checks and valid payment terms.</p>}
      {termProblems.length > 0 && review.status === "approved" && <p>{termProblems.join(" ")} Ask Accounting to revoke approval for correction before sending.</p>}
      {procurement && <button type="button" className="button primary" disabled={busy || !canPrepare} onClick={() => open("prepareSend")}>Prepare to send</button>}
    </>}
    {prep && <>
      <p>Prepared by <strong>{prep.actor.name}</strong> · {when(prep.at)} Philippine time. Approval v{review.approvals.find((a) => a.id === prep.approvalId)?.version}.</p>
      {documents}
    </>}
    {state.status === "prepared" && <>
      <p>Send these checked documents externally, then confirm the actual sending time. Any Procurement colleague can finish this preparation. Accounting cannot revoke approval while it is open.</p>
      {(po.blockers.length > 0 || termProblems.length > 0) && <div role="status">
        <p><strong>Stop before sending.</strong> Prerequisites changed. If you have not sent the documents, cancel this preparation and resolve the blockers first. If you already sent them within the approved terms, record the actual event; unresolved blockers stay visible.</p>
        <ul>{[...po.blockers, ...termProblems].map((problem) => <li key={problem}>{problem}</li>)}</ul>
      </div>}
      {procurement && <div className="button-row">
        <button type="button" className="button primary" disabled={busy} onClick={() => open("confirmSent")}>Confirm sent</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => open("cancelSend")}>Cancel preparation</button>
      </div>}
    </>}
    {issued && <>
      <SendingFacts details={issued.details} />
      <p>Recorded by <strong>{issued.actor.name}</strong> · {when(issued.at)} Philippine time.</p>
      <p>Issued means sent, without supplier acknowledgement. This PO cannot be revoked or cancelled. Payment, delivery and stock progress are recorded in later workflows.</p>
      {!!po.blockers.length && <div role="status"><p><strong>Unresolved issuance blockers</strong> — escalate for the later correction workflow. There is no override.</p><ul>{po.blockers.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
      {procurement && <button type="button" className="button secondary" disabled={busy} onClick={() => open("correctSent")}>Correct sending details</button>}
    </>}
    {(issued || state.cancellations.length > 0) && <details><summary>Sending history</summary>
      {state.cancellations.map((c) => <p key={c.preparationId}>Prepared by {c.preparedBy.name} · {when(c.preparedAt)}. Cancelled as Not sent by {c.actor.name} · {when(c.at)} · {c.reason}</p>)}
      {issued && <><h4>Original sending declaration</h4><SendingFacts details={issued.originalDetails} />
        <p>{issued.actor.name} · recorded {when(issued.at)}</p>
        {!!issued.blockersAtRecording.length && <p>Blockers when recorded: {issued.blockersAtRecording.join("; ")}</p>}
      </>}
      {state.corrections.map((c) => <div key={c.id}><h4>Sending correction {c.version}</h4><p>{c.actor.name} · {when(c.at)} · {c.reason}</p><SendingFacts details={c.details} /></div>)}
    </details>}
    <RecordModal open={!!pending} title={pending ? labels[pending.input.type] : "Supplier issuance"} onClose={() => { if (!busy && !uncertain) setPending(null); }}>
      {pending && <>
        <p><strong>{po.ref}</strong> · {po.body.fields.vendorName}</p>
        <p>Approval v{currentApproval?.version || "—"}. {po.body.payment?.mode === "credit" ? `Credit due ${po.body.payment.dueDate}.` : "Upfront payment arrangement."}</p>
        {!!po.blockers.length && <ul>{po.blockers.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        {pending.input.type === "prepareSend" && <p>Check the current MRF, supporting PDF and exact approved PO in Drive. Once prepared, approval is locked until Procurement confirms sending or cancels with a Not sent declaration. Send externally only after preparation succeeds.</p>}
        {pending.input.type === "cancelSend" && <p>Cancel only if these documents have not been sent. If they were sent, record the actual event or escalate it; do not declare Not sent.</p>}
        {details && <>
          {pending.input.type === "correctSent" && <p>This appends a correction to sending details. The original stays in history. PO content, terms and money remain as approved.</p>}
          <div className="form-grid">
            <Field label="Sending channel"><select disabled={busy || uncertain} value={details.channel} onChange={(e) => updateDetails({ channel: e.target.value as SendingDetails["channel"] })}>
              <option value="">Choose channel</option>{Object.entries(channels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
            <Field label="Recipient name / contact"><input maxLength={500} disabled={busy || uncertain} value={details.recipient} onChange={(e) => updateDetails({ recipient: e.target.value })}/></Field>
            <Field label="Actually sent (Philippine date and time)" hint="Enter when you sent the documents, rather than when you record this form.">
              <input type="datetime-local" step="1" disabled={busy || uncertain} value={localTime(details.sentAt)} onChange={(e) => updateDetails({ sentAt: utcTime(e.target.value) })}/>
            </Field>
          </div>
          {details.channel === "other" && <Field label="Explain Other channel (at least five characters)"><textarea maxLength={2000} disabled={busy || uncertain} value={details.other} onChange={(e) => updateDetails({ other: e.target.value })}/></Field>}
          <Field label="Sending notes (optional)"><textarea maxLength={2000} disabled={busy || uncertain} value={details.notes} onChange={(e) => updateDetails({ notes: e.target.value })}/></Field>
          {timeIssue && <p className="field-error" role="alert">{timeIssue}</p>}
          {prep && <p>Preparation started {when(prep.at)} Philippine time. Sending before this preparation or after the approved Credit due date requires external escalation.</p>}
        </>}
        {["cancelSend", "correctSent"].includes(pending.input.type) && <Field label="Reason (at least five characters)"><textarea maxLength={2000} disabled={busy || uncertain} value={pending.input.reason} onChange={(e) => setPending({ ...pending, input: { ...pending.input, reason: e.target.value } })}/></Field>}
        {pending.input.type !== "prepareSend" && <label className="field"><span>
          <input type="checkbox" checked={pending.declared} disabled={busy || uncertain} onChange={(e) => setPending({ ...pending, declared: e.target.checked })}/>{" "}
          {pending.input.type === "cancelSend" ? "I confirm these documents have not been sent" : pending.input.type === "correctSent" ? "I confirm these corrected sending details are accurate" : "I confirm these checked documents were sent to this recipient"}
        </span></label>}
        {stale && <div role="status"><p>The PO, source, MRF or project changed. Review the latest values above. Your entries are preserved.</p><button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => { setPending({ ...pending, input: { ...pending.input, ...basis }, basis: basisKey }); retry.current = null; setError(""); }}>I reviewed the latest values</button></div>}
        {error && <p className="field-error" role="alert">{error}</p>}
        {uncertain && <button type="button" className="button secondary" disabled={busy} onClick={() => void act(true)}>Check saved outcome</button>}
        <div className="button-row"><button type="button" className="button primary" disabled={busy || uncertain || stale || invalid} onClick={() => void act()}>{busy ? pending.input.type === "prepareSend" ? "Checking documents…" : "Saving…" : labels[pending.input.type]}</button></div>
      </>}
    </RecordModal>
  </>;
}
