"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { InlineError } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { DOCUMENT_CHUNK_SIZE, MAX_SUPPORTING_PDF, parseDocumentsView, type DocumentsView, type UploadView } from "@/src/domain/requests/documents";
import { record } from "@/src/domain/projects/projects";

async function responseBody(response: Response) {
  const value: unknown = await response.json();
  if (!response.ok) throw Error(String(record(value)?.error ?? "The document action was interrupted. Refresh its status, then retry."));
  return value;
}
export function useDocuments(query: string) {
  const { view, refresh } = useFoundationRealtime();
  const [data, setData] = useState<DocumentsView | null>(null), [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const attempt = ++sequence.current;
    try {
      const response = await fetch(`/api/mrf-documents?${query}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (response.status === 401 || response.status === 403) { setData(null); refresh(); }
      const parsed = parseDocumentsView(await responseBody(response));
      if (!parsed) throw Error("Document status could not be read. Retry shortly.");
      if (attempt === sequence.current) { setData(parsed); setError(""); }
    } catch (error) { if (attempt === sequence.current) setError(error instanceof Error ? error.message : "Document status is unavailable."); }
  }, [query, refresh]);
  useEffect(() => {
    queueMicrotask(() => void load());
    return () => { sequence.current++; };
  }, [load, view]);
  // Progress is authoritative but does not change the attachment or draft revision.
  useEffect(() => {
    if (!data?.jobs.some(job => ["pending", "running"].includes(job.state)) && !data?.uploads.some(upload => upload.state === "validating")) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => clearInterval(timer);
  }, [data, load]);
  return { data, error, load, refresh };
}
export async function sendDocumentAction(command: Record<string, unknown>) {
  return responseBody(await fetch("/api/mrf-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(30000) }));
}
const sizeLabel = (size: number) => size < 1024 ? `${size} bytes` : size < 1024 * 1024 ? `${(size / 1024).toLocaleString("en-PH", { maximumFractionDigits: 1 })} KiB` : `${(size / (1024 * 1024)).toLocaleString("en-PH", { maximumFractionDigits: 2 })} MiB`;

export function MrfDocuments({ mrfId, editable: permitted, archiveManager = false }: { mrfId: string; editable: boolean; archiveManager?: boolean }) {
  const { data, error: readError, load, refresh } = useDocuments(`mrfId=${encodeURIComponent(mrfId)}`);
  const editable = permitted && data?.editable === true;
  const [file, setFile] = useState<File | null>(null), [resumeId, setResumeId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState<number | null>(null), [preview, setPreview] = useState(false);
  const command = useRef<Record<string, unknown> | null>(null), locked = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const [uncertain, setUncertain] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState<string | null>(null);
  const selectionStale = !!file && !!data && selectionRevision !== null && selectionRevision !== data.revision;
  const run = async (input: Record<string, unknown>) => {
    command.current ??= { ...input, operationId: crypto.randomUUID(), mrfId };
    try { const result = await sendDocumentAction(command.current); command.current = null; setUncertain(false); return result; }
    catch (error) { setUncertain(true); throw error; }
  };
  const upload = async () => {
    if (locked.current || !file || !data || selectionStale) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (file.size < 5 || file.size > MAX_SUPPORTING_PDF || !/\.pdf$/i.test(file.name)) throw Error("Choose one PDF up to 50 MiB.");
      const buffer = await file.arrayBuffer();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
      const selected = data.uploads.find(upload => upload.id === resumeId);
      if (resumeId && (!selected || selected.sha256 !== sha256 || selected.size !== file.size)) throw Error("Reselect the same PDF to resume. Its contents and size must match.");
      const result = record(await run(selected ? { type: "resumeUpload", uploadId: selected.id, size: String(file.size), sha256 }
        : { type: "startUpload", expectedRevision: selectionRevision ?? data.revision, name: file.name, size: file.size, sha256 }));
      if (!result || typeof result.uploadId !== "string") throw Error("Upload identity unavailable. Refresh its status.");
      const url = `/api/mrf-documents/uploads/${result.uploadId}`;
      let status = record(await responseBody(await fetch(url, { method: "POST", signal: AbortSignal.timeout(110000) })));
      if (!status || typeof status.offset !== "number") throw Error("Upload offset unavailable. Reselect this PDF to resume.");
      let offset = status.offset;
      setProgress(offset / file.size * 100);
      while (offset < file.size && !status.validating && !status.complete) {
        const chunk = buffer.slice(offset, offset + DOCUMENT_CHUNK_SIZE);
        status = record(await responseBody(await fetch(url, { method: "PUT", headers: { "Content-Type": "application/pdf", "X-Upload-Offset": String(offset) }, body: chunk, signal: AbortSignal.timeout(110000) })));
        if (!status || typeof status.offset !== "number" || status.offset <= offset || status.offset > file.size) throw Error("Upload was interrupted. Check status and reselect the same PDF to resume.");
        offset = status.offset;
        setProgress(offset / file.size * 100);
      }
      setFile(null); setResumeId(""); setSelectionRevision(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) { setError(error instanceof Error ? error.message : "The upload was interrupted. Check its status and resume."); }
    finally { locked.current = false; setBusy(false); setProgress(null); await load(); refresh(); }
  };
  const action = async (input: Record<string, unknown>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = record(await run(input));
      if (["startUpload", "resumeUpload"].includes(String(input.type)) && typeof result?.uploadId === "string") setResumeId(result.uploadId);
      if (input.type === "cancelUpload" && input.uploadId === resumeId) {
        setResumeId(""); setFile(null); setSelectionRevision(null);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
    catch (error) { setError(error instanceof Error ? error.message : "The action was interrupted."); }
    finally { locked.current = false; setBusy(false); await load(); refresh(); }
  };
  const chooseResume = (upload: UploadView) => { setResumeId(upload.id); setFile(null); setSelectionRevision(data?.revision ?? null); setError(""); command.current = null; setUncertain(false); };
  return <section className="panel mrf-documents" aria-labelledby="supporting-pdf-heading">
    <h2 id="supporting-pdf-heading">Supporting PDF</h2>
    <p className="muted">Combine the source MRF, key plan and work scope in one readable, unencrypted PDF, up to 50 MiB. Review the file contents before submission.</p>
    {!data && !readError && <p role="status">Loading document status…</p>}
    {data?.current ? <div className="document-current"><p><strong>{data.current.name}</strong> · {sizeLabel(data.current.size)}</p><p className="muted">Uploaded by {data.current.uploaderName}</p><div className="form-actions">
      <button type="button" className="button secondary" onClick={() => setPreview(true)}>Preview PDF</button>
      <a className="button secondary" download href={`/api/mrf-documents/files/${data.current.id}?download=1`}>Download PDF</a>
      {editable && <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => { if (window.confirm("Remove the current supporting PDF? Its metadata history will be retained.")) void action({ type: "remove", expectedRevision: data.revision }); }}>Remove PDF</button>}
    </div></div> : data && <p>No supporting PDF attached.</p>}
    {editable && data && <>
      {!data.folder && <p role="status">An Administrator or Project Manager must set up this project’s document folder before uploading.</p>}
      <fieldset disabled={busy || !data.folder || uncertain}>
        <label className="field"><span>{resumeId ? "Reselect the same PDF to resume" : data.current ? "Choose replacement PDF" : "Choose supporting PDF"}</span><input key={resumeId} ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setSelectionRevision(data.revision); command.current = null; }} /></label>
        {file && <p>{file.name} · {sizeLabel(file.size)}</p>}
      </fieldset>
      <div className="form-actions"><button type="button" className="button primary" disabled={busy || uncertain || selectionStale || !file || !data.folder} onClick={() => void upload()}>{busy ? "Uploading…" : resumeId ? "Resume upload" : data.current ? "Upload replacement" : "Upload PDF"}</button>{resumeId && <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => { setResumeId(""); setFile(null); setSelectionRevision(null); }}>Choose a new upload</button>}</div>
      {selectionStale && !busy && <div role="status"><p>The shared attachment changed after you selected this PDF. Review the current file above before replacing it.</p><button type="button" className="button secondary" disabled={uncertain} onClick={() => { setSelectionRevision(data.revision); command.current = null; }}>I reviewed the current attachment; keep my selected PDF</button></div>}
      {progress !== null && <label className="field"><span>PDF uploaded: {Math.floor(progress)}%</span><progress max={100} value={progress} /></label>}
      <p className="muted">File actions save separately. Unsaved Details and Materials stay in your open editor. A replacement becomes current after verification.</p>
    </>}
    {data?.uploads.map(upload => <div key={upload.id} className="document-upload"><p><strong>{upload.name}</strong> · {upload.state === "uploading" ? `${Math.floor(upload.offset / upload.size * 100)}% uploaded` : upload.state === "validating" ? "Verifying PDF…" : upload.state === "conflict" ? "Attachment changed; this upload was not selected" : upload.state}</p>
      {editable && <div className="form-actions">{upload.state === "uploading" && <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => chooseResume(upload)}>Reselect to resume</button>}
        <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => void action({ type: "cancelUpload", uploadId: upload.id })}>Cancel upload</button></div>}
    </div>)}
    {data?.jobs.map(job => <div key={job.id} role="status"><p>{job.kind === "folder" ? "Project folder" : job.kind === "cleanup" ? "Old file cleanup" : job.kind === "archive" ? "Approved archive" : "PDF verification"}: {job.state}. {job.message}</p>
      {editable && ["validate", "cleanup"].includes(job.kind) && ["failed", "paused"].includes(job.state) && !job.message?.includes("corrupt") && <button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => void action({ type: "retryFile", jobId: job.id })}>Retry {job.kind === "cleanup" ? "cleanup" : "verification"}</button>}
      {archiveManager && job.kind === "archive" && ["failed", "paused"].includes(job.state) && <div className="form-actions"><button type="button" className="button secondary" disabled={busy || uncertain} onClick={() => void action({ type: "retryArchive", jobId: job.id })}>Retry approved archive</button><button type="button" className="button secondary" disabled={busy || uncertain || !data.folder} onClick={() => { if (window.confirm("Retry against the current project folder? The previous attempt’s destination and file identities remain recorded.")) void action({ type: "retryArchive", jobId: job.id, useCurrentMapping: true }); }}>Retry using current project folder</button></div>}
    </div>)}
    {!!data?.archives.length && <><h3>Approved document versions</h3>{data.archives.map(archive => <div key={archive.id}><p><strong>Version {archive.version}</strong> · Approved by {archive.approvedBy} · <time dateTime={archive.approvedAt}>{new Date(archive.approvedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time> · {archive.complete ? "Archive complete" : "Archive pending"}</p><div className="form-actions">{archive.files.map(file => <span key={file.id}><a className="button secondary" target="_blank" rel="noreferrer" href={`/api/mrf-documents/files/${file.id}`}>Preview {file.kind === "form" ? "approved MRF" : "approved supporting PDF"}</a> <a download href={`/api/mrf-documents/files/${file.id}?download=1`}>Download</a></span>)}</div></div>)}</>}
    <InlineError message={error || readError} />
    {uncertain && <button type="button" className="button secondary" disabled={busy} onClick={() => void action(command.current ?? {})}>Retry same file action</button>}
    {(error || readError) && <button type="button" className="button secondary" disabled={busy} onClick={() => { command.current = null; setUncertain(false); void load(); }}>Review current file status</button>}
    <RecordModal open={preview && !!data?.current} title={data?.current?.name ?? "Supporting PDF"} onClose={() => setPreview(false)}>
      {data?.current && <><iframe className="document-preview-frame" title="Supporting PDF preview" src={`/api/mrf-documents/files/${data.current.id}`} /><a download href={`/api/mrf-documents/files/${data.current.id}?download=1`}>Download this PDF</a></>}
    </RecordModal>
  </section>;
}
