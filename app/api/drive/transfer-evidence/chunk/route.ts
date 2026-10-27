import { accountingSignature } from "@/src/domain/accounting-documents";
import { openTransferUploadTicket } from "@/src/server/transfer-upload-ticket";
import { createDocumentChunkHandlers } from "@/src/server/document-chunks";
export const runtime = "nodejs";
export const maxDuration = 60;
const handlers = createDocumentChunkHandlers({
  openTicket: openTransferUploadTicket,
  mime: ticket => ticket.mime,
  signature: (bytes, ticket) => accountingSignature(bytes, ticket.mime),
  invalidMessage: "The document chunk is invalid.",
});
export const POST = handlers.POST;
export const PUT = handlers.PUT;
