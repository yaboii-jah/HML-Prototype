import { openUploadTicket, sealUploadTicket, validUploadSession } from "./upload-ticket-codec.ts";

export type QuoteUploadTicket = { quoteId: string; fileIndex: number; total: number; mime: string; sessionUri: string; expiresAt: number };
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);


function valid(value: QuoteUploadTicket) {
  try {
    return !!value.quoteId && Number.isInteger(value.fileIndex) && value.fileIndex >= 0 && value.fileIndex < 12 && Number.isInteger(value.total) && value.total > 0 && value.total <= 20 * 1024 * 1024 && allowed.has(value.mime) && validUploadSession(value.sessionUri) && value.expiresAt > Date.now();
  } catch { return false; }
}

export function sealQuoteUploadTicket(input: Omit<QuoteUploadTicket, "expiresAt">) {
  const value = { ...input, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("The quotation upload session is invalid.");
  return sealUploadTicket(value);
}
export function openQuoteUploadTicket(encoded: string): QuoteUploadTicket {
  if (!encoded || encoded.length > 8192) throw new Error("The quotation upload session is invalid. Retry the archive.");
  return openUploadTicket(encoded, valid, "The quotation upload session expired or is invalid. Retry the archive.");
}
