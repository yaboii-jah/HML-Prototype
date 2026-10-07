import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import type { Command, CommandResult } from "@/src/domain/commands";
import { supportingPdf } from "@/src/domain/request-archive";
import type { MRF, Site } from "@/src/domain/types";
import { readQuoteFile } from "./quote-files";

type Run = (command: Command) => Promise<CommandResult>;
type ArchiveResponse = { error?: string; ticket?: string; offset?: number; formFileId?: string; supportFileId?: string; formUrl?: string; supportUrl?: string };
const CHUNK = 3 * 1024 * 1024;

async function archiveResponse(response: Response) {
  const result = await response.json() as ArchiveResponse;
  if (!response.ok) throw new Error(result.error || "Google Drive did not accept the PDF upload.");
  return result;
}

function complete(result: ArchiveResponse): result is Required<Pick<ArchiveResponse, "formFileId" | "supportFileId" | "formUrl" | "supportUrl">> {
  return !!result.formFileId && !!result.supportFileId && !!result.formUrl && !!result.supportUrl;
}

async function uploadSupportingPdf(blob: Blob, ticket: string, initialOffset: number, progress?: ArchiveProgressListener) {
  let offset = initialOffset;
  progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  let stalled = 0;
  while (offset < blob.size) {
    const length = Math.min(CHUNK, blob.size - offset);
    let result: ArchiveResponse;
    let response: Response | undefined;
    try { response = await fetch("/api/drive/archive/chunk", { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-drive-upload-ticket": ticket, "x-drive-upload-offset": String(offset) }, body: blob.slice(offset, offset + length) }); } catch {}
    if (response?.ok) result = await archiveResponse(response);
    else if (response && response.status < 500) result = await archiveResponse(response);
    else {
      const status = await fetch("/api/drive/archive/chunk", { method: "POST", headers: { "x-drive-upload-ticket": ticket } });
      result = await archiveResponse(status);
    }
    if (complete(result)) { progress?.({ phase: "uploading", loaded: blob.size, total: blob.size }); return result; }
    if (!Number.isInteger(result.offset) || result.offset! < 0 || result.offset! > blob.size) throw new Error("Drive returned an invalid upload position.");
    stalled = result.offset === offset ? stalled + 1 : 0;
    if (stalled > 2) throw new Error("Drive did not advance the upload. Retry the archive from this request.");
    offset = result.offset!;
    progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  }
  const status = await fetch("/api/drive/archive/chunk", { method: "POST", headers: { "x-drive-upload-ticket": ticket } });
  const result = await archiveResponse(status);
  if (!complete(result)) throw new Error("Drive did not confirm the supporting PDF upload.");
  return result;
}

export async function syncApprovedRequest(request: MRF, site: Site, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const document = supportingPdf(request);
    if (!document?.fileId || !site.driveFolderId) throw new Error("The supporting PDF or project Drive folder is missing.");
    const blob = await readQuoteFile(document.fileId);
    if (!blob) throw new Error("The supporting PDF is unavailable. Attach it again.");
    if (blob.size < 5 || blob.size > 50 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-") throw new Error("The supporting PDF is invalid. Replace it before archiving.");
    const response = await fetch("/api/drive/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, projectFolderId: site.driveFolderId, projectName: site.name, projectLocation: site.location, supportSize: blob.size }) });
    const started = await archiveResponse(response);
    const result = complete(started) ? started : started.ticket && Number.isInteger(started.offset) ? await uploadSupportingPdf(blob, started.ticket, started.offset!, progress) : undefined;
    if (!result || !complete(result)) throw new Error("Drive did not confirm both PDF uploads.");
    const saved = await run({ type: "completeRequestArchive", id: request.id, formFileId: result.formFileId, supportFileId: result.supportFileId, formUrl: result.formUrl, supportUrl: result.supportUrl });
    if (!saved.ok) throw new Error(saved.message);
    return { ok: true, message: saved.message };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Google Drive archive failed.";
    await run({ type: "failRequestArchive", id: request.id, error: message });
    return { ok: false, message };
  }
}
