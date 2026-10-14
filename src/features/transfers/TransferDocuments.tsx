"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { FileUpload } from "@/src/components/ui/FileUpload";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import type { DemoSnapshot, StockTransfer, TransferDelivery, TransferEvidence } from "@/src/domain/types";
import { archiveTransferEvidence, archiveTransferReceipt, attachTransferFiles, readTransferEvidence } from "./transfer-files";

export function TransferDocuments({ state, transfer, delivery }: { state: DemoSnapshot; transfer: StockTransfer; delivery: TransferDelivery }) {
  const { beginOperation, siteIds } = useDemo();
  const { perform,jobs } = useArchive();
  const [operation,setOperation] = useState<{ kind:"upload"|"archive"|"view";id?:string } | null>(null), [error,setError] = useState("");
  const working = useRef(false);
  const [kind,setKind] = useState<TransferEvidence["kind"]>("Signed delivery receipt");
  const [preview,setPreview] = useState<{ document:TransferEvidence;blob:Blob;url:string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); },[preview]);
  const eligible = ["Accounting / Auditing","Administrator"].includes(state.role) || state.role === "Site Personnel" && siteIds.includes(transfer.destinationSiteId);
  const canUpload = eligible && state.role !== "Administrator";
  const documents = transfer.documents?.filter(doc => doc.deliveryId === delivery.id) || [];
  const activeJob = (id:string) => jobs.find(job => job.id === id && job.phase !== "complete" && !job.error);
  const archiveActive = (delivery.receiptVersions || []).some(receipt => activeJob("transfer-receipt-"+receipt.id)) || documents.some(doc => activeJob("transfer-evidence-"+doc.id));
  const busy = !!operation || archiveActive;
  function start(kind:"upload"|"archive"|"view",id?:string) {
    if (working.current || busy) return false;
    working.current = true;setOperation({kind,id});setError("");return true;
  }
  function finish() { working.current = false;setOperation(null); }
  async function archive(receiptId:string) {
    if (!start("archive",receiptId)) return;
    try {
      const pipeline = await beginOperation({kind:"transfer-receipt",deliveryId:delivery.id,receiptId});
      const receipt = delivery.receiptVersions?.find(value => value.id === receiptId);
      await perform("transfer-receipt-"+receiptId,delivery.ref+": receipt v"+receipt?.version,progress => archiveTransferReceipt(state,delivery.id,receiptId,pipeline,progress));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); } finally { finish(); }
  }
  async function upload(files:File[]) {
    if (!files.length || !start("upload")) return;
    try {
      const pipeline = await beginOperation({kind:"transfer-attachment",transferId:transfer.id,deliveryId:delivery.id});
      const saved = await attachTransferFiles(state,transfer.id,delivery.id,files,kind,pipeline);
      for (const [index,doc] of saved.documents.entries()) {
        await perform("transfer-evidence-"+doc.id,doc.name,progress => archiveTransferEvidence(saved.snapshot,transfer.id,doc,pipeline,value => progress({...value,fileIndex:index+1,fileCount:saved.documents.length})));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence remains saved; archive needs retry."); } finally { finish(); }
  }
  async function retry(doc:TransferEvidence) {
    if (!start("archive",doc.id)) return;
    try {
      const pipeline = await beginOperation({kind:"transfer-evidence",transferId:transfer.id,documentId:doc.id});
      await perform("transfer-evidence-"+doc.id,doc.name,progress => archiveTransferEvidence(state,transfer.id,doc,pipeline,progress));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence archive needs retry."); } finally { finish(); }
  }
  async function view(doc:TransferEvidence) {
    if (!start("view",doc.id)) return;
    try { const blob = await readTransferEvidence(state,transfer.id,doc);setPreview({document:doc,blob,url:URL.createObjectURL(blob)}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence cannot be opened."); } finally { finish(); }
  }
  return <div className="transfer-documents subform" aria-busy={archiveActive || operation?.kind === "upload" || operation?.kind === "archive"}>
    <h3>Transfer receipt and evidence</h3>
    <div className="transfer-document-list">
      {(delivery.receiptVersions || []).map(receipt => {
        const job = activeJob("transfer-receipt-"+receipt.id);
        return <div key={receipt.id} className="qa-document-record transfer-document-row" aria-busy={!!job}>
          <div className="transfer-document-copy"><strong>Generated receipt · v{receipt.version}</strong><Badge>{job ? "Archiving" : receipt.archive.status === "complete" ? "Archived" : receipt.archive.error ? "Needs retry" : "Pending archive"}</Badge>
            {job && <span className="qa-upload-status" role="status"><span className="qa-spinner" aria-hidden="true"/>Archiving receipt to Google Drive…</span>}
            {receipt.archive.error && !job && <p className="field-error">{receipt.archive.error}</p>}
          </div>
          <div className="transfer-actions transfer-document-actions">{receipt.archive.url && <a className="button secondary" href={receipt.archive.url} target="_blank" rel="noreferrer">Open receipt</a>}{eligible && receipt.archive.status !== "complete" && <button type="button" className="button secondary" disabled={busy} onClick={() => void archive(receipt.id)}>{job ? "Archiving…" : "Retry receipt archive"}</button>}</div>
        </div>;
      })}
      {documents.map(doc => {
        const job = activeJob("transfer-evidence-"+doc.id);
        return <div key={doc.id} className="qa-document-record transfer-document-row" aria-busy={!!job}>
          <div className="transfer-document-copy"><strong>{doc.name}</strong><small>{doc.kind}{doc.receiptVersion ? " · v"+doc.receiptVersion : ""} · {Math.max(1,Math.round(doc.size/1024))} KB</small><Badge>{job ? "Archiving" : doc.archive.status === "complete" ? "Archived" : doc.archive.error ? "Needs retry" : "Pending archive"}</Badge>
            {job && <span className="qa-upload-status" role="status"><span className="qa-spinner" aria-hidden="true"/>Archiving file to Google Drive…</span>}
            {doc.archive.error && !job && <p className="field-error">{doc.archive.error}</p>}
          </div>
          <div className="transfer-actions transfer-document-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void view(doc)}>{operation?.kind === "view" && operation.id === doc.id ? "Opening…" : "View"}</button>{eligible && doc.archive.status !== "complete" && <button type="button" className="button secondary" disabled={busy} onClick={() => void retry(doc)}>{job ? "Archiving…" : "Retry evidence archive"}</button>}</div>
        </div>;
      })}
    </div>
    {canUpload && <div className="transfer-upload">
      <Field label="Document type"><select aria-label="Transfer evidence type" value={kind} disabled={busy} onChange={event => setKind(event.target.value as TransferEvidence["kind"])}><option>Signed delivery receipt</option><option>Other</option></select></Field>
      <FileUpload label={kind === "Signed delivery receipt" ? "Upload signed delivery receipts" : "Upload supporting evidence"} hint="PDF, JPG, PNG or WebP · 20 MB each · Up to 12 files and 45 MB per trip." accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={busy} busy={operation?.kind === "upload"} onFiles={files => void upload(files)}/>
    </div>}
    <InlineError message={error}/>
    <RecordModal open={!!preview} title={preview?.document.name || "Transfer evidence"} onClose={() => setPreview(null)}>{preview && (preview.document.mime === "application/pdf" ? <PdfDocumentViewer blob={preview.blob} fileName={preview.document.name} sourceUrl={preview.url}/> : <Image unoptimized src={preview.url} width={960} height={640} style={{width:"100%",height:"auto",objectFit:"contain"}} alt={preview.document.name}/>)}</RecordModal>
  </div>;
}
