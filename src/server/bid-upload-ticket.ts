import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MAX_BID_FILE } from "../domain/bid-reports.ts";

export type BidUploadTicket = { reportId: string; format?: "xlsx" | "pdf"; total: number; sessionUri: string; expiresAt: number };
function key() {
  const bytes = Buffer.from(process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY || "", "base64");
  if (bytes.length !== 32) throw new Error("Configure a 32-byte GOOGLE_DRIVE_UPLOAD_TOKEN_KEY on the server.");
  return bytes;
}
function valid(value: BidUploadTicket) {
  try {
    const url = new URL(value.sessionUri);
    return [undefined, "xlsx", "pdf"].includes(value.format) && typeof value.reportId === "string" && !!value.reportId && Number.isInteger(value.total) && value.total >= 4 && value.total <= MAX_BID_FILE && url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable" && !!url.searchParams.get("upload_id") && value.expiresAt > Date.now();
  } catch { return false; }
}
export function sealBidUploadTicket(value: Omit<BidUploadTicket, "expiresAt">) {
  const ticket = { ...value, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(ticket)) throw new Error("Google Drive returned an invalid bid report upload session.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(ticket)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}
export function openBidUploadTicket(encoded: string): BidUploadTicket {
  try {
    if (!encoded || encoded.length > 8192) throw new Error("invalid ticket");
    const bytes = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const ticket = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as BidUploadTicket;
    if (!valid(ticket)) throw new Error("invalid ticket");
    return ticket;
  } catch { throw new Error("The bid report upload session expired or is invalid. Retry the archive."); }
}
export function validBidChunk(offset: number, total: number, bytes: Uint8Array, format: "xlsx" | "pdf" = "xlsx") {
  return Number.isInteger(offset) && offset >= 0 && offset < total && bytes.length > 0 && bytes.length <= 3 * 1024 * 1024 && offset + bytes.length <= total && (offset + bytes.length === total || bytes.length % (256 * 1024) === 0) && (offset === 0 ? (format === "pdf" ? bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d : bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) : offset % (256 * 1024) === 0);
}
