import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type DriveUploadTicket = {
  requestId: string;
  version: number;
  total: number;
  sessionUri: string;
  formFileId: string;
  formUrl: string;
  expiresAt: number;
};

function encryptionKey() {
  const value = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY || "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Configure a 32-byte GOOGLE_DRIVE_UPLOAD_TOKEN_KEY on the server.");
  return key;
}

function validSessionUri(value: string) {
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" && uri.hostname === "www.googleapis.com" && uri.pathname === "/upload/drive/v3/files" && uri.searchParams.get("uploadType") === "resumable" && !!uri.searchParams.get("upload_id");
  } catch { return false; }
}

export function sealDriveUploadTicket(value: Omit<DriveUploadTicket, "expiresAt">) {
  if (!validSessionUri(value.sessionUri)) throw new Error("Google Drive returned an invalid upload session.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.from(JSON.stringify({ ...value, expiresAt: Date.now() + 60 * 60 * 1000 }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openDriveUploadTicket(encoded: string): DriveUploadTicket {
  if (!encoded || encoded.length > 8192) throw new Error("The Drive upload session is invalid. Retry the archive from the request.");
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length < 29) throw new Error("invalid ticket");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const value = JSON.parse(payload.toString()) as DriveUploadTicket;
    if (!value.requestId || !Number.isInteger(value.version) || value.version < 1 || !Number.isInteger(value.total) || value.total < 5 || value.total > 50 * 1024 * 1024 || !value.formFileId || !value.formUrl || !validSessionUri(value.sessionUri) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) throw new Error("invalid ticket");
    return value;
  } catch { throw new Error("The Drive upload session expired or is invalid. Retry the archive from the request."); }
}
