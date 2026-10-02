import { accountingSignature } from "@/src/domain/accounting-documents";
import { openAccountingUploadTicket } from "@/src/server/accounting-upload-ticket";
import { documentUploadStatus, sendDocumentChunk } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try { const ticket = openAccountingUploadTicket(request.headers.get("x-drive-upload-ticket") || ""); return Response.json(await documentUploadStatus(ticket.sessionUri, ticket.total)); }
  catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function PUT(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const ticket = openAccountingUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
    const header = request.headers.get("x-drive-upload-offset"), offset = Number(header), length = request.headers.get("content-length");
    if (!header || length && Number(length) > 3 * 1024 * 1024) return Response.json({ error: "The document chunk is invalid." }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!Number.isInteger(offset) || offset < 0 || offset >= ticket.total || bytes.length < 1 || bytes.length > 3 * 1024 * 1024 || offset + bytes.length > ticket.total || length && Number(length) !== bytes.length || offset + bytes.length < ticket.total && bytes.length % (256 * 1024) !== 0 || offset === 0 && !accountingSignature(bytes, ticket.mime)) return Response.json({ error: "The document chunk is invalid." }, { status: 400 });
    return Response.json(await sendDocumentChunk(ticket.sessionUri, offset, ticket.total, bytes, ticket.mime));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
