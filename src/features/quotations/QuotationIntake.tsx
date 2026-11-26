"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { QUOTE_FILE_LIMIT, QUOTE_GROUP_LIMIT, QUOTE_MIMES } from "@/src/domain/quotations/drafts";
import { parseIntakeStatus, type QuotationIntakeStatus, type QuotedSupplier } from "@/src/domain/quotations/intake";
import { fingerprint, responseJson, uploadQuotationFiles } from "./original-upload";

const endpoint = "/api/quotation-intake";
const messages: Record<string, string> = {
  provider: "Extraction could not finish. Retry or enter the supplier details manually.",
  "multiple-offers": "These originals contain multiple offers. Review them before continuing manually.",
  "no-offer": "The originals did not show one identifiable offer. Enter the supplier details manually.",
  limit: "These originals exceed 100 pages. Enter the supplier details manually.",
  source: "An original could not be verified. Cancel this upload and choose readable originals.",
  empty: "The originals have no readable values to fill. Enter the supplier details manually.",
};

export async function quotationIntakeAction(mrfId: string, command?: Record<string, unknown>) {
  const response = command ? await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command, mrfId }), signal: AbortSignal.timeout(25_000) })
    : await fetch(`${endpoint}?${new URLSearchParams({ mrfId })}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  const status = parseIntakeStatus(await responseJson(response));
  if (!status) throw Error("Quotation upload status could not be read.");
  return status;
}

export function QuotationIntake({ mrfId, status, disabled, onStatus, onBusy, onFill }: {
  mrfId: string;
  status: QuotationIntakeStatus | null;
  disabled: boolean;
  onStatus: (state: QuotationIntakeStatus) => void;
  onBusy: (busy: boolean) => void;
  onFill: (supplier: QuotedSupplier) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const sequence = useRef(0);
  const applied = useRef<string | null>(null);
  const receive = useEffectEvent((value: QuotationIntakeStatus) => {
    onStatus(value);
    if (value.id && value.supplier && applied.current !== value.id) {
      applied.current = value.id;
      onFill(value.supplier);
    }
  });
  const load = useCallback(() => quotationIntakeAction(mrfId), [mrfId]);
  useEffect(() => {
    let active = true;
    let polling = false;
    const check = async () => {
      if (running.current || polling) return;
      polling = true;
      const ticket = ++sequence.current;
      try {
        const value = await load();
        if (active && ticket === sequence.current && !running.current) {
          receive(value);
          setError("");
        }
      } catch (problem) {
        if (active && ticket === sequence.current && !running.current) setError(problem instanceof Error ? problem.message : "Check the upload status again.");
      } finally {
        polling = false;
      }
    };
    void check();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void check(); }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [load]);

  const perform = async (work: () => Promise<void>) => {
    if (disabled || running.current) return;
    running.current = true;
    sequence.current++;
    setBusy(true);
    onBusy(true);
    setError("");
    try { await work(); } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Retry the quotation upload.");
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
      onBusy(false);
    }
  };
  const start = (intakeId: string) => quotationIntakeAction(mrfId, { type: "start", intakeId });
  const extract = () => perform(async () => {
    let current = status;
    if (selected.some(file => !QUOTE_MIMES.some(mime => mime === file.type) || file.size < 5 || file.size > QUOTE_FILE_LIMIT)
      || selected.length > 12 || selected.reduce((size, file) => size + file.size, 0) > QUOTE_GROUP_LIMIT) {
      throw Error("Choose up to 12 PDF/JPEG/PNG/WebP originals, 20 MiB each and 45 MiB total.");
    }
    const localFiles = await Promise.all(selected.map(async file => ({ file, sha256: await fingerprint(file) })));
    if (!current?.id) {
      current = await quotationIntakeAction(mrfId, { type: "begin", operationId: crypto.randomUUID(),
        files: localFiles.map(({ file, sha256 }) => ({ name: file.name, mime: file.type, size: file.size, sha256 })) });
      onStatus(current);
    }
    if (!current.id || current.state !== "open") return;
    await uploadQuotationFiles(localFiles, current.files.filter(file => !file.uploaded), `${endpoint}/uploads`, setProgress);
    onStatus(await start(current.id));
    setSelected([]);
  });

  if (status?.state === "disabled" || (!status && !error)) return null;
  const state = status?.state;
  const reading = state === "pending" || state === "running";
  const hasUploads = !!status?.id;
  const needsFiles = !hasUploads || (state === "open" && !!status.files.some(file => !file.uploaded));
  const locked = disabled || busy;
  return <section aria-labelledby={id}>
    <h3 id={id}>Quotation originals</h3>
    <InlineError message={error} />
    {hasUploads && !!status.files.length && <ul>{status.files.map(file => <li key={file.id}>{file.name}</li>)}</ul>}
    {needsFiles && <Field label={hasUploads ? "Reselect matching originals" : "Select originals"}>
      <input type="file" name="intake-originals" multiple accept={QUOTE_MIMES.join(",")} disabled={locked}
        onChange={event => setSelected(Array.from(event.target.files ?? []))} />
    </Field>}
    {progress && <p role="status">{progress}</p>}
    {reading && <p role="status">Verifying and reading the originals.</p>}
    {state === "ready" && <p role="status">Review the supplier details before linking the draft.</p>}
    {state === "stale" && <p role="status">The MRF approval or access changed. Cancel this upload and open the current MRF.</p>}
    {(state === "failed" || state === "unusable") && <p role="status">{messages[status?.reason ?? "provider"] ?? messages.provider}</p>}
    <div className="form-actions">
      {(state === "idle" || state === "open") && <button type="button" className="button secondary"
        disabled={locked || (needsFiles && !selected.length)} onClick={() => void extract()}>Extract and fill</button>}
      {state === "failed" && status?.id && <button type="button" className="button secondary" disabled={locked} onClick={() => void perform(async () => {
        onStatus(await start(status.id!));
      })}>Retry extraction</button>}
      {status?.id && <button type="button" className="button secondary" disabled={locked} onClick={() => void perform(async () => {
        onStatus(await quotationIntakeAction(mrfId, { type: "cancel", intakeId: status.id }));
        setSelected([]);
      })}>Cancel original upload</button>}
    </div>
  </section>;
}
