import { archiveLocal } from "../requests/local-archive.ts";
import { archiveReady } from "../../domain/archive-destination.ts";
import type { Command, CommandResult } from "../../domain/commands.ts";
import type { AccountingDocument, DemoSnapshot } from "../../domain/types.ts";
import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import { accountingSignature, ACCOUNTING_MIMES, MAX_ACCOUNTING_BATCH, MAX_ACCOUNTING_FILE } from "../../domain/accounting-documents.ts";
import { newId } from "../../domain/ids.ts";
import { saveGeneratedFile, readQuoteFile, deleteLocalFile } from "../requests/quote-files.ts";
import { workbookDigest } from "../requests/bid-report-files.ts";
import { uploadDocument } from "../requests/archive-purchasing.ts";
type Run = (command: Command) => Promise<CommandResult>;
type Upload = { error?: string; driveFileId?: string; url?: string; ticket?: string; offset?: number };
async function responseJson(response: Response): Promise<Upload> { const value = await response.json() as Upload; if (!response.ok) throw new Error(value.error || "The accounting file request failed."); return value; }

export async function attachAccountingFiles(state: DemoSnapshot, poId: string, batchId: string | undefined, files: File[], kind: AccountingDocument["kind"], run: Run) {
  const existing = state.accounting.find(value => value.poId === poId)?.documents?.filter(value => value.batchId === batchId) || [];
  if (!files.length || files.length + existing.length > 12 || files.some(file => file.size < 12 || file.size > MAX_ACCOUNTING_FILE || !ACCOUNTING_MIMES.some(mime => mime === file.type)) || [...files, ...existing].reduce((sum, value) => sum + value.size, 0) > MAX_ACCOUNTING_BATCH) throw new Error("Use up to 12 PDF, JPG, PNG or WebP files, at most 20 MB each and 45 MB per batch.");
  for (const file of files) if (!accountingSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) throw new Error(`${file.name} does not match its PDF or image type.`);
  const documents: Pick<AccountingDocument, "name" | "kind" | "mime" | "size" | "localFileId" | "sha256">[] = [];
  const written: string[] = [];
  try {
    for (const file of files) {
      const localFileId = newId("accounting-file");
      await saveGeneratedFile(localFileId, file); written.push(localFileId);
      documents.push({ name: file.name, kind, mime: file.type as AccountingDocument["mime"], size: file.size, localFileId, sha256: await workbookDigest(file) });
    }
    const result = await run({ type: "attachAccountingDocuments", poId, batchId, documents });
    if (!result.ok) throw new Error(result.message);
    return { snapshot: result.snapshot, documents: result.snapshot.accounting.find(value => value.poId === poId)!.documents!.filter(value => written.includes(value.localFileId)) };
  } catch (cause) { await Promise.allSettled(written.map(deleteLocalFile)); throw cause; }
}
export async function archiveAccountingDocument(state: DemoSnapshot, poId: string, document: AccountingDocument, run: Run, progress?: ArchiveProgressListener) {
  if (document.archive.status === "complete") return;
  try {
    progress?.({ phase: "preparing" });
    const po = state.pos.find(value => value.id === poId), batch = state.batches.find(value => value.id === document.batchId), mrf = state.requests.find(value => value.id === po?.mrfId), site = state.sites.find(value => value.id === mrf?.siteId);
    if (!po || document.batchId && (!batch || batch.poId !== poId) || !mrf || !site || !archiveReady(site)) throw new Error("Map this project's Google Drive folder before archiving the evidence.");
    const blob = await readQuoteFile(document.localFileId);
    if (!blob || await workbookDigest(blob) !== document.sha256) throw new Error("The original evidence file is unavailable or changed. Attach it again as new evidence.");
    if (site.localArchiveId) {
      const local = await archiveLocal(site, blob);
      const saved = await run({ type: "completeAccountingArchive", poId, documentId: document.id, fileId: local.fileId, url: local.url });
      if (!saved.ok) throw new Error(saved.message);
      return;
    }
    const start = await responseJson(await fetch("/api/drive/accounting-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, po, batch, mrf, projectFolderId: site.driveFolderId }) }));
    const finish = start.driveFileId && start.url ? start : start.ticket && Number.isInteger(start.offset) ? await uploadDocument(blob, start.ticket, start.offset!, "/api/drive/accounting-documents/chunk", progress) : undefined;
    if (!finish?.driveFileId || !finish.url) throw new Error("Drive did not confirm the evidence upload.");
    const saved = await run({ type: "completeAccountingArchive", poId, documentId: document.id, fileId: finish.driveFileId, url: finish.url });
    if (!saved.ok) throw new Error(saved.message);
    progress?.({ phase: "complete" });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Accounting evidence archive failed.";
    await run({ type: "failAccountingArchive", poId, documentId: document.id, error }); throw cause;
  }
}
export async function readAccountingDocument(state: DemoSnapshot, poId: string, document: AccountingDocument) {
  let blob: Blob | undefined;
  try { blob = await readQuoteFile(document.localFileId); } catch {}
  if (blob && await workbookDigest(blob) === document.sha256) return blob;
  const po = state.pos.find(value => value.id === poId), mrf = state.requests.find(value => value.id === po?.mrfId), site = state.sites.find(value => value.id === mrf?.siteId);
  if (site?.localArchiveId) { const copy = document.archive.fileId ? await readQuoteFile(document.archive.fileId) : undefined; if (copy && await workbookDigest(copy) === document.sha256) return copy; throw new Error("The local archived copy is unavailable. Attach the document again."); }
  if (document.archive.status !== "complete" || !document.archive.fileId || !mrf || !site || !archiveReady(site)) throw new Error("The file is unavailable and has no completed Drive copy.");
  const query = new URLSearchParams({ projectFolderId: site.driveFolderId!, requestId: mrf.id, poId, batchId: document.batchId || "", documentId: document.id, fileId: document.archive.fileId });
  const response = await fetch(`/api/drive/accounting-documents?${query}`);
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || "The evidence could not be restored."); }
  blob = await response.blob();
  if (await workbookDigest(blob) !== document.sha256) throw new Error("The Drive copy no longer matches this accounting document.");
  try { await saveGeneratedFile(document.localFileId, blob); } catch {}
  return blob;
}
