import { openUploadTicket, sealUploadTicket, validUploadSession } from "./upload-ticket-codec.ts";
export type DriveUploadTicket = {
  requestId: string;
  version: number;
  total: number;
  sessionUri: string;
  formFileId: string;
  formUrl: string;
  expiresAt: number;
};


function valid(value: DriveUploadTicket) {
  return !!value.requestId && Number.isInteger(value.version) && value.version >= 1 && Number.isInteger(value.total) && value.total >= 5 && value.total <= 50 * 1024 * 1024 && !!value.formFileId && !!value.formUrl && validUploadSession(value.sessionUri, true) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now();
}
export function sealDriveUploadTicket(input: Omit<DriveUploadTicket, "expiresAt">) {
  const value = { ...input, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("Google Drive returned an invalid upload session.");
  return sealUploadTicket(value);
}
export function openDriveUploadTicket(encoded: string): DriveUploadTicket {
  if (!encoded || encoded.length > 8192) throw new Error("The Drive upload session is invalid. Retry the archive from the request.");
  return openUploadTicket(encoded, valid, "The Drive upload session expired or is invalid. Retry the archive from the request.");
}
