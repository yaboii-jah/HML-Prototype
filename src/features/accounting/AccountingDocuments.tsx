"use client";
/* eslint-disable @next/next/no-img-element -- These previews use browser-local, verified Blob URLs. */
import { useEffect, useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import type { CommandRunner } from "@/src/app-state/command-gateway";
import { isSiteBatch } from "@/src/domain/delivery-flow";
import { actorText } from "@/src/domain/audit";
import { ACCOUNTING_KINDS } from "@/src/domain/accounting-documents";
import type { AccountingDocument, DemoSnapshot } from "@/src/domain/types";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { archiveAccountingDocument, attachAccountingFiles, readAccountingDocument } from "./accounting-files";

export function AccountingDocuments({ poId, batchId }: { poId: string; batchId?: string }) {
  const { snapshot, beginOperation } = useDemo(), { perform, jobs } = useArchive();
  const [kind, setKind] = useState<AccountingDocument["kind"]>("Payment receipt"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [preview, setPreview] = useState<AccountingDocument | null>(null);
  const inProgress = useRef(false);
  if (!snapshot) return null;
  const documents = snapshot.accounting.find(value => value.poId === poId)?.documents?.filter(value => !batchId || value.batchId === batchId) || [];
  const batch = snapshot.batches.find(value => value.id === batchId);
  const canUpload = snapshot.role === "Site Personnel" && !!batch && isSiteBatch(batch) && ["confirmed", "posted"].includes(batch.status);
  const canRetry = ["Site Personnel", "Accounting / Auditing", "Administrator"].includes(snapshot.role);
  const isArchiving = (id: string) => jobs.some(job => job.id === `accounting-${id}` && job.phase !== "complete" && !job.error);
  const archive = async (document: AccountingDocument, state = snapshot, pipeline?: CommandRunner) => perform(`accounting-${document.id}`, document.name, async progress => {
    const target = { kind: "evidence" as const, poId, documentId: document.id };
    const runner = pipeline || await beginOperation(target);
    if (pipeline) { const started = await runner({type:"startOperation",target}); if (!started.ok) throw new Error(started.message); }
    return archiveAccountingDocument(state, poId, document, runner, progress);
  });
  const upload = async (files: File[]) => {
    if (inProgress.current || !batchId) return;
    inProgress.current = true; setBusy(true); setError("");
    try {
      const pipeline = await beginOperation({kind:"attachment",poId,batchId});
      const saved = await attachAccountingFiles(snapshot, poId, batchId, files, kind, pipeline);
      const results = await Promise.allSettled(saved.documents.map(document => archive(document, saved.snapshot, pipeline)));
      const failed = results.filter(result => result.status === "rejected").length;
      if (failed) setError(`${failed} file archive${failed === 1 ? " needs" : "s need"} retry. The evidence remains available for retry.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The evidence could not be saved."); }
    finally { inProgress.current = false; setBusy(false); }
  };
  return <section className="panel accounting-evidence" aria-busy={busy}><div className="panel-heading"><div><h2>Accounting documents</h2><p className="helper-note">Receipts and supporting evidence linked to this PO{batch ? ` and ${batch.ref}` : ""}. Accounting reviews these separately from payment entries.</p></div><Badge>{documents.length} files</Badge></div>
    {canUpload && <div className="evidence-upload"><Field label="Document category"><select value={kind} disabled={busy} onChange={event => setKind(event.target.value as AccountingDocument["kind"])}>{ACCOUNTING_KINDS.map(value => <option key={value}>{value}</option>)}</select></Field><label className={`button secondary file-button ${busy ? "is-disabled" : ""}`}>{busy ? "Saving and archiving…" : "Upload receipts or documents"}<input aria-label="Upload accounting documents" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void upload(files); }}/></label><small>PDF or images · 20 MB per file · 45 MB and 12 files per batch</small></div>}
    {!documents.length && <p className="muted">No accounting files uploaded yet.</p>}
    <div className="evidence-files">{documents.map(document => <article className="evidence-file" key={document.id}><div><strong>{document.name}</strong><small>{document.kind} · {snapshot.batches.find(value => value.id === document.batchId)?.ref || "Delivery batch"} · {actorText(document.uploadedBy, document.uploadedByIdentity)}</small><Badge value={document.archive.status === "complete" ? "Complete" : document.archive.error ? "Needs retry" : "Pending"}/></div><div className="button-row"><button className="button secondary" type="button" onClick={() => setPreview(document)}>View file</button>{document.archive.url && <a className="text-link" href={document.archive.url} target="_blank" rel="noopener noreferrer">Open in Drive</a>}{canRetry && document.archive.status !== "complete" && <button className="button secondary" type="button" disabled={busy || isArchiving(document.id)} onClick={async () => { setError(""); try { await archive(document); } catch (cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); } }}>{isArchiving(document.id) ? "Archiving..." : "Retry archive"}</button>}</div>{document.archive.error && <p className="field-error">{document.archive.error}</p>}</article>)}</div>
    <InlineError message={error}/>{preview && <EvidencePreview key={preview.id} state={snapshot} poId={poId} document={preview} onClose={() => setPreview(null)}/>}
  </section>;
}
function EvidencePreview({ state, poId, document, onClose }: { state: DemoSnapshot; poId: string; document: AccountingDocument; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  useEffect(() => {
    let active = true, objectUrl = "";
    readAccountingDocument(state, poId, document).then(blob => { if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Preview unavailable."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [state, poId, document]);
  return <dialog ref={ref} className="document-preview-dialog evidence-preview" aria-labelledby="evidence-preview-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="panel-heading"><h2 id="evidence-preview-title">{document.name}</h2><div className="button-row">{url && <a className="button secondary" href={url} download={document.name}>Download</a>}<button className="button secondary" type="button" onClick={onClose}>Close</button></div></div>{error ? <InlineError message={error}/> : !url ? <p role="status">Loading verified document…</p> : document.mime === "application/pdf" ? <iframe title={document.name} src={url}/> : <img src={url} alt={document.name}/>}</dialog>;
}
