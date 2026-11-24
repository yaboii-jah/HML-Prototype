"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InlineError } from "@/src/components/ui/Primitives";
import { record } from "@/src/domain/projects/projects";
import { materialFields, type MrfDraft } from "@/src/domain/requests/drafts";
import { parseExtractionStatus, suggestionFields, type ExtractionStatus, type MrfProposal, type SuggestionField } from "@/src/domain/requests/extraction";

const messages: Record<string, string> = {
  limit: "Extraction supports PDFs up to 10 MB and 100 pages. Enter the MRF manually for this PDF.",
  "no-mrf": "No identifiable MRF form was found in this PDF. Enter the MRF manually.",
  "multiple-mrfs": "This PDF contains several distinct MRFs. Use a supporting PDF for one MRF or enter it manually.",
  empty: "The MRF pages have no readable draft suggestions. Enter the MRF manually.",
  source: "The verified PDF could not be read. Review the file or enter the MRF manually.",
  provider: "Extraction could not finish. Retry or enter the MRF manually.",
};

type Selection = { fields: Set<SuggestionField>; rows: Set<number> };
type Props = {
  mrfId: string; version: string; attachmentRevision: string; draft: MrfDraft; projectName: string;
  disabled: boolean; applied: boolean; labels: Record<SuggestionField | typeof materialFields[number] | "quantity" | "neededDate", string>;
  onChecking: (checking: boolean) => void;
  onApply: (proposal: MrfProposal, id: string, selection: Selection) => void;
};

export function MrfExtraction({ mrfId, version, attachmentRevision, draft, projectName, labels, disabled, applied, onChecking, onApply }: Props) {
  const [status, setStatus] = useState<ExtractionStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const retryOperation = useRef<{ key: string; id: string } | null>(null);
  const load = useCallback(async (command?: Record<string, unknown>) => {
    const ticket = ++sequence.current;
    const source = { mrfId, version, attachmentRevision };
    const url = "/api/mrf-extraction";
    try {
      const signal = AbortSignal.timeout(20_000);
      const response = command
        ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...source, ...command }), signal })
        : await fetch(`${url}?${new URLSearchParams(source)}`, { cache: "no-store", signal });
      const data: unknown = await response.json();
      if (ticket !== sequence.current) return null;
      if ([401, 403].includes(response.status)) setStatus({ state: "disabled" });
      const parsed = parseExtractionStatus(data);
      if (!response.ok || !parsed) throw Error(String(record(data)?.error ?? "Extraction status could not be read."));
      setStatus(parsed);
      setError("");
      return parsed;
    } catch (problem) {
      if (ticket === sequence.current) setError(problem instanceof Error ? problem.message : "Check extraction status again.");
      return null;
    }
  }, [mrfId, version, attachmentRevision]);

  useEffect(() => {
    const invalidate = () => { sequence.current++; };
    queueMicrotask(() => void load());
    return invalidate;
  }, [load]);
  const processing = status?.state === "pending" || status?.state === "running";
  const ready = status?.state === "ready";
  useEffect(() => {
    if (!processing && !ready) return;
    const timer = setInterval(() => {
      if (!pending.current && document.visibilityState === "visible") void load();
    }, processing ? 4000 : 15000);
    return () => clearInterval(timer);
  }, [load, processing, ready]);

  const run = async (action: "start" | "retry" | "apply", selection?: Selection) => {
    if (pending.current || disabled || applied) return;
    pending.current = true;
    setBusy(true);
    if (action === "apply") onChecking(true);
    try {
      const key = `${action}:${status?.attemptId ?? ""}`;
      if (retryOperation.current?.key !== key) retryOperation.current = { key, id: crypto.randomUUID() };
      const response = await load({ type: action, operationId: retryOperation.current.id, proposalId: status?.id, attemptId: status?.attemptId });
      if (response) retryOperation.current = null;
      if (action === "apply" && selection && response?.proposal && status?.id && response.id === status.id) {
        onApply(response.proposal, response.id, selection);
      }
    } finally {
      pending.current = false;
      setBusy(false);
      if (action === "apply") onChecking(false);
    }
  };

  if (status?.state === "disabled") return null;
  const start = status?.state === "idle";
  const retry = status?.state === "failed" || status?.state === "expired";
  return <section className="mrf-extraction" aria-labelledby="mrf-extraction-heading">
    <h3 id="mrf-extraction-heading">PDF extraction</h3>
    <InlineError message={error} />
    {error && <div><button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>Check extraction status</button></div>}
    {applied ? <p role="status">Suggestions applied. Save the draft before submitting it for review.</p> : <>
      {start && <div><button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void run("start")}>Extract from supporting PDF</button></div>}
      {processing && <p role="status">Reading the supporting PDF. You can keep editing while extraction runs.</p>}
      {(status?.state === "failed" || status?.state === "unusable") && <p role="status">{messages[status.reason ?? "provider"] ?? messages.provider}</p>}
      {status?.state === "expired" && <p role="status">These suggestions expired. Run extraction again from the current PDF.</p>}
      {status?.state === "stale" && <p role="status">The draft or supporting PDF changed. Open the current version to extract again.</p>}
      {retry && <div><button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void run("retry")}>Retry extraction</button></div>}
      {ready && status.proposal && <ProposalReview key={status.id} proposal={status.proposal} draft={draft} projectName={projectName}
        labels={labels} disabled={disabled || busy} onApply={selection => void run("apply", selection)} />}
    </>}
  </section>;
}

