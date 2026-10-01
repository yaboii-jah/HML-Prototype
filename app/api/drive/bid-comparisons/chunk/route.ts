import { XLSX_MIME } from "@/src/domain/bid-reports";
import { openBidUploadTicket, validBidChunk } from "@/src/server/bid-upload-ticket";
import { documentUploadStatus, sendDocumentChunk } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = openBidUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
    return Response.json(await documentUploadStatus(ticket.sessionUri, ticket.total));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function PUT(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = openBidUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
    const offset = request.headers.get("x-drive-upload-offset");
    const length = request.headers.get("content-length");
    if (!offset || length && Number(length) > 3 * 1024 * 1024) return Response.json({ error: "The workbook chunk is invalid." }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!validBidChunk(Number(offset), ticket.total, bytes, ticket.format) || length && Number(length) !== bytes.length) return Response.json({ error: "The workbook chunk is invalid." }, { status: 400 });
    return Response.json(await sendDocumentChunk(ticket.sessionUri, Number(offset), ticket.total, bytes, ticket.format === "pdf" ? "application/pdf" : XLSX_MIME));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
