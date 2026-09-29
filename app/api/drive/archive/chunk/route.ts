import { sendSupportChunk, supportUploadStatus } from "@/src/server/drive";
import { openDriveUploadTicket, type DriveUploadTicket } from "@/src/server/drive-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
const CHUNK = 3 * 1024 * 1024;
const BLOCK = 256 * 1024;

function ticketFor(request: Request) {
  return openDriveUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
}

function resultFor(ticket: DriveUploadTicket, result: { offset: number; supportFileId?: string; supportUrl?: string }) {
  return result.supportFileId && result.supportUrl
    ? { formFileId: ticket.formFileId, formUrl: ticket.formUrl, supportFileId: result.supportFileId, supportUrl: result.supportUrl }
    : { offset: result.offset };
}

function failure(cause: unknown) {
  const message = driveError(cause);
  const status = message.includes("expired") ? 410 : message.includes("invalid") ? 400 : 502;
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = ticketFor(request);
    const result = await supportUploadStatus(ticket.sessionUri, ticket.total);
    return Response.json(resultFor(ticket, result));
  } catch (cause) { return failure(cause); }
}

export async function PUT(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = ticketFor(request);
    const offsetHeader = request.headers.get("x-drive-upload-offset");
    const start = Number(offsetHeader);
    const declaredLength = request.headers.get("content-length");
    if (!offsetHeader || !Number.isInteger(start) || start < 0 || start >= ticket.total || (declaredLength && Number(declaredLength) > CHUNK)) return Response.json({ error: "The PDF chunk range is invalid." }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const length = bytes.byteLength;
    if (length < 1 || length > CHUNK || start + length > ticket.total || (start + length < ticket.total && length % BLOCK !== 0)) return Response.json({ error: "The PDF chunk range is invalid." }, { status: 400 });
    if ((declaredLength && Number(declaredLength) !== length) || (start === 0 && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")) return Response.json({ error: "The PDF chunk is invalid." }, { status: 400 });
    const result = await sendSupportChunk(ticket.sessionUri, start, ticket.total, bytes);
    return Response.json(resultFor(ticket, result));
  } catch (cause) { return failure(cause); }
}
