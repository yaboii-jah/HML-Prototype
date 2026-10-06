import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import type { Command, CommandResult } from "@/src/domain/commands";
import type { DemoSnapshot, PO, Quote } from "@/src/domain/types";
import { readQuoteFile } from "./quote-files.ts";

type Run = (command: Command) => Promise<CommandResult>;
type UploadResponse = { error?: string; ticket?: string; offset?: number; driveFileId?: string; fileId?: string; url?: string };
const CHUNK = 3 * 1024 * 1024;

async function responseJson(response: Response): Promise<UploadResponse> {
  const result = await response.json() as UploadResponse;
  if (!response.ok) throw new Error(result.error || "Google Drive did not accept the archive.");
  return result;
}

export async function uploadDocument(blob: Blob, ticket: string, firstOffset: number, endpoint = "/api/drive/quotes/chunk", progress?: ArchiveProgressListener) {
  let offset = firstOffset;
  progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  let stalled = 0;
  while (offset < blob.size) {
    const size = Math.min(CHUNK, blob.size - offset);
    let result: UploadResponse;
    let response: Response | undefined;
    try { response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-drive-upload-ticket": ticket, "x-drive-upload-offset": String(offset) }, body: blob.slice(offset, offset + size) }); } catch {}
    if (response?.ok || response && response.status < 500) result = await responseJson(response);
    else result = await responseJson(await fetch(endpoint, { method: "POST", headers: { "x-drive-upload-ticket": ticket } }));
    if (result.driveFileId && result.url) { progress?.({ phase: "uploading", loaded: blob.size, total: blob.size }); return result; }
    if (!Number.isInteger(result.offset) || result.offset! < 0 || result.offset! > blob.size) throw new Error("Drive returned an invalid upload position.");
    stalled = result.offset === offset ? stalled + 1 : 0;
    if (stalled > 2) throw new Error("The document upload did not advance. Retry the archive.");
    offset = result.offset!;
    progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  }
  const result = await responseJson(await fetch(endpoint, { method: "POST", headers: { "x-drive-upload-ticket": ticket } }));
  if (!result.driveFileId || !result.url) throw new Error("Drive did not confirm the document upload.");
  return result;
}

export async function syncFinalizedQuote(state: DemoSnapshot, quote: Quote, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const mrf = state.requests.find(value => value.id === quote.mrfId);
    const site = state.sites.find(value => value.id === mrf?.siteId);
    if (!mrf || !site?.driveFolderId || quote.archive?.status !== "pending") throw new Error("The quotation or mapped project Drive folder is missing.");
    const previous = state.quotes.find(value => value.id === quote.supersedesId);
    const files = [];
    for (const [index, document] of quote.documents.entries()) {
      if (!document.fileId) throw new Error("Attach the supplier's original quotation document.");
      const reused = previous?.archive?.status === "complete" ? previous.archive.files.find(value => value.localFileId === document.fileId) : undefined;
      if (reused) { files.push(reused); continue; }
      const blob = await readQuoteFile(document.fileId);
      if (!blob) throw new Error(`The original quotation file ${document.name} is unavailable. Create a revision and attach it again.`);
      const start = await responseJson(await fetch("/api/drive/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote, mrf, projectFolderId: site.driveFolderId, index, size: blob.size }) }));
      const result = start.driveFileId && start.url ? start : start.ticket && Number.isInteger(start.offset) ? await uploadDocument(blob, start.ticket, start.offset!, "/api/drive/quotes/chunk", value => progress?.({ ...value, fileIndex: index + 1, fileCount: quote.documents.length })) : undefined;
      if (!result?.driveFileId || !result.url) throw new Error("Drive did not confirm the quotation file.");
      files.push({ localFileId: document.fileId, driveFileId: result.driveFileId, url: result.url, name: document.name });
    }
    const saved = await run({ type: "completeQuoteArchive", id: quote.id, files });
    if (!saved.ok) throw new Error(saved.message);
    return { ok: true, message: saved.message };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Quotation Drive archive failed.";
    await run({ type: "failQuoteArchive", id: quote.id, error: message });
    return { ok: false, message };
  }
}

export async function syncApprovedPO(state: DemoSnapshot, po: PO, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const mrf = state.requests.find(value => value.id === po.mrfId);
    const quote = state.quotes.find(value => value.id === po.quoteId);
    const site = state.sites.find(value => value.id === mrf?.siteId);
    if (!mrf || !quote || !site?.driveFolderId || po.archive?.status !== "pending") throw new Error("The PO or mapped project Drive folder is missing.");
    const result = await responseJson(await fetch("/api/drive/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ po, mrf, quote, projectFolderId: site.driveFolderId, projectName: site.name }) }));
    if (!result.fileId || !result.url) throw new Error("Drive did not confirm the PO PDF.");
    const saved = await run({ type: "completePOArchive", id: po.id, fileId: result.fileId, url: result.url });
    if (!saved.ok) throw new Error(saved.message);
    return { ok: true, message: saved.message };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "PO Drive archive failed.";
    await run({ type: "failPOArchive", id: po.id, error: message });
    return { ok: false, message };
  }
}
