"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { InlineError } from "@/src/components/ui/Primitives";
import { record } from "@/src/domain/projects/projects";
import type { QuotationDraft } from "@/src/domain/quotations/drafts";
import { normalizedQuoteText, parseQuoteExtractionStatus, type QuoteExtractionProposal, type QuoteExtractionStatus } from "@/src/domain/quotations/extraction";

const messages: Record<string, string> = {
  limit: "Extraction supports up to 12 originals, 45 MiB total, and 100 pages including images. Enter this quotation manually.",
  "no-offer": "The originals do not show one identifiable offer. Review the group or enter the quotation manually.",
  "multiple-offers": "The group contains multiple offers or alternatives. Use one offer per draft or enter the quotation manually.",
  empty: "The originals have no readable values to fill. Enter the quotation manually.",
  source: "A verified original could not be read. Review the group or enter the quotation manually.",
  provider: "Extraction could not finish. Retry or enter the quotation manually.",
};

export function QuotationExtraction({ quote, disabled, applied, onChecking, onFill }: {
  quote: QuotationDraft;
  disabled: boolean;
  applied: boolean;
  onChecking: (active: boolean) => void;
  onFill: (proposal: QuoteExtractionProposal, id: string) => boolean;
}) {
  const heading = useId();
  const { id: quoteId, version, fileVersion } = quote;
  const [status, setStatus] = useState<QuoteExtractionStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<"fill" | "continue" | null>(null);
  const [mismatch, setMismatch] = useState("");
  const [unchangedNotes, setUnchangedNotes] = useState<QuoteExtractionProposal["notes"] | null>(null);
  const sequence = useRef(0);
  const pending = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const endpoint = "/api/quotation-extraction";

  const load = useCallback(async (command?: Record<string, unknown>) => {
    const ticket = ++sequence.current;
    const source = { quoteId, version, fileVersion };
    try {
      const signal = AbortSignal.timeout(20_000);
      const response = command
        ? await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...source, ...command }), signal })
        : await fetch(`${endpoint}?${new URLSearchParams(source)}`, { cache: "no-store", signal });
      const data: unknown = await response.json();
      if (ticket !== sequence.current) return null;
      const parsed = parseQuoteExtractionStatus(data);
      if (!response.ok || !parsed) throw Error(String(record(data)?.error ?? "Extraction status could not be read."));
      setStatus(parsed);
      setError("");
      if (parsed.state !== "ready") {
        setMismatch("");
        setUnchangedNotes(null);
      }
      return parsed;
    } catch (problem) {
      if (ticket === sequence.current) setError(problem instanceof Error ? problem.message : "Check extraction status again.");
      return null;
    }
  }, [quoteId, version, fileVersion]);

  useEffect(() => {
    queueMicrotask(() => void load());
    return () => { sequence.current++; };
  }, [load]);

  const processing = status?.state === "pending" || status?.state === "running";
  const readyId = status?.state === "ready" ? status.id : undefined;
  useEffect(() => {
    if (!processing && !readyId) return;
    const timer = setInterval(() => {
      if (!pending.current && document.visibilityState === "visible") void load();
    }, processing ? 4000 : 15000);
    return () => clearInterval(timer);
  }, [load, processing, readyId]);

  const deliver = useEffectEvent((proposal: QuoteExtractionProposal, id: string, confirmedName: string) => {
    if (disabled || applied) return;
    const printed = proposal.body.supplierName;
    if (printed && quote.body.supplierName && normalizedQuoteText(printed) !== normalizedQuoteText(quote.body.supplierName) && printed !== confirmedName) {
      setMismatch(printed);
      return;
    }
    setMismatch("");
    setUnchangedNotes(onFill(proposal, id) ? null : proposal.notes);
  });

  const fill = useEffectEvent(async (proposalId: string, confirmedName: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setIntent(null);
    onChecking(true);
    try {
      const checked = await load({ type: "apply", proposalId });
      if (checked?.proposal && checked.id === proposalId) deliver(checked.proposal, proposalId, confirmedName);
    } finally {
      pending.current = false;
      setBusy(false);
      onChecking(false);
    }
  });

  useEffect(() => {
    if (readyId && intent && !disabled && !busy && !applied) void fill(readyId, intent === "continue" ? mismatch : "");
  }, [readyId, intent, mismatch, disabled, busy, applied]);

  const start = async (type: "start" | "retry") => {
    if (pending.current || disabled || applied) return;
    pending.current = true;
    setBusy(true);
    setUnchangedNotes(null);
    setIntent("fill");
    try {
      const key = `${type}:${status?.attemptId ?? ""}`;
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
      if (await load({ type, operationId: operation.current.id, proposalId: status?.id, attemptId: status?.attemptId })) operation.current = null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  if (status?.state === "disabled" || applied || (!status && !error)) return null;
  const retry = status?.state === "failed" || status?.state === "expired";
  const locked = disabled || busy;
  return <section className="quotation-extraction" aria-labelledby={heading}>
    <h3 id={heading}>Fill from originals</h3>
    <InlineError message={error} />
    {error && <button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>Check extraction status</button>}
    {status?.state === "idle" && <button type="button" className="button secondary" disabled={locked} onClick={() => void start("start")}>Extract and fill</button>}
    {processing && <p role="status">Reading the originals. You can keep editing.</p>}
    {(status?.state === "failed" || status?.state === "unusable") && <p role="status">{messages[status.reason ?? "provider"] ?? messages.provider}</p>}
    {status?.state === "expired" && <p role="status">The extraction expired. Run it again from the current originals.</p>}
    {status?.state === "stale" && <p role="status">The quotation or its originals changed. Reopen the current draft and verify the originals.</p>}
    {retry && <button type="button" className="button secondary" disabled={locked} onClick={() => void start("retry")}>Retry extraction</button>}
    {mismatch && <div className="callout warn" role="status">
      <p>The originals name <strong>{mismatch}</strong>. This quotation is saved under <strong>{quote.body.supplierName}</strong>.</p>
      <button type="button" className="button secondary" disabled={locked} onClick={() => setIntent("continue")}>Continue filling</button>
    </div>}
    {readyId && !mismatch && !unchangedNotes && <button type="button" className="button secondary" disabled={locked || !!intent} onClick={() => setIntent("fill")}>Fill from originals</button>}
    {readyId && unchangedNotes && <>
      <p role="status">No additional fields or lines to fill. Review the originals before saving.</p>
      <QuotationExtractionNotes notes={unchangedNotes} files={quote.files} />
    </>}
  </section>;
}

export function QuotationExtractionNotes({ notes, files }: {
  notes: QuoteExtractionProposal["notes"];
  files: QuotationDraft["files"];
}) {
  if (!notes.length) return null;
  return <details>
    <summary>Values to check in the originals</summary>
    <ul>{notes.map(note => <li key={`${note.sourceFileId}:${note.sourcePage}:${note.text}`}>
      {files.find(file => file.id === note.sourceFileId)?.name ?? "Original"} · page {note.sourcePage}. {note.text}
    </li>)}</ul>
  </details>;
}
