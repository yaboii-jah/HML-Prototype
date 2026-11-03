"use client";

import { useRef, useState } from "react";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { sendDocumentAction, useDocuments } from "@/src/features/requests/MrfDocuments";

export function ProjectDocuments({ projectId }: { projectId: string }) {
  const { data, error: readError, load, refresh } = useDocuments(`projectId=${encodeURIComponent(projectId)}`);
  const [input, setInput] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null), locked = useRef(false);
  const act = async (command: Record<string, unknown>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    pending.current ??= { ...command, projectId, operationId: crypto.randomUUID() };
    try { await sendDocumentAction(pending.current); pending.current = null; setUncertain(false); }
    catch (error) { setUncertain(true); setError(error instanceof Error ? error.message : "Folder setup was interrupted."); }
    finally { locked.current = false; setBusy(false); await load(); refresh(); }
  };
  const folderId = input.match(/\/folders\/([\w-]+)/)?.[1] ?? input.trim();
  return <section className="panel" aria-labelledby="project-documents-heading"><h2 id="project-documents-heading">Document folder</h2>
    {!data && !readError && <p role="status">Loading folder status…</p>}
    {data && <><p>{data.folder ? `Current destination: ${data.folder.name}` : "No document folder configured."}</p><p className="muted">Each project needs its own writable folder below the configured company root. Changing this destination affects new operations; existing files and running jobs keep their locations.</p>
      {data.jobs.filter(job => job.kind === "folder").map(job => <div key={job.id} role="status"><p>Folder setup: {job.state}. {job.message}</p>{["failed", "paused"].includes(job.state) && <button type="button" className="button secondary" disabled={busy} onClick={() => void act({ type: "retryFolder", jobId: job.id })}>Retry folder setup</button>}</div>)}
      <Field label="Existing Drive folder URL or ID"><input value={input} disabled={busy || uncertain} onChange={event => setInput(event.target.value)} /></Field>
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy || uncertain || !/^[\w-]{10,}$/.test(folderId)} onClick={() => void act({ type: "setupFolder", folderId, expectedMapping: data.folder?.id ?? null })}>Link folder</button><button type="button" className="button secondary" disabled={busy} onClick={() => void act({ type: "setupFolder", expectedMapping: data.folder?.id ?? null })}>{busy ? "Saving…" : uncertain ? "Retry same folder action" : data.folder ? "Create new destination" : "Create project folder"}</button></div></>}
    <InlineError message={error || readError} />{(error || readError) && <button type="button" className="button secondary" disabled={busy} onClick={() => { pending.current = null; setUncertain(false); void load(); }}>Review current folder status</button>}
  </section>;
}
