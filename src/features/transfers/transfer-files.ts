import { archiveLocal, previewPdf } from "../requests/local-archive.ts";
import { archiveReady } from "../../domain/archive-destination.ts";
import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import type { Command, CommandResult } from "../../domain/commands.ts";
import type { DemoSnapshot, TransferEvidence } from "../../domain/types.ts";
import { transferReceiptData } from "../../domain/stock-transfers.ts";
import { accountingSignature, ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE, MAX_ACCOUNTING_BATCH } from "../../domain/accounting-documents.ts";
import { archiveFileName } from "../../domain/document-numbering.ts";
import { newId } from "../../domain/ids.ts";
import { saveGeneratedFile, readQuoteFile, deleteLocalFile } from "../requests/quote-files.ts";
import { workbookDigest } from "../requests/bid-report-files.ts";
import { uploadDocument } from "../requests/archive-purchasing.ts";

type Run = (command: Command) => Promise<CommandResult>;
async function json(response: Response) {
  const value = await response.json() as { error?: string; driveFileId?: string; url?: string; ticket?: string; offset?: number };
  if (!response.ok) throw new Error(value.error || "Transfer document request failed.");
  return value;
}
export async function attachTransferFiles(state: DemoSnapshot, transferId: string, deliveryId: string, files: File[], kind: TransferEvidence["kind"], run: Run) {
  const transfer = state.stockTransfers?.find(value => value.id === transferId), delivery = state.transferDeliveries?.find(value => value.id === deliveryId && value.transferId === transferId);
  const existing = transfer?.documents?.filter(value => value.deliveryId === deliveryId) || [];
  if (!delivery || !files.length || files.length + existing.length > 12 || files.some(file => file.size < 12 || file.size > MAX_ACCOUNTING_FILE || !ACCOUNTING_MIMES.some(mime => mime === file.type)) || [...files, ...existing].reduce((sum, file) => sum + file.size, 0) > MAX_ACCOUNTING_BATCH) throw new Error("Use up to 12 PDF/JPG/PNG/WebP files, 20 MB each and 45 MB per trip.");
  for (const file of files) if (!accountingSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) throw new Error(file.name + " does not match its file type.");
  const written: string[] = [], documents: TransferEvidence[] = [];
  try {
    for (const file of files) {
      const id = newId("transfer-evidence"), localFileId = newId("transfer-file");
      await saveGeneratedFile(localFileId, file); written.push(localFileId);
      documents.push({ id, deliveryId, kind, receiptVersion: kind === "Signed delivery receipt" ? delivery.receiptVersions?.at(-1)?.version : undefined, name: file.name, archiveName: archiveFileName(delivery.ref, file.name, id), mime: file.type as TransferEvidence["mime"], size: file.size, localFileId, sha256: await workbookDigest(file), uploadedAt: new Date().toISOString(), uploadedBy: state.role, archive: { status: "pending" } });
    }
    const result = await run({ type: "attachTransferEvidence", transferId, documents });
    if (!result.ok) throw new Error(result.message);
    return { snapshot: result.snapshot, documents: result.snapshot.stockTransfers!.find(value => value.id === transferId)!.documents!.filter(value => written.includes(value.localFileId)) };
  } catch (cause) { await Promise.allSettled(written.map(deleteLocalFile)); throw cause; }
}
export async function archiveTransferEvidence(state: DemoSnapshot, transferId: string, document: TransferEvidence, run: Run, progress?: ArchiveProgressListener) {
  if (document.archive.status === "complete") return;
  progress?.({ phase:"preparing" });
  try {
    const transfer = state.stockTransfers?.find(value => value.id === transferId), delivery = state.transferDeliveries?.find(value => value.id === document.deliveryId && value.transferId === transferId), project = state.sites.find(value => value.id === transfer?.destinationSiteId);
    if (!transfer || !delivery || !project || !archiveReady(project)) throw new Error("Map the destination project's Drive folder before archiving.");
    const blob = await readQuoteFile(document.localFileId);
    if (!blob || blob.size !== document.size || await workbookDigest(blob) !== document.sha256) throw new Error("Original evidence is unavailable or changed. Attach a new copy.");
    const data = document.kind === "Signed delivery receipt" ? delivery.receiptVersions?.find(value => value.version === document.receiptVersion)?.data : transferReceiptData(state, delivery);
    if (!data) throw new Error("The signed receipt's quantity version is unavailable.");
    progress?.({ phase:"uploading",loaded:0,total:blob.size });
    if (project.localArchiveId) {
      const local = await archiveLocal(project, blob, progress);
      const saved = await run({ type: "completeTransferEvidenceArchive", transferId, documentId: document.id, fileId: local.fileId, url: local.url });
      if (!saved.ok) throw new Error(saved.message); return;
    }
    const start = await json(await fetch("/api/drive/transfer-evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, data, projectFolderId: project.driveFolderId }) }));
    const finish = start.driveFileId && start.url ? start : start.ticket && Number.isInteger(start.offset) ? await uploadDocument(blob, start.ticket, start.offset!, "/api/drive/transfer-evidence/chunk",progress) : undefined;
    if (!finish?.driveFileId || !finish.url) throw new Error("Drive did not confirm the evidence upload.");
    progress?.({ phase:"uploading",loaded:blob.size,total:blob.size });
    const result = await run({ type: "completeTransferEvidenceArchive", transferId, documentId: document.id, fileId: finish.driveFileId, url: finish.url });
    if (!result.ok) throw new Error(result.message);
    progress?.({ phase:"complete" });
  } catch (cause) {
    await run({ type: "failTransferEvidenceArchive", transferId, documentId: document.id, error: cause instanceof Error ? cause.message : "Archive needs retry." }); throw cause;
  }
}
export async function readTransferEvidence(state: DemoSnapshot, transferId: string, document: TransferEvidence) {
  let blob: Blob | undefined; try { blob = await readQuoteFile(document.localFileId); } catch {}
  if (blob && blob.size === document.size && await workbookDigest(blob) === document.sha256) return blob;
  const transfer = state.stockTransfers?.find(value => value.id === transferId), project = state.sites.find(value => value.id === transfer?.destinationSiteId);
  if (project?.localArchiveId) { const copy = document.archive.fileId ? await readQuoteFile(document.archive.fileId) : undefined; if (copy && await workbookDigest(copy) === document.sha256) return copy; throw new Error("The local transfer evidence copy is unavailable. Attach it again."); }
  if (!transfer || !project || !archiveReady(project) || !document.archive.fileId) throw new Error("No local or archived copy is available.");
  const query = new URLSearchParams({ projectFolderId: project.driveFolderId!, requestId: transfer.requestId, transferId, deliveryId: document.deliveryId, documentId: document.id, fileId: document.archive.fileId });
  const response = await fetch("/api/drive/transfer-evidence?" + query);
  if (!response.ok) throw new Error((await response.json()).error || "Evidence could not be restored.");
  blob = await response.blob();
  if (blob.size !== document.size || await workbookDigest(blob) !== document.sha256) throw new Error("The restored evidence differs from its original.");
  try { await saveGeneratedFile(document.localFileId, blob); } catch {}
  return blob;
}
export async function archiveTransferReceipt(state: DemoSnapshot, deliveryId: string, receiptId: string, run: Run, progress?: ArchiveProgressListener) {
  const delivery = state.transferDeliveries?.find(value => value.id === deliveryId), receipt = delivery?.receiptVersions?.find(value => value.id === receiptId);
  if (!receipt || receipt.archive.status === "complete") return;
  progress?.({ phase:"preparing" });
  try {
    const project = state.sites.find(value => value.id === receipt.data.project.id);
    if (project?.localArchiveId) {
      const local = await archiveLocal(project, await previewPdf(receipt.data), progress);
      const saved = await run({ type: "completeTransferReceiptArchive", deliveryId, receiptId, fileId: local.fileId, url: local.url });
      if (!saved.ok) throw new Error(saved.message); return;
    }
    const folder = project?.driveFolderId;
    if (!folder) throw new Error("A destination-project Drive folder is required. Receiving remains saved.");
    progress?.({ phase:"uploading" });
    const finish = await json(await fetch("/api/drive/transfer-receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt, projectFolderId: folder }) }));
    if (!finish.driveFileId || !finish.url) throw new Error("Drive did not confirm the receipt archive.");
    const result = await run({ type: "completeTransferReceiptArchive", deliveryId, receiptId, fileId: finish.driveFileId, url: finish.url });
    if (!result.ok) throw new Error(result.message);
    progress?.({ phase:"complete" });
  } catch (cause) {
    await run({ type: "failTransferReceiptArchive", deliveryId, receiptId, error: cause instanceof Error ? cause.message : "Receipt archive needs retry." }); throw cause;
  }
}
