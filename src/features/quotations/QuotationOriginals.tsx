"use client";

import { useEffect, useRef, useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import {
  parseQuotationsView,
  QUOTE_CHUNK_SIZE,
  QUOTE_FILE_LIMIT,
  QUOTE_GROUP_LIMIT,
  QUOTE_MIMES,
  type QuotationDraft,
  type QuoteFile,
} from "@/src/domain/quotations/drafts";

async function responseJson(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw Error(
      typeof value?.error === "string"
        ? value.error
        : "File action could not finish.",
    );
  return value;
}
async function fingerprint(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function QuotationOriginals({
  quote,
  editable,
  canRetry,
}: {
  quote: QuotationDraft;
  editable: boolean;
  canRetry: boolean;
}) {
  const { refresh } = useFoundationRealtime();
  const [selected, setSelected] = useState<File[]>([]);
  const [keep, setKeep] = useState<string[]>(quote.files.map((f) => f.id));
  const [reviewedFiles, setReviewedFiles] = useState(quote.fileVersion);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const retry = useRef<{ key: string; id: string } | null>(null);
  const running = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const pending = quote.groups.find(
    (g) => g.state === "uploading" || g.state === "conflict",
  );
  const stale = reviewedFiles !== quote.fileVersion;
  useEffect(() => {
    if (!quote.groups.length && !quote.jobs.length) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [quote.groups.length, quote.jobs.length, refresh]);
  const readSaved = async () => {
    const response = await responseJson(
      await fetch(`/api/foundation/view?view=quotations&mrfId=${quote.mrfId}`, {
        cache: "no-store",
      }),
    );
    const view = parseQuotationsView(response.view?.data);
    const current = view?.quotes.find((q) => q.id === quote.id);
    if (!current) throw Error("Quotation is no longer available.");
    return current;
  };
  const action = async (command: Record<string, unknown>) => {
    const key = JSON.stringify(command);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    const result = await responseJson(
      await fetch("/api/quotation-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...command,
          quoteId: quote.id,
          requestId: retry.current.id,
        }),
      }),
    );
    retry.current = null;
    return result;
  };
  const transfer = async (files: File[], saved: QuotationDraft) => {
    const hashes = await Promise.all(
      files.map(async (file) => ({ file, sha256: await fingerprint(file) })),
    );
    const group = saved.groups.find((g) => g.state === "uploading");
    if (!group) return;
    for (const upload of group.uploads.filter((f) => f.state === "uploading")) {
      const match = hashes.find(
        (f) =>
          f.file.name === upload.name &&
          f.file.size === upload.size &&
          f.file.type === upload.mime &&
          f.sha256 === upload.sha256,
      );
      if (!match)
        throw Error(
          `Reselect the matching local file to resume: ${upload.name}`,
        );
      let state = await responseJson(
        await fetch(`/api/quotation-files/uploads/${upload.id}`, {
          cache: "no-store",
        }),
      );
      while (!state.complete && !state.validating) {
        const offset = state.offset;
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset >= match.file.size
        )
          throw Error("Invalid confirmed upload position.");
        setProgress(
          `${upload.name}: ${offset.toLocaleString()} / ${upload.size.toLocaleString()} bytes`,
        );
        try {
          state = await responseJson(
            await fetch(
              `/api/quotation-files/uploads/${upload.id}?offset=${offset}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: match.file.slice(offset, offset + QUOTE_CHUNK_SIZE),
              },
            ),
          );
        } catch (error) {
          // Resolve an uncertain POST before deciding whether another chunk is needed.
          const recovered = await responseJson(
            await fetch(`/api/quotation-files/uploads/${upload.id}`, {
              cache: "no-store",
            }),
          );
          if (
            recovered.offset === offset &&
            !recovered.complete &&
            !recovered.validating
          )
            throw error;
          state = recovered;
        }
      }
    }
    setProgress(
      "Uploads transferred. Verifying the complete group before saving it.",
    );
  };
  const perform = async (run: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "File work was interrupted. Retry to recover its saved state.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      refresh();
    }
  };
  const upload = () =>
    perform(async () => {
      if (stale)
        throw Error(
          "Review the latest saved originals before changing the group.",
        );
      if (pending) {
        await transfer(selected, await readSaved());
        return;
      }
      const descriptors: Omit<QuoteFile, "id">[] = [];
      for (const file of selected) {
        if (
          !QUOTE_MIMES.some((mime) => mime === file.type) ||
          file.size < 5 ||
          file.size > QUOTE_FILE_LIMIT
        )
          throw Error("Choose PDF/JPEG/PNG/WebP files within 20 MiB each.");
        descriptors.push({
          name: file.name,
          size: file.size,
          mime: file.type,
          sha256: await fingerprint(file),
        });
      }
      if (
        keep.length + descriptors.length > 12 ||
        descriptors.reduce((total, f) => total + f.size, 0) +
          quote.files
            .filter((f) => keep.includes(f.id))
            .reduce((total, f) => total + f.size, 0) >
          QUOTE_GROUP_LIMIT
      )
        throw Error("Use up to 12 originals and 45 MiB total.");
      await action({
        type: "beginGroup",
        expectedFiles: reviewedFiles,
        keep,
        uploads: descriptors,
      });
      const saved = await readSaved();
      await transfer(selected, saved);
      setSelected([]);
      if (input.current) input.current.value = "";
    });
  return (
    <section className="panel quotation-originals">
      <h2>Supplier originals</h2>
      <p>
        Up to 12 PDF/JPEG/PNG/WebP files, 20 MiB each and 45 MiB total. Images
        must be decodable single images within 40 megapixels. File actions save
        separately from quotation text.
      </p>
      <ul>
        {quote.files.map((file) => (
          <li key={file.id}>
            {editable && !pending && (
              <label>
                <input
                  type="checkbox"
                  checked={keep.includes(file.id)}
                  disabled={busy || stale}
                  onChange={(e) =>
                    setKeep(
                      e.target.checked
                        ? [...keep, file.id]
                        : keep.filter((id) => id !== file.id),
                    )
                  }
                />{" "}
                Keep{" "}
              </label>
            )}
            <a
              href={`/api/quotation-files/${file.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {file.name}
            </a>{" "}
            · {(file.size / 1024 / 1024).toFixed(2)} MiB ·{" "}
            <a href={`/api/quotation-files/${file.id}?download=1`}>Download</a>
          </li>
        ))}
      </ul>
      {!quote.files.length && <p>No saved originals.</p>}
      {pending && (
        <div role="status">
          <strong>Group {pending.state}</strong>
          <ul>
            {pending.uploads.map((file) => (
              <li key={file.id}>
                {file.name} · {file.state} · {file.offset.toLocaleString()} /{" "}
                {file.size.toLocaleString()} bytes
              </li>
            ))}
          </ul>
          <p>
            The previous saved group is retained until all selected changes
            verify.
          </p>
        </div>
      )}
      {editable && (
        <>
          {stale && (
            <div role="status">
              <p>
                The saved original group changed. Review its files before
                continuing; your selected local files are retained.
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setReviewedFiles(quote.fileVersion);
                  setKeep(quote.files.map((f) => f.id));
                }}
              >
                I reviewed the latest original group
              </button>
            </div>
          )}
          <Field
            label={
              pending
                ? "Reselect matching files to resume"
                : "Select originals to add or replace"
            }
          >
            <input
              ref={input}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                setSelected(Array.from(e.target.files ?? []));
                setError("");
              }}
            />
          </Field>
          <div className="form-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || stale || pending?.state === "conflict"}
              onClick={upload}
            >
              {busy
                ? "Processing…"
                : pending
                  ? "Resume uploads"
                  : "Save original group"}
            </button>
            {pending && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await action({ type: "cancelGroup", groupId: pending.id });
                    setSelected([]);
                    setProgress("");
                  })
                }
              >
                Cancel unfinished group
              </button>
            )}
          </div>
        </>
      )}
      {quote.jobs.map((job) => (
        <div key={job.id} role="status">
          <p>
            {job.kind === "validate"
              ? "Checking original"
              : "Removing obsolete file"}
            : {job.state}
            {job.message ? ` — ${job.message}` : ""}
          </p>
          {canRetry &&
            (editable || job.kind === "cleanup") &&
            ["failed", "paused"].includes(job.state) && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await action({ type: "retryJob", jobId: job.id });
                  })
                }
              >
                Retry file job
              </button>
            )}
        </div>
      ))}
      {progress && <p role="status">{progress}</p>}
      <InlineError message={error} />
    </section>
  );
}
