"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { InlineError } from "@/src/components/ui/Primitives";
import { record } from "@/src/domain/projects/projects";
import { parseExtractionStatus, type ExtractionStatus, type MrfProposal } from "@/src/domain/requests/extraction";

const messages: Record<string, string> = {
  limit: "Extraction supports PDFs up to 10 MB and 100 pages. Enter the MRF manually for this PDF.",
  "no-mrf": "No identifiable MRF form was found in this PDF. Enter the MRF manually.",
  "multiple-mrfs": "This PDF contains several distinct MRFs. Use a supporting PDF for one MRF or enter it manually.",
  empty: "The MRF pages have no readable values to fill. Enter the MRF manually.",
  source: "The verified PDF could not be read. Review the file or enter the MRF manually.",
  provider: "Extraction could not finish. Retry or enter the MRF manually.",
};

type Props = {
  mrfId: string; version: string; attachmentRevision: string; projectName: string;
  disabled: boolean; applied: boolean; onChecking: (checking: boolean) => void;
  onFill: (proposal: MrfProposal, id: string) => boolean;
};

export function MrfExtraction({ mrfId, version, attachmentRevision, projectName, disabled, applied, onChecking, onFill }: Props) {
  const [status, setStatus] = useState<ExtractionStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fillRequested, setFillRequested] = useState(false);
  const [noChanges, setNoChanges] = useState(false);
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
  const readyId = ready ? status.id : undefined;
  useEffect(() => {
    if (!processing && !ready) return;
    const timer = setInterval(() => {
      if (!pending.current && document.visibilityState === "visible") void load();
    }, processing ? 4000 : 15000);
    return () => clearInterval(timer);
  }, [load, processing, ready]);

  // Read the current editor state after the checked apply request finishes.
  const deliver = useEffectEvent((proposal: MrfProposal, id: string) => {
    if (!disabled && !applied) setNoChanges(!onFill(proposal, id));
  });
  const fill = useEffectEvent(async (proposalId: string) => {
    if (pending.current || disabled || applied) return;
    pending.current = true;
    setBusy(true);
    setFillRequested(false);
    onChecking(true);
    try {
      const checked = await load({ type: "apply", proposalId });
      if (checked?.proposal && checked.id === proposalId) deliver(checked.proposal, proposalId);
    } finally {
      pending.current = false;
      setBusy(false);
      onChecking(false);
    }
  });
  useEffect(() => {
    if (readyId && fillRequested && !disabled && !busy && !applied) void fill(readyId);
  }, [readyId, fillRequested, disabled, busy, applied]);

  const run = async (action: "start" | "retry") => {
    if (pending.current || disabled || applied) return;
    pending.current = true;
    setBusy(true);
    setNoChanges(false);
    setFillRequested(true);
    try {
      const key = `${action}:${status?.attemptId ?? ""}`;
      if (retryOperation.current?.key !== key) retryOperation.current = { key, id: crypto.randomUUID() };
      const response = await load({ type: action, operationId: retryOperation.current.id, proposalId: status?.id, attemptId: status?.attemptId });
      if (response) retryOperation.current = null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  if (status?.state === "disabled" || (!status && !error)) return null;
  const retry = status?.state === "failed" || status?.state === "expired";
  const printedProject = status?.proposal?.details.projectName.value;
  const printedRef = status?.proposal?.details.sourceRef.value;
  const mismatch = printedProject && projectName && printedProject.toLowerCase() !== projectName.toLowerCase();
  const locked = disabled || busy;
  return <section className="mrf-extraction" aria-labelledby="mrf-extraction-heading">
    <h3 id="mrf-extraction-heading">Fill from supporting PDF</h3>
    <InlineError message={error} />
    {error && <button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>Check extraction status</button>}
    {applied && <p role="status">Filled from the PDF. Check the Details and Materials before saving or submitting.</p>}
    {!applied && <>
      {status?.state === "idle" && <button type="button" className="button secondary" disabled={locked} onClick={() => void run("start")}>Extract and fill</button>}
      {processing && <p role="status">Reading the supporting PDF. You can keep editing while extraction runs.</p>}
      {(status?.state === "failed" || status?.state === "unusable") && <p role="status">{messages[status.reason ?? "provider"] ?? messages.provider}</p>}
      {status?.state === "expired" && <p role="status">The extraction expired. Run it again from the current PDF.</p>}
      {status?.state === "stale" && <p role="status">The draft or supporting PDF changed. Open the current version to extract again.</p>}
      {retry && <button type="button" className="button secondary" disabled={locked} onClick={() => void run("retry")}>Retry extraction</button>}
      {ready && !fillRequested && <button type="button" className="button secondary" disabled={locked} onClick={() => setFillRequested(true)}>Fill from PDF</button>}
      {ready && noChanges && <p role="status">The draft already contains the readable PDF values.</p>}
    </>}
    {ready && (mismatch || printedRef) && <div className="mrf-extraction-review">
      {mismatch && <p className="callout warn">The PDF lists <strong>{printedProject}</strong>. Check that it belongs to <strong>{projectName}</strong>.</p>}
      {printedRef && <p>Printed MRF number: <strong>{printedRef}</strong>.</p>}
    </div>}
  </section>;
}
