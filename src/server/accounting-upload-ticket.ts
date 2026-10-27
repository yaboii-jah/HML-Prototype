import { openUploadTicket, sealUploadTicket, validUploadSession } from "./upload-ticket-codec.ts";
import { ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE } from "../domain/accounting-documents.ts";
export type AccountingUploadTicket = { documentId: string; poId: string; batchId?: string; total: number; mime: string; sessionUri: string; expiresAt: number };
function valid(ticket: AccountingUploadTicket) {
  try {
    return !!ticket.documentId && !!ticket.poId && (ticket.batchId === undefined || typeof ticket.batchId === "string" && !!ticket.batchId) && Number.isInteger(ticket.total) && ticket.total >= 12 && ticket.total <= MAX_ACCOUNTING_FILE && ACCOUNTING_MIMES.some(mime => mime === ticket.mime) && validUploadSession(ticket.sessionUri) && Number.isFinite(ticket.expiresAt) && ticket.expiresAt > Date.now();
  } catch { return false; }
}
export function sealAccountingUploadTicket(input: Omit<AccountingUploadTicket, "expiresAt">) {
  const value = { ...input, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("The accounting upload session is invalid.");
  return sealUploadTicket(value);
}
export function openAccountingUploadTicket(encoded: string): AccountingUploadTicket {
  return openUploadTicket(encoded, valid, "The accounting upload session expired or is invalid. Retry the archive.");
}
