import { XLSX_MIME } from "@/src/domain/bid-reports";
import { validBidChunk } from "@/src/server/bid-upload-ticket";
import { openBidUploadTicket } from "@/src/server/bid-upload-ticket";
import { createDocumentChunkHandlers } from "@/src/server/document-chunks";
export const runtime = "nodejs";
export const maxDuration = 60;
const handlers = createDocumentChunkHandlers({
  openTicket: openBidUploadTicket,
  mime: ticket => ticket.format === "pdf" ? "application/pdf" : XLSX_MIME,
  signature: (bytes, ticket) => validBidChunk(0, ticket.total, bytes, ticket.format),
  invalidMessage: "The workbook chunk is invalid.",
});
export const POST = handlers.POST;
export const PUT = handlers.PUT;
