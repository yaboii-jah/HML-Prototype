import "server-only";
import type { DriveGateway } from "@/src/server/documents/drive-gateway";
import { DocumentHttpError } from "@/src/server/documents/access";
import { textValue } from "@/src/server/documents/state";
import { QUOTE_CHUNK_SIZE } from "@/src/domain/quotations/drafts";
import { openUploadTicket, sealUploadTicket } from "@/src/server/upload-ticket-codec";

export type OriginalTransfer = {
  id: string; name: string; mime: string; size: number; offset: number;
  driveId: string; session: string;
};
export const quotationIntakeTags = (intakeId: string, fileId: string) => ({
  hmlKind: "quotation-intake", hmlQuotationIntake: intakeId, hmlQuotationFile: fileId,
});

export function optionalOriginalText(value: unknown) {
  return value === null || value === undefined ? "" : textValue(value);
}

export async function resumeOriginal<Finished>(
  drive: DriveGateway,
  file: OriginalTransfer,
  parent: string,
  tags: Record<string, string>,
  checkpoint: (patch: Record<string, unknown>) => Promise<void>,
  finish: () => Promise<Finished>,
  bytes?: Uint8Array,
  requestedOffset?: number,
): Promise<Finished | { offset: number; total: number }> {
  const { id, name, mime, size } = file;
  const driveId = file.driveId || await drive.generateId();
  if (!file.driveId) await checkpoint({ driveFileId: driveId });
  const existing = await drive.find(driveId);
  if (existing && existing.size === String(size)) {
    drive.verifyIdentity(existing, parent, tags, mime);
    return finish();
  }
  const begin = async () => {
    const uri = await drive.begin(driveId, parent, name, size, tags, mime);
    if (!uri) throw Error("Unconfirmed provider original");
    await checkpoint({ session: sealUploadTicket({ fileId: id, uri }) });
    return uri;
  };
  let uri = file.session ? openUploadTicket<{ fileId: string; uri: string }>(file.session,
    value => value.fileId === id && drive.validSession(value.uri), "Invalid stored upload session.").uri : await begin();
  let progress = await drive.transfer(uri, size, undefined, 0, mime);
  if (progress.expired && file.offset === 0) {
    uri = await begin();
    progress = await drive.transfer(uri, size, undefined, 0, mime);
  }
  if (progress.complete) return finish();
  if (progress.expired || progress.offset < file.offset) throw new DocumentHttpError(410, "Upload expired. Cancel this group and upload the originals again.");
  if (bytes) {
    if (requestedOffset !== progress.offset) throw new DocumentHttpError(409, "Confirmed offset changed. Check status and resume.");
    if (!bytes.length || bytes.length > QUOTE_CHUNK_SIZE || progress.offset + bytes.length > size
      || (progress.offset + bytes.length < size && bytes.length % (256 * 1024))) throw new DocumentHttpError(400, "Invalid original-file chunk.");
    progress = await drive.transfer(uri, size, bytes, progress.offset, mime);
    if (progress.expired) throw new DocumentHttpError(410, "Upload expired. Cancel this group and upload the originals again.");
  }
  await checkpoint({ offset: progress.offset });
  return progress.complete ? finish() : { offset: progress.offset, total: size };
}
