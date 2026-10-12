"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { Badge, InlineError } from "@/src/components/ui/Primitives";
import type { DemoSnapshot, StockTransfer, TransferDelivery, TransferEvidence } from "@/src/domain/types";
import { archiveTransferEvidence, archiveTransferReceipt, attachTransferFiles, readTransferEvidence } from "./transfer-files";

export function TransferDocuments({ state, transfer, delivery }: { state: DemoSnapshot; transfer: StockTransfer; delivery: TransferDelivery }) {
  const { beginOperation, siteIds } = useDemo();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [kind, setKind] = useState<TransferEvidence["kind"]>("Signed delivery receipt");
  const [preview, setPreview] = useState<{ document: TransferEvidence; blob: Blob; url: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const eligible = ["Accounting / Auditing", "Administrator"].includes(state.role) || state.role === "Site Personnel" && siteIds.includes(transfer.destinationSiteId);
  const canUpload = eligible && state.role !== "Administrator";
  const documents = transfer.documents?.filter(doc => doc.deliveryId === delivery.id) || [];
  async function archive(receiptId: string) {
    if (busy) return; setBusy(true); setError("");
    try { await archiveTransferReceipt(state, delivery.id, receiptId, await beginOperation({ kind: "transfer-receipt", deliveryId: delivery.id, receiptId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); } finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    if (busy || !files.length) return; setBusy(true); setError("");
    try {
      const pipeline = await beginOperation({ kind: "transfer-attachment", transferId: transfer.id, deliveryId: delivery.id });
      const saved = await attachTransferFiles(state, transfer.id, delivery.id, files, kind, pipeline);
      for (const doc of saved.documents) await archiveTransferEvidence(saved.snapshot, transfer.id, doc, pipeline);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence remains saved; archive needs retry."); } finally { setBusy(false); }
  }
  async function retry(doc: TransferEvidence) {
    if (busy) return; setBusy(true); setError("");
    try { await archiveTransferEvidence(state, transfer.id, doc, await beginOperation({ kind: "transfer-evidence", transferId: transfer.id, documentId: doc.id })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence archive needs retry."); } finally { setBusy(false); }
  }
  async function view(doc: TransferEvidence) {
    if (busy) return; setBusy(true); setError("");
    try { const blob = await readTransferEvidence(state, transfer.id, doc); setPreview({ document: doc, blob, url: URL.createObjectURL(blob) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence cannot be opened."); } finally { setBusy(false); }
  }
  return <div className="subform" aria-busy={busy}><h4>Transfer receipt and evidence</h4>
    {(delivery.receiptVersions || []).map(receipt => <div key={receipt.id} className="data-link"><span>Generated receipt · v{receipt.version}<Badge>{receipt.archive.status === "complete" ? "Archived" : receipt.archive.error ? "Needs retry" : "Pending archive"}</Badge></span><div className="transfer-actions">{receipt.archive.url && <a className="text-link" href={receipt.archive.url} target="_blank" rel="noreferrer">Open receipt</a>}{eligible && receipt.archive.status !== "complete" && <button type="button" className="button secondary" disabled={busy} onClick={() => void archive(receipt.id)}>Retry receipt archive</button>}</div></div>)}
    {documents.map(doc => <div key={doc.id} className="data-link"><span>{doc.name}<small>{doc.kind}{doc.receiptVersion ? " · v" + doc.receiptVersion : ""}</small><Badge>{doc.archive.status === "complete" ? "Archived" : "Needs archive"}</Badge></span><div className="transfer-actions"><button type="button" className="text-link" disabled={busy} onClick={() => void view(doc)}>View</button>{eligible && doc.archive.status !== "complete" && <button type="button" className="button secondary" disabled={busy} onClick={() => void retry(doc)}>Retry evidence archive</button>}</div></div>)}
    {canUpload && <div className="transfer-actions"><select aria-label="Transfer evidence type" value={kind} disabled={busy} onChange={event => setKind(event.target.value as TransferEvidence["kind"])}><option>Signed delivery receipt</option><option>Other</option></select><label className="button secondary">{busy ? "Saving documents…" : "Upload evidence"}<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy} className="sr-only" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void upload(files); }}/></label></div>}
    <InlineError message={error}/>
    <RecordModal open={!!preview} title={preview?.document.name || "Transfer evidence"} onClose={() => setPreview(null)}>{preview && (preview.document.mime === "application/pdf" ? <PdfDocumentViewer blob={preview.blob} fileName={preview.document.name} sourceUrl={preview.url}/> : <Image unoptimized src={preview.url} width={960} height={640} style={{ width: "100%", height: "auto", objectFit: "contain" }} alt={preview.document.name}/>)}</RecordModal>
  </div>;
}
