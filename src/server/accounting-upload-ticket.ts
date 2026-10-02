import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE } from "../domain/accounting-documents.ts";
export type AccountingUploadTicket = { documentId: string; poId: string; batchId: string; total: number; mime: string; sessionUri: string; expiresAt: number };
const key = () => { const value = Buffer.from(process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY || "", "base64"); if (value.length !== 32) throw new Error("Configure the Drive upload token key."); return value; };
function valid(ticket: AccountingUploadTicket) {
  try {
    const url = new URL(ticket.sessionUri);
    return !!ticket.documentId && !!ticket.poId && !!ticket.batchId && Number.isInteger(ticket.total) && ticket.total >= 12 && ticket.total <= MAX_ACCOUNTING_FILE && ACCOUNTING_MIMES.some(mime => mime === ticket.mime) && url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable" && !!url.searchParams.get("upload_id") && Number.isFinite(ticket.expiresAt) && ticket.expiresAt > Date.now();
  } catch { return false; }
}
export function sealAccountingUploadTicket(input: Omit<AccountingUploadTicket, "expiresAt">) {
  const value = { ...input, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("The accounting upload session is invalid.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}
export function openAccountingUploadTicket(encoded: string): AccountingUploadTicket {
  try {
    if (!encoded || encoded.length > 8192) throw new Error("invalid ticket");
    const bytes = Buffer.from(encoded, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as AccountingUploadTicket;
    if (!valid(value)) throw new Error("invalid ticket");
    return value;
  } catch { throw new Error("The accounting upload session expired or is invalid. Retry the archive."); }
}
