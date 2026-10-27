import { uploadDocument, uploadResponse as archiveResponse, requestUploadComplete as complete } from "../../documents/resumable-upload.ts";
import { archiveLocal, previewPdf } from "./local-archive.ts";
import { archiveReady } from "../../domain/archive-destination.ts";
import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import type { Command, CommandResult } from "@/src/domain/commands";
import { supportingPdf } from "@/src/domain/request-archive";
import type { MRF, Site } from "@/src/domain/types";
import { readQuoteFile } from "../../documents/files.ts";

type Run = (command: Command) => Promise<CommandResult>;

export async function syncApprovedRequest(request: MRF, site: Site, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const document = supportingPdf(request);
    if (!document?.fileId || !archiveReady(site)) throw new Error("The supporting PDF or project Drive folder is missing.");
    const blob = await readQuoteFile(document.fileId);
    if (!blob) throw new Error("The supporting PDF is unavailable. Attach it again.");
    if (blob.size < 5 || blob.size > 50 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-") throw new Error("The supporting PDF is invalid. Replace it before archiving.");
    if (site.localArchiveId) {
      const form = await archiveLocal(site, await previewPdf({ kind: "mrf", request, project: site }), progress);
      const support = await archiveLocal(site, blob, progress);
      const saved = await run({ type: "completeRequestArchive", id: request.id, formFileId: form.fileId, supportFileId: support.fileId, formUrl: form.url, supportUrl: support.url });
      if (!saved.ok) throw new Error(saved.message);
      return { ok: true, message: saved.message };
    }
    const response = await fetch("/api/drive/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, projectFolderId: site.driveFolderId, projectName: site.name, projectLocation: site.location, supportSize: blob.size }) });
    const started = await archiveResponse(response);
    const result = complete(started) ? started : started.ticket && Number.isInteger(started.offset) ? await uploadDocument(blob, started.ticket, started.offset!, "/api/drive/archive/chunk", progress) : undefined;
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
