import "server-only";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentActor, DocumentHttpError } from "./access";
import { documentDrive } from "./config";
import { rowValue, textValue, uploadTags } from "./state";
import { sealUploadTicket, openUploadTicket } from "@/src/server/upload-ticket-codec";
import { DOCUMENT_CHUNK_SIZE } from "@/src/domain/requests/documents";
import { dispatchDocumentJobs } from "./dispatch";

export async function transferSupportingPdf(uploadId: string, bytes?: Uint8Array, requestedOffset?: number) {
  const actor = await documentActor();
  let upload = rowValue(await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "claim" }));
  if (upload.complete === true) return { complete: true, offset: 0 };
  const lease = textValue(upload.lease), drive = documentDrive(), folder = rowValue(upload.folder);
  const total = Number(upload.size), tags = uploadTags(uploadId, textValue(upload.request_id));
  const update = async (patch: Record<string, unknown>) => {
    upload = rowValue(await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "checkpoint", lease_id: lease, patch }));
  };
  try {
    await drive.validateFolder(textValue(folder.folder_id), textValue(folder.root_id));
    if (!upload.drive_file_id) await update({ driveFileId: await drive.generateId() });
    const fileId = textValue(upload.drive_file_id);
    // A lost final upload response may leave a completed file with no DB ack.
    const existing = await drive.find(fileId);
    if (existing && existing.size === String(total)) {
      drive.verifyIdentity(existing, textValue(folder.folder_id), tags);
      await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "finish", lease_id: lease });
      await dispatchDocumentJobs().catch(() => {});
      return { validating: true, offset: total };
    }
    let uri: string | null = null;
    if (upload.encrypted_session) {
      const opened = openUploadTicket<{ uploadId: string; uri: string }>(textValue(upload.encrypted_session), value => value.uploadId === uploadId && drive.validSession(value.uri), "The stored upload session is invalid.");
      uri = opened.uri;
    }
    if (!uri) {
      uri = await drive.begin(fileId, textValue(folder.folder_id), textValue(upload.name), total, tags);
      if (!uri) throw Error("Unconfirmed provider file");
      await update({ session: sealUploadTicket({ uploadId, uri }) });
    }
    let progress = await drive.transfer(uri, total);
    if (progress.expired) {
      // An expired provider session may be recreated for the same preallocated ID.
      uri = await drive.begin(fileId, textValue(folder.folder_id), textValue(upload.name), total, tags);
      if (!uri) throw Error("Unconfirmed provider file");
      if (Number(upload.offset_bytes) !== 0) throw new DocumentHttpError(410, "This provider upload expired. Cancel it and upload the PDF again.");
      await update({ session: sealUploadTicket({ uploadId, uri }) });
      progress = await drive.transfer(uri, total);
    }
    if (progress.complete) {
      await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "finish", lease_id: lease });
      await dispatchDocumentJobs().catch(() => {});
      return { validating: true, offset: total };
    }
    if (progress.offset < Number(upload.offset_bytes)) throw new DocumentHttpError(410, "The provider upload no longer has its confirmed bytes. Cancel it and upload again.");
    if (bytes) {
      if (requestedOffset !== progress.offset) throw new DocumentHttpError(409, "The confirmed upload offset changed. Check status and resume.");
      if (!bytes.length || bytes.length > DOCUMENT_CHUNK_SIZE || progress.offset + bytes.length > total || progress.offset + bytes.length < total && bytes.length % (256 * 1024)) throw new DocumentHttpError(400, "Invalid PDF chunk.");
      progress = await drive.transfer(uri, total, bytes, progress.offset);
      if (progress.expired) throw new DocumentHttpError(410, "The provider upload expired. Cancel it and upload again.");
    }
    await update({ offset: progress.offset });
    if (progress.complete) {
      await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "finish", lease_id: lease });
      await dispatchDocumentJobs().catch(() => {});
      return { validating: true, offset: total };
    }
    return { offset: progress.offset, total };
  } finally {
    await serviceRpc("document_transfer", { actor, upload_id: uploadId, action: "release", lease_id: lease }).catch(() => {});
  }
}
