import { documentUploadStatus, sendDocumentChunk } from "@/src/server/drive";
import { openQuoteUploadTicket } from "@/src/server/quote-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
const CHUNK = 3 * 1024 * 1024;
const BLOCK = 256 * 1024;

function signature(bytes: Uint8Array, mime: string) {
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = openQuoteUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
    return Response.json(await documentUploadStatus(ticket.sessionUri, ticket.total));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}

export async function PUT(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const ticket = openQuoteUploadTicket(request.headers.get("x-drive-upload-ticket") || "");
    const offsetHeader = request.headers.get("x-drive-upload-offset");
    const offset = Number(offsetHeader);
    const declaredLength = request.headers.get("content-length");
    if (!offsetHeader || declaredLength && Number(declaredLength) > CHUNK) return Response.json({ error: "The quotation file chunk is invalid." }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!Number.isInteger(offset) || offset < 0 || offset >= ticket.total || bytes.length < 1 || bytes.length > CHUNK || declaredLength && Number(declaredLength) !== bytes.length || offset + bytes.length > ticket.total || offset + bytes.length < ticket.total && bytes.length % BLOCK !== 0 || offset === 0 && !signature(bytes, ticket.mime)) return Response.json({ error: "The quotation file chunk is invalid." }, { status: 400 });
    return Response.json(await sendDocumentChunk(ticket.sessionUri, offset, ticket.total, bytes, ticket.mime));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
