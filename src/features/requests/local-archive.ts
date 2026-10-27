import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import { localArchiveUrl } from "../../domain/archive-destination.ts";
import type { Site } from "../../domain/types.ts";
import { saveGeneratedFile } from "../../documents/files.ts";

export async function previewPdf(data: unknown): Promise<Blob> {
  const response = await fetch("/api/documents/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || "The document could not be generated."); }
  return response.blob();
}
export async function archiveLocal(site: Site, blob: Blob, progress?: ArchiveProgressListener) {
  if (!site.localArchiveId) throw new Error("This project has no local archive destination.");
  const fileId = `local-${site.localArchiveId}-${crypto.randomUUID()}`;
  progress?.({ phase: "uploading", loaded: 0, total: blob.size });
  await saveGeneratedFile(fileId, blob);
  progress?.({ phase: "uploading", loaded: blob.size, total: blob.size });
  return { fileId, driveFileId: fileId, url: localArchiveUrl(fileId) };
}
