import { openUploadTicket, sealUploadTicket, validUploadSession } from "./upload-ticket-codec.ts";
import { ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE } from "../domain/accounting-documents.ts";
export type TransferUploadTicket = { owner: "transfer-evidence"; documentId: string; transferId: string; deliveryId: string; total: number; mime: string; sessionUri: string; expiresAt: number };
function valid(ticket: TransferUploadTicket) {
  try {
    return !!ticket.documentId && ticket.owner === "transfer-evidence" && !!ticket.transferId && !!ticket.deliveryId && Number.isInteger(ticket.total) && ticket.total >= 12 && ticket.total <= MAX_ACCOUNTING_FILE && ACCOUNTING_MIMES.some(mime => mime === ticket.mime) && validUploadSession(ticket.sessionUri) && Number.isFinite(ticket.expiresAt) && ticket.expiresAt > Date.now();
  } catch { return false; }
}
export function sealTransferUploadTicket(input: Omit<TransferUploadTicket, "expiresAt" | "owner">) {
  const value = { ...input, owner: "transfer-evidence" as const, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("The transfer evidence upload session is invalid.");
  return sealUploadTicket(value);
}
export function openTransferUploadTicket(encoded: string): TransferUploadTicket {
  return openUploadTicket(encoded, valid, "The transfer evidence upload session expired or is invalid. Retry the archive.");
}
