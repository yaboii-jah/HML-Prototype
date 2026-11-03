import "server-only";
import { createHash } from "node:crypto";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { uuid } from "@/src/domain/requests/drafts";
import { documentDrive, documentRoot } from "./config";
import { validateSupportingPdf, InvalidSupportingPdf } from "./pdf-validation";
import { archiveApprovedMrf } from "./archive";
import { rowValue, textValue, uploadTags } from "./state";

/** Workflow steps return only small outcomes; bytes, metadata and credentials stay here. */
export async function processDocumentJob(id: string): Promise<void> {
  if (!uuid(id)) throw Error("Invalid job identity");
  let job = record(await serviceRpc("document_worker", { job_id: id, action: "claim" }));
  if (!job) return;
  const lease = textValue(job.lease);
  async function checkpoint(patch: Record<string, unknown>) {
    const next = record(await serviceRpc("document_worker", { job_id: id, action: "checkpoint", lease_id: lease, patch }));
    if (!next) throw Error("Document authority or processing lease changed");
    job = next;
    return rowValue(next.checkpoint);
  }
  try {
    const drive = documentDrive();
    let saved = rowValue(job.checkpoint);
    if (job.kind === "folder") {
      const project = rowValue(job.project), payload = rowValue(job.payload);
      if (!saved.rootId) saved = await checkpoint({ rootId: documentRoot() });
      const root = textValue(saved.rootId);
      if (!saved.folderId) saved = await checkpoint({ folderId: typeof payload.linkedFolder === "string" ? payload.linkedFolder : await drive.generateId() });
      const folderId = textValue(saved.folderId);
      const folder = typeof payload.linkedFolder === "string" ? await drive.validateFolder(folderId, root)
        : await drive.ensureFolder(folderId, root, textValue(project.name).replace(/[\\/:*?"<>|]/g, "-").slice(0, 150), { hmlProjectId: textValue(project.id), hmlKind: "project-folder" });
      await drive.validateFolder(folder.id, root);
      await checkpoint({ folderId: folder.id, name: folder.name, verified: true });
    } else if (job.kind === "validate") {
      const upload = rowValue(job.upload), folder = rowValue(upload.folder);
      const size = Number(upload.size);
      if (!Number.isSafeInteger(size) || size < 5 || size > 50 * 1024 * 1024) throw Error("Invalid upload size");
      await drive.validateFolder(textValue(folder.folder_id), textValue(folder.root_id));
      const body = await drive.verifyPdf(textValue(upload.drive_file_id), textValue(folder.folder_id), uploadTags(textValue(upload.id), textValue(upload.request_id)), size, textValue(upload.sha256));
      await validateSupportingPdf(body);
      await checkpoint({ fileId: upload.drive_file_id, size: String(size), sha256: createHash("sha256").update(body).digest("hex"), readable: true });
    } else if (job.kind === "cleanup") {
      const document = record(job.document), upload = record(job.upload);
      if (document) {
        await drive.trash(textValue(document.drive_file_id), uploadTags(textValue(document.id), textValue(document.request_id)));
      } else if (upload?.drive_file_id) {
        if (!["cancelled", "failed", "expired", "conflict"].includes(String(upload.state))) throw Error("Upload still in use");
        if (upload.lease_until && Date.parse(String(upload.lease_until)) > Date.now()) throw Error("Transfer is still in progress");
        await drive.trash(textValue(upload.drive_file_id), uploadTags(textValue(upload.id), textValue(upload.request_id)));
      }
      await checkpoint({ trashed: true });
    } else if (job.kind === "archive") {
      await archiveApprovedMrf(job, drive, checkpoint);
    } else throw Error("Unsupported document job");
    await serviceRpc("document_worker", { job_id: id, action: "complete", lease_id: lease });
  } catch (error) {
    // Do not log provider responses, encrypted sessions or document contents.
    await serviceRpc("document_worker", { job_id: id, action: "fail", lease_id: lease, patch: { reason: error instanceof InvalidSupportingPdf ? "invalid-pdf" : "provider" } });
  }
}