function toggle<T>(previous: Set<T>, value: T) {
  const next = new Set(previous);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function ProposalReview({ proposal, draft, projectName, labels, disabled, onApply }: {
  proposal: MrfProposal; draft: MrfDraft; projectName: string; labels: Props["labels"]; disabled: boolean; onApply: (selection: Selection) => void;
}) {
  const [fields, setFields] = useState(new Set<SuggestionField>());
  const [rows, setRows] = useState(new Set<number>());
  const printedProject = proposal.details.projectName;
  const printedRef = proposal.details.sourceRef;
  const mismatch = printedProject.value && projectName && printedProject.value.toLowerCase() !== projectName.toLowerCase();
  const shown = (value: string | null) => value || "Blank";
  return <div className="mrf-extraction-review">
    <p>Compare suggestions with the PDF and choose the changes to apply. Selected materials are added to the draft.</p>
    {printedProject.value && <p className={mismatch ? "callout warn" : undefined}>
      PDF project (page {printedProject.page}): <strong>{printedProject.value}</strong>. Draft project: <strong>{projectName}</strong>.
      {mismatch && " Check that the PDF belongs to this project."}
    </p>}
    {printedRef.value && <p>Printed MRF number (page {printedRef.page}): <strong>{printedRef.value}</strong>.</p>}
    <fieldset disabled={disabled} className="mrf-extraction-options">
      <legend>Suggested changes</legend>
      {suggestionFields.filter(field => proposal.details[field].value).map(field => <label key={field} className="mrf-extraction-option">
        <input type="checkbox" checked={fields.has(field)} onChange={() => setFields(previous => toggle(previous, field))} />
        <span><strong>{labels[field]}</strong> · Page {proposal.details[field].page}<br />
          Current: {shown(draft[field])}<br />Suggested: {proposal.details[field].value}
        </span>
      </label>)}
      {proposal.rows.map((row, index) => <label key={index} className="mrf-extraction-option">
        <input type="checkbox" checked={rows.has(index)} onChange={() => setRows(previous => toggle(previous, index))} />
        <span><strong>{row.name || "Unnamed material"}</strong> · Page {row.page}<br />
          {labels.quantity}: {shown(row.quantity)} · {labels.unit}: {shown(row.unit)}<br />
          {labels.neededDate}: {shown(row.neededDate)} · {labels.location}: {shown(row.location)}
          {row.purpose && <><br />{labels.purpose}: {row.purpose}</>}
          {row.remarks && <><br />{labels.remarks}: {row.remarks}</>}
          {(!row.name || !row.quantity || !row.unit || !row.neededDate || !row.location) && <><br /><span className="muted">Check the PDF and complete the blank values before submitting.</span></>}
        </span>
      </label>)}
      <div><button type="button" className="button primary" disabled={!fields.size && !rows.size} onClick={() => onApply({ fields, rows })}>Apply selected suggestions</button></div>
    </fieldset>
  </div>;
}
