"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mrfWorkflowAction } from "@/app/(workspace)/requests/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { mrfEditable, mrfStatusLabel, mrfUnderReview } from "@/src/domain/requests/workflow";
import type { MrfDraft, SavedMrf } from "@/src/domain/requests/drafts";
import { useDocuments } from "./MrfDocuments";

export function MrfReview({ saved, role, draft = saved.draft, expectedVersion = saved.version, disabled = false, onSubmitted, onPendingChange }: {
  saved: SavedMrf; role: string; draft?: MrfDraft; expectedVersion?: string; disabled?: boolean; onSubmitted?: () => void; onPendingChange?: (pending: boolean) => void;
}) {
  const { data, error: documentError } = useDocuments(`mrfId=${encodeURIComponent(saved.id)}`);
  const live = useFoundationRealtime(), router = useRouter();
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false), [reviewedVersion, setReviewedVersion] = useState(saved.version);
  const operation = useRef<Record<string, unknown> | null>(null), pending = useRef(false);
  useEffect(() => { onPendingChange?.(busy || uncertain); }, [busy, uncertain, onPendingChange]);
  const stale = reviewedVersion !== saved.version;
  const editable = role === "Site Personnel" && mrfEditable(saved);
  const reviewing = role === "Project Manager" && mrfUnderReview(saved);
  const reopening = role === "Procurement" && saved.procurementReady;
  const run = async (type: string, decision?: string) => {
    if (pending.current) return;
    if (!operation.current) {
      if (disabled || stale || type === "submitMrf" && !data?.current) return;
      operation.current = { type, requestId: crypto.randomUUID(), mrfId: saved.id, expectedVersion,
        ...(type === "submitMrf" ? { draft, attachmentRevision: data?.revision } : {}),
        ...(type === "reviewMrf" ? { decision, submissionId: saved.submissionId } : {}), reason };
    }
    pending.current = true;
    setBusy(true); setError("");
    try {
      const result = await mrfWorkflowAction(operation.current);
      if (result.ok) {
        operation.current = null; setUncertain(false); setReason("");
        setReviewedVersion(result.record.version);
        if (type === "submitMrf" && onSubmitted) onSubmitted();
        else router.refresh();
      } else {
        setError(result.message); setUncertain(!!result.uncertain);
        if (!result.uncertain) operation.current = null;
      }
    } catch {
      setUncertain(true); setError("The response was interrupted. Retry the same action before changing input.");
    } finally {
      pending.current = false; setBusy(false); live.refresh();
    }
  };
  const locked = busy || uncertain || disabled || stale;
  return <section className="panel" aria-labelledby="mrf-review-heading">
    <h2 id="mrf-review-heading">Submission and review</h2>
    <p role="status">{mrfStatusLabel(saved)}</p>
    {saved.submitted && <p>Submitted project: {saved.submitted.projectName} · {saved.submitted.projectLocation}</p>}
    {editable && <>
      <p>Submit a funded scope, complete material requirements and one verified supporting PDF. Printed names remain separate from the people submitting and reviewing.</p>
      <p>PDF for submission: {data?.current?.name ?? "No validated supporting PDF"}</p>
      {!!data?.uploads.length && <p role="status">Finish or cancel unfinished uploads before submitting.</p>}
      <button type="button" className="button primary" disabled={locked || !data?.current || !!data.uploads.length} onClick={() => void run("submitMrf")}>Save and submit</button>
    </>}
    {(reviewing || reopening) && <Field label={reopening ? "Correction reason" : "Reason for return or rejection"}>
      <textarea value={reason} minLength={5} maxLength={4000} disabled={busy || uncertain} onChange={event => setReason(event.target.value)} />
    </Field>}
    {reviewing && <div className="form-actions">
      <button type="button" className="button primary" disabled={locked} onClick={() => void run("reviewMrf", "approve")}>Approve MRF</button>
      <button type="button" className="button secondary" disabled={locked || reason.trim().length < 5} onClick={() => void run("reviewMrf", "return")}>Return for changes</button>
      {!saved.correctionKind && <button type="button" className="button secondary" disabled={locked || reason.trim().length < 5} onClick={() => void run("reviewMrf", "reject")}>Reject MRF</button>}
    </div>}
    {reopening && <button type="button" className="button secondary" disabled={locked || reason.trim().length < 5} onClick={() => void run("openCorrection")}>Open correction</button>}
    {saved.status === "approved" && <p>{saved.procurementReady ? "Current approved archive complete." : saved.correctionKind ? "Procurement is paused during correction." : "Approval recorded. Procurement waits for the approved PDF pair to finish archiving."}</p>}
    {stale && !uncertain && <div role="status"><p>The request changed. Review its current form, PDF and history before continuing.</p><button type="button" className="button secondary" onClick={() => { setReviewedVersion(saved.version); setError(""); }}>I reviewed the current request</button></div>}
    {busy && <p role="status">Recording action…</p>}
    <InlineError message={error || documentError} />
    {uncertain && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(String(operation.current?.type))}>Retry same MRF action</button>}
    <h3>Review history</h3>
    {saved.history.length ? <ol>{saved.history.map(event => <li key={event.id}>
      <p><strong>{event.action.replaceAll("_", " ")}</strong> · {event.actorName} ({event.actorRole}) · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time></p>
      {event.reason && <p>{event.reason}</p>}
    </li>)}</ol> : <p>No submissions or review decisions yet.</p>}
  </section>;
}
