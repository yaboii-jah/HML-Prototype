import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type QuoteUploadTicket = { quoteId: string; fileIndex: number; total: number; mime: string; sessionUri: string; expiresAt: number };
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function key() {
  const bytes = Buffer.from(process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY || "", "base64");
  if (bytes.length !== 32) throw new Error("Configure a 32-byte GOOGLE_DRIVE_UPLOAD_TOKEN_KEY on the server.");
  return bytes;
}

function valid(value: QuoteUploadTicket) {
  try {
    const url = new URL(value.sessionUri);
    return !!value.quoteId && Number.isInteger(value.fileIndex) && value.fileIndex >= 0 && value.fileIndex < 12 && Number.isInteger(value.total) && value.total > 0 && value.total <= 20 * 1024 * 1024 && allowed.has(value.mime) && url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable" && !!url.searchParams.get("upload_id") && value.expiresAt > Date.now();
  } catch { return false; }
}

export function sealQuoteUploadTicket(value: Omit<QuoteUploadTicket, "expiresAt">) {
  const ticket = { ...value, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(ticket)) throw new Error("Google Drive returned an invalid quotation upload session.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(ticket)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}

export function openQuoteUploadTicket(encoded: string): QuoteUploadTicket {
  if (!encoded || encoded.length > 8192) throw new Error("The quotation upload session is invalid. Retry the archive.");
  try {
    const bytes = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const ticket = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as QuoteUploadTicket;
    if (!valid(ticket)) throw new Error("invalid ticket");
    return ticket;
  } catch { throw new Error("The quotation upload session expired or is invalid. Retry the archive."); }
}
