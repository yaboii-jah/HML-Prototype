import { mrfSourceSignature } from "@/src/domain/mrf-extraction";
import { openQuoteUploadTicket } from "@/src/server/quote-upload-ticket";
import { createDocumentChunkHandlers } from "@/src/server/document-chunks";
export const runtime = "nodejs";
export const maxDuration = 60;
const handlers = createDocumentChunkHandlers({
  openTicket: openQuoteUploadTicket,
  mime: ticket => ticket.mime,
  signature: (bytes, ticket) => mrfSourceSignature(bytes, ticket.mime),
  invalidMessage: "The quotation file chunk is invalid.",
});
export const POST = handlers.POST;
export const PUT = handlers.PUT;
