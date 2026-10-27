import { openUploadTicket, sealUploadTicket, validUploadSession } from "./upload-ticket-codec.ts";
import { MAX_BID_FILE } from "../domain/bid-reports.ts";

export type BidUploadTicket = { reportId: string; format?: "xlsx" | "pdf"; total: number; sessionUri: string; expiresAt: number };
function valid(value: BidUploadTicket) {
  try {
    return [undefined, "xlsx", "pdf"].includes(value.format) && typeof value.reportId === "string" && !!value.reportId && Number.isInteger(value.total) && value.total >= 4 && value.total <= MAX_BID_FILE && validUploadSession(value.sessionUri) && value.expiresAt > Date.now();
  } catch { return false; }
}
export function sealBidUploadTicket(input: Omit<BidUploadTicket, "expiresAt">) {
  const value = { ...input, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (!valid(value)) throw new Error("The bid report upload session is invalid.");
  return sealUploadTicket(value);
}
export function openBidUploadTicket(encoded: string): BidUploadTicket {
  return openUploadTicket(encoded, valid, "The bid report upload session expired or is invalid. Retry the archive.");
}
export function validBidChunk(offset: number, total: number, bytes: Uint8Array, format: "xlsx" | "pdf" = "xlsx") {
  return Number.isInteger(offset) && offset >= 0 && offset < total && bytes.length > 0 && bytes.length <= 3 * 1024 * 1024 && offset + bytes.length <= total && (offset + bytes.length === total || bytes.length % (256 * 1024) === 0) && (offset === 0 ? (format === "pdf" ? bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d : bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) : offset % (256 * 1024) === 0);
}
