"use client";
/* eslint-disable @next/next/no-img-element -- Source previews use temporary browser Blob URLs. */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { InlineError } from "@/src/components/ui/Primitives";
import { mrfSourceError, mrfSourceSignature, parseMrfExtraction, type MrfExtractionResult } from "@/src/domain/mrf-extraction";

type Source = { id: string; file: File; url: string };
export function MrfAiImport({ disabled, onApply }: { disabled: boolean; onApply: (result: MrfExtractionResult) => Promise<boolean> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const urls = useRef(new Set<string>());
  const [sources, setSources] = useState<Source[]>([]);
  const [result, setResult] = useState<MrfExtractionResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    const createdUrls = urls.current;
    const requestVersion = version;
    const activeRequest = controller;
    return () => { requestVersion.current++; activeRequest.current?.abort(); for (const url of createdUrls) URL.revokeObjectURL(url); createdUrls.clear(); };
  }, []);
  const invalidate = () => { version.current++; controller.current?.abort(); controller.current = null; setBusy(false); setResult(null); setApplied(false); setError(""); };
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const combined = [...sources.map(source => source.file), ...files];
    const invalid = mrfSourceError(combined);
    if (invalid) { setError(invalid); return; }
    const currentVersion = version.current;
    setValidating(true);
    try {
      for (const file of files) if (!mrfSourceSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) throw new Error("A file does not match its PDF or image type. Choose a valid file.");
      if (currentVersion !== version.current) return;
      const added = files.map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { id: crypto.randomUUID(), file, url }; });
      invalidate(); setSources(current => [...current, ...added]);
    } catch (cause) { if (currentVersion === version.current) setError(cause instanceof Error ? cause.message : "The files could not be opened."); }
    finally { if (currentVersion === version.current || currentVersion + 1 === version.current) setValidating(false); }
  };
  const remove = (source: Source) => { invalidate(); URL.revokeObjectURL(source.url); urls.current.delete(source.url); setSources(current => current.filter(value => value.id !== source.id)); };
  const move = (index: number, direction: number) => {
    invalidate(); setSources(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  };
  const extract = async () => {
    if (busy || disabled || validating || !sources.length) return;
    invalidate(); const currentVersion = version.current;
    const abort = new AbortController(); controller.current = abort; setBusy(true);
    try {
      const form = new FormData(); sources.forEach(source => form.append("files", source.file));
      const response = await fetch("/api/requests/extract", { method: "POST", body: form, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(95_000)]) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "AI import failed. Retry or enter manually.");
      const found = parseMrfExtraction({ documentType: "single_mrf", details: payload.extraction?.details, items: payload.extraction?.items, warnings: payload.warnings });
      if (version.current === currentVersion) setResult(found);
    } catch (cause) { if (version.current === currentVersion && !abort.signal.aborted) setError(cause instanceof Error && !["TimeoutError", "AbortError"].includes(cause.name) ? cause.message : "AI import timed out. Retry or enter manually."); }
    finally { if (version.current === currentVersion) { setBusy(false); controller.current = null; } }
  };
  const locked = disabled || validating || busy || applying;
  return <section className="panel mrf-ai-import" aria-labelledby="mrf-ai-title" aria-busy={busy || validating}>
    <div className="panel-heading"><div><h2 id="mrf-ai-title">Import MRF with AI <span className="mrf-ai-optional">Optional</span></h2><p className="helper-note">Upload the hardcopy to fill request details and materials, then check and edit the results.</p></div></div>
    <p className="helper-note">One PDF or up to 12 page photos (JPG, PNG or WebP) · 4 MB total. These files are sent to AI for extraction. Attach the combined supporting PDF separately in Step 3.</p>
    <input ref={inputRef} type="file" className="reference-file-input" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" multiple aria-label="Choose MRF extraction sources" disabled={locked} onChange={event => void choose(event)}/>
    <div className="button-row"><button type="button" className="button secondary" disabled={locked} onClick={() => inputRef.current?.click()}>Choose MRF files</button>{sources.length > 0 && <button type="button" className="button primary" disabled={locked} onClick={() => void extract()}>{busy ? "Reading MRF…" : "Extract with AI"}</button>}{busy && <button type="button" className="button secondary" onClick={invalidate}>Cancel extraction</button>}</div>
    {validating && <p role="status">Checking source files…</p>}
    {busy && <p role="status">AI is reading the MRF. Your entered values stay unchanged until you apply the results.</p>}
    {!!sources.length && <ol className="mrf-ai-sources" aria-label="MRF source pages">{sources.map((source, index) => <li key={source.id}><div><strong>{source.file.name}</strong><small>{source.file.type === "application/pdf" ? "PDF" : `Page ${index + 1}`} · {(source.file.size / (1024 * 1024)).toFixed(2)} MB</small></div><div className="button-row"><button type="button" className="text-link" onClick={() => setPreviewId(source.id)}>View source</button>{sources.length > 1 && <><button type="button" className="button secondary" aria-label={`Move page ${index + 1} up`} disabled={locked || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="button secondary" aria-label={`Move page ${index + 1} down`} disabled={locked || index === sources.length - 1} onClick={() => move(index, 1)}>↓</button></>}<button type="button" className="text-link" disabled={locked} aria-label={`Remove MRF source ${index + 1}`} onClick={() => remove(source)}>Remove</button></div></li>)}</ol>}
    <InlineError message={error}/>
    {result && <div className="mrf-ai-result" aria-live="polite"><strong>{result.extraction.items.length} {result.extraction.items.length === 1 ? "material" : "materials"} extracted{result.extraction.details.ref ? ` · ${result.extraction.details.ref}` : ""}</strong>{result.extraction.details.projectName && <p>Project on document: <strong>{result.extraction.details.projectName}</strong>. Select the correct project in the form.</p>}{result.warnings.length > 0 && <details><summary>Check {result.warnings.length} extraction {result.warnings.length === 1 ? "note" : "notes"}</summary><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}<button type="button" className="button primary" disabled={locked || applied} onClick={async () => { setApplying(true); try { if (await onApply(result)) setApplied(true); } finally { setApplying(false); } }}>{applied ? "Results applied" : "Apply to form"}</button>{applied && <p role="status">Check the request details below and the materials in Step 2. Missing values need manual entry.</p>}</div>}
    {previewId && <MrfSourcePreview sources={sources} initialId={previewId} onClose={() => setPreviewId(null)}/>}
  </section>;
}

function MrfSourcePreview({ sources, initialId, onClose }: { sources: Source[]; initialId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = sources.find(source => source.id === selectedId) || sources[0];
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={dialogRef} className="quote-documents-dialog mrf-source-preview" aria-labelledby="mrf-source-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="quote-documents-heading"><div><span className="eyebrow">MRF EXTRACTION SOURCE</span><h2 id="mrf-source-title">Check the hardcopy</h2></div><button type="button" className="icon-button" aria-label="Close MRF source preview" onClick={onClose}>×</button></div>
    <div className="quote-documents-layout"><nav className="quote-documents-list" aria-label="MRF source documents">{sources.map((source, index) => <button type="button" key={source.id} aria-current={source.id === selected.id ? "true" : undefined} className={source.id === selected.id ? "active" : ""} onClick={() => setSelectedId(source.id)}><span>{index + 1}</span><strong>{source.file.name}</strong></button>)}</nav><div className="quote-document-preview">{selected.file.type === "application/pdf" ? <iframe title={selected.file.name} src={selected.url}/> : <img src={selected.url} alt={`MRF source ${selected.file.name}`}/>}</div></div>
  </dialog>;
}
