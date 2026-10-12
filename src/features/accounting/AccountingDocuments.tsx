"use client";
import { DocumentLoading } from "@/src/components/ui/Skeleton";
import { LoadingImage } from "@/src/components/ui/LoadingImage";
import { useEffect, useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import type { CommandRunner } from "@/src/app-state/command-gateway";
import { FileUpload } from "@/src/components/ui/FileUpload";
import { CloseButton } from "@/src/components/ui/CloseButton";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { canAttachDelivery, deliveryEvidenceStatus, receivedDelivery } from "@/src/domain/delivery-archive";
import { legLabel } from "@/src/domain/delivery-flow";
import { DeliveryReceiptArchive } from "../deliveries/DeliveryReceiptArchive";
import { actorText } from "@/src/domain/audit";
import { ACCOUNTING_KINDS } from "@/src/domain/accounting-documents";
import type { AccountingDocument, DemoSnapshot } from "@/src/domain/types";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { archiveAccountingDocument, attachAccountingFiles, readAccountingDocument } from "./accounting-files";

export function AccountingDocuments({ poId, batchId }: { poId: string; batchId?: string }) {
  const { snapshot, beginOperation, run } = useDemo(), { perform, jobs } = useArchive();
  const { notify, update } = useActionFeedback();
  const [kind, setKind] = useState<AccountingDocument["kind"]>(batchId ? "Signed delivery receipt" : "Invoice"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [preview, setPreview] = useState<AccountingDocument | null>(null);
  const [selectedBatch, setSelectedBatch] = useState(batchId || "");
  const inProgress = useRef(false);
  if (!snapshot) return null;
  const documents = snapshot.accounting.find(value => value.poId === poId)?.documents?.filter(value => !batchId || value.batchId === batchId) || [];
  const batch = snapshot.batches.find(value => value.id === batchId);
  const accounting = snapshot.role === "Accounting / Auditing";
  const attachmentBatch = batchId || selectedBatch || undefined;
  const batches = snapshot.batches.filter(value => value.poId === poId && receivedDelivery(value));
  const canUpload = canAttachDelivery(snapshot, poId, attachmentBatch, snapshot.role);
  const canRetry = ["Site Personnel", "Procurement", "Accounting / Auditing", "Administrator"].includes(snapshot.role);
  const isArchiving = (id: string) => jobs.some(job => job.id === `accounting-${id}` && job.phase !== "complete" && !job.error);
  const archive = async (document: AccountingDocument, state = snapshot, pipeline?: CommandRunner) => perform(`accounting-${document.id}`, document.name, async progress => {
    const target = { kind: "evidence" as const, poId, documentId: document.id };
    const runner = pipeline || await beginOperation(target);
    if (pipeline) { const started = await runner({type:"startOperation",target}); if (!started.ok) throw new Error(started.message); }
    return archiveAccountingDocument(state, poId, document, runner, progress);
  });
  const upload = async (files: File[]) => {
    if (inProgress.current || !canUpload) return;
    inProgress.current = true; setBusy(true); setError("");
    const toast = notify({ tone: "progress", title: "Uploading and archiving documents…", detail: `${files.length} file${files.length === 1 ? "" : "s"} · ${kind}` });
    try {
      const pipeline = await beginOperation({kind:"attachment",poId,batchId:attachmentBatch});
      const saved = await attachAccountingFiles(snapshot, poId, attachmentBatch, files, kind, pipeline);
      const results = await Promise.allSettled(saved.documents.map(document => archive(document, saved.snapshot, pipeline)));
      const failed = results.filter(result => result.status === "rejected").length;
      if (failed) { const text = `${failed} file archive${failed === 1 ? " needs" : "s need"} retry. The evidence remains available for retry.`; setError(text); update(toast, { tone: "warning", title: "Documents saved, but some archives need retry.", detail: `${failed} of ${saved.documents.length} file${saved.documents.length === 1 ? "" : "s"}` }); }
      else update(toast, { tone: "success", title: "Documents uploaded and archived.", detail: `${saved.documents.length} file${saved.documents.length === 1 ? "" : "s"} · ${kind}` });
    } catch (cause) { const text = cause instanceof Error ? cause.message : "The evidence could not be saved."; setError(text); update(toast, { tone: "error", title: text }); }
    finally { inProgress.current = false; setBusy(false); }
  };
  const renderFile = (document: AccountingDocument) => <article className="evidence-file qa-document-record" key={document.id}>
    <div><strong>{document.name}</strong><small>{document.kind}{document.receiptVersion ? ` / receipt v${document.receiptVersion}` : ""} / {actorText(document.uploadedBy, document.uploadedByIdentity)}</small><Badge value={document.archive.status === "complete" ? "Complete" : document.archive.error ? "Needs retry" : "Pending"}/>
      {accounting && <Field label={`Category for ${document.name}`}><select aria-label={`Category for ${document.name}`} value={document.kind} disabled={busy} onChange={async event => { const result = await run({ type: "classifyAccountingDocument", poId, documentId: document.id, kind: event.target.value as AccountingDocument["kind"], batchId: document.batchId }); setError(result.ok ? "" : result.message); }}>{ACCOUNTING_KINDS.filter(value => document.batchId || value !== "Signed delivery receipt").map(value => <option key={value}>{value}</option>)}</select></Field>}
    </div>
    <div className="button-row"><button className="button secondary" type="button" onClick={() => setPreview(document)}>View file</button>{document.archive.url && <a className="text-link" href={document.archive.url} target="_blank" rel="noopener noreferrer">Open in Drive</a>}{canRetry && document.archive.status !== "complete" && <button className="button secondary" type="button" disabled={busy || isArchiving(document.id)} onClick={async () => { setError(""); const toast = notify({ tone: "progress", title: "Retrying the Drive archive…", detail: document.name }); try { await archive(document); update(toast, { tone: "success", title: "Archived to Google Drive.", detail: document.name }); } catch (cause) { const text = cause instanceof Error ? cause.message : "Archive needs retry."; setError(text); update(toast, { tone: "error", title: text, detail: document.name }); } }}>{isArchiving(document.id) ? "Archiving…" : "Retry archive"}</button>}</div>
    {document.archive.error && <p className="field-error">{document.archive.error}</p>}
  </article>;
  const poDocuments = documents.filter(document => !document.batchId);
  return <section className="panel accounting-evidence" id={batchId ? "delivery-documents" : "accounting-documents"} aria-busy={busy}>
    <div className="panel-heading"><div><h2>{batch ? "Delivery documents" : "Accounting documents"}</h2><p className="helper-note">Receiving teams capture delivery evidence. Accounting adds missing paperwork and reviews completeness.</p></div><Badge>{documents.length} files</Badge></div>
    {canUpload && <div className="evidence-upload">
      {accounting && !batchId && <Field label="Link documents to"><select aria-label="Document delivery association" value={selectedBatch} disabled={busy} onChange={event => { setSelectedBatch(event.target.value); if (!event.target.value && kind === "Signed delivery receipt") setKind("Invoice"); }}><option value="">PO documents / no delivery batch</option>{batches.map(value => <option key={value.id} value={value.id}>{value.ref} / {legLabel(value)}</option>)}</select></Field>}
      <Field label="Document category"><select value={kind} disabled={busy} onChange={event => setKind(event.target.value as AccountingDocument["kind"])}>{ACCOUNTING_KINDS.filter(value => attachmentBatch || value !== "Signed delivery receipt").map(value => <option key={value}>{value}</option>)}</select></Field>
      <FileUpload label="Upload accounting documents" hint="Drop PDFs or images here · 20 MB per file · 45 MB and 12 files per group. Files archive to the project Drive folder." accept=".pdf,.jpg,.jpeg,.png,.webp" busy={busy} onFiles={files => void upload(files)}/>

    </div>}
    {!batchId && poDocuments.length > 0 && <div className="delivery-evidence-group"><h3>PO documents</h3><div className="evidence-files">{poDocuments.map(renderFile)}</div></div>}
    {(batch ? [batch] : batches).map(delivery => {
      const files = documents.filter(document => document.batchId === delivery.id), version = delivery.receiptVersions?.at(-1)?.version;
      const signed = deliveryEvidenceStatus(snapshot, delivery).signedArchived;
      const currentFiles = files.filter(document => !document.receiptVersion || document.receiptVersion === version);
      const earlierFiles = files.filter(document => !!document.receiptVersion && document.receiptVersion !== version);
      return <details className="delivery-evidence-group" key={delivery.id} open={!!batchId || batches.length <= 2}>
        <summary><span><strong>{delivery.ref}</strong><small>{legLabel(delivery)} / {files.length} uploaded files</small></span><Badge>{signed ? "Signed receipt archived" : "Signed receipt needed"}</Badge><span className="section-chevron" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m6 9 6 6 6-6"/></svg></span></summary>
        <DeliveryReceiptArchive batch={delivery}/>
        {!signed && <p className="helper-note">Upload a signed delivery receipt for the current quantities. Accounting checks its signature and contents.</p>}
        <h4 className="subheading">Uploaded evidence</h4><div className="evidence-files">{currentFiles.map(renderFile)}</div>{earlierFiles.length > 0 && <details className="receipt-history"><summary>Earlier uploaded receipt versions ({earlierFiles.length})</summary>{earlierFiles.map(renderFile)}</details>}
      </details>;
    })}
    {!documents.length && !batches.length && <p className="muted">No documents or confirmed deliveries yet.</p>}
    {!batchId && !!snapshot.pos.find(value => value.id === poId)?.paymentProofs?.length && <div className="delivery-evidence-group"><h3>Payment proofs</h3><p className="helper-note">Already attached through payment verification; no duplicate upload needed.</p>{snapshot.pos.find(value => value.id === poId)!.paymentProofs!.map(proof => <div className="payment-proof-row" key={proof.id}><strong>{proof.name}</strong>{proof.archive.url ? <a className="text-link" href={proof.archive.url} target="_blank" rel="noreferrer">Open proof</a> : <Badge>Archive pending</Badge>}</div>)}</div>}
    <InlineError message={error}/>{preview && <EvidencePreview key={preview.id} state={snapshot} poId={poId} document={preview} onClose={() => setPreview(null)}/>}
  </section>;
}
function EvidencePreview({ state, poId, document, onClose }: { state: DemoSnapshot; poId: string; document: AccountingDocument; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  // A preview reads one document snapshot; unrelated workspace updates don't restart it.
  const [source] = useState({ state, poId, document });
  const ref = useRef<HTMLDialogElement>(null), [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  useEffect(() => {
    let active = true, objectUrl = "";
    readAccountingDocument(source.state, source.poId, source.document).then(blob => { if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); setBlob(blob); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Preview unavailable."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);
  return <dialog ref={ref} className="document-preview-dialog evidence-preview" aria-labelledby="evidence-preview-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="panel-heading"><h2 id="evidence-preview-title">{document.name}</h2><div className="button-row">{url && <a className="button secondary" href={url} download={document.name}>Download</a>}<CloseButton onClick={onClose}/></div></div>{error ? <InlineError message={error}/> : !url ? <DocumentLoading/> : document.mime === "application/pdf" ? blob && <PdfDocumentViewer key={url} blob={blob} fileName={document.name} sourceUrl={url}/> : <LoadingImage key={url} src={url} alt={document.name}/>}</dialog>;
}
