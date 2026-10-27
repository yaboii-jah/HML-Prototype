import type { ArchiveProgressListener } from "../domain/archive-progress.ts";

export type UploadResponse = { error?: string; offset?: number; ticket?: string; driveFileId?: string; fileId?: string; url?: string; formFileId?: string; formUrl?: string; supportFileId?: string; supportUrl?: string };

export async function uploadResponse(response: Response): Promise<UploadResponse> {
  const result = await response.json() as UploadResponse;
  if (!response.ok) throw new Error(result.error || "Google Drive did not accept the archive.");
  return result;
}

export function requestUploadComplete(result: UploadResponse): result is UploadResponse & Required<Pick<UploadResponse, "formFileId" | "formUrl" | "supportFileId" | "supportUrl">> {
  return !!(result.formFileId && result.formUrl && result.supportFileId && result.supportUrl);
}

/** Owns retry/status recovery for both single-document and paired MRF uploads. */
export async function uploadDocument(blob: Blob, ticket: string, firstOffset: number, endpoint = "/api/drive/quotes/chunk", progress?: ArchiveProgressListener) {
  if (!Number.isInteger(firstOffset) || firstOffset < 0 || firstOffset > blob.size) throw new Error("Drive returned an invalid upload position.");
  const paired = endpoint === "/api/drive/archive/chunk";
  const complete = (result: UploadResponse) => paired ? requestUploadComplete(result) : !!(result.driveFileId && result.url);
  const status = () => fetch(endpoint, { method: "POST", headers: { "x-drive-upload-ticket": ticket } }).then(uploadResponse);
  let offset = firstOffset, stalled = 0;
  progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  while (offset < blob.size) {
    let response: Response | undefined;
    try {
      response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-drive-upload-ticket": ticket, "x-drive-upload-offset": String(offset) }, body: blob.slice(offset, offset + 3 * 1024 * 1024) });
    } catch { /* The server may have accepted the chunk; query the acknowledged offset. */ }
    const result = response && response.status < 500 ? await uploadResponse(response) : await status();
    if (complete(result)) {
      progress?.({ phase: "uploading", loaded: blob.size, total: blob.size });
      return result;
    }
    if (!Number.isInteger(result.offset) || result.offset! < offset || result.offset! > blob.size) throw new Error("Drive returned an invalid upload position.");
    stalled = result.offset === offset ? stalled + 1 : 0;
    if (stalled > 2) throw new Error("The document upload did not advance. Retry the archive.");
    offset = result.offset!;
    progress?.({ phase: "uploading", loaded: offset, total: blob.size });
  }
  const result = await status();
  if (!complete(result)) throw new Error("Drive did not confirm the document upload.");
  progress?.({ phase: "uploading", loaded: blob.size, total: blob.size });
  return result;
}
