import { documentActor, DocumentHttpError, documentError, privateDocumentRead, readDocumentBytes, sameOrigin } from "@/src/server/documents/access";
import { quotationExtractionCommand } from "@/src/server/quotations/extraction";
import { ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Origin" };

function extractionError(error: unknown) {
  if (error instanceof DocumentHttpError || error instanceof ServiceCommandError && error.code === "42501") return documentError(error);
  return Response.json({ error: "Extraction status is unavailable. Check again or enter the quotation manually." }, { status: 503, headers });
}

export async function GET(request: Request) {
  try {
    privateDocumentRead(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await quotationExtractionCommand({
      type: "status", quoteId: query.get("quoteId"), version: query.get("version"), fileVersion: query.get("fileVersion"),
    }), { headers });
  } catch (error) { return extractionError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await documentActor();
    if (actor.activeRole !== "Procurement") throw new DocumentHttpError(403, "Procurement access is required.");
    const body = await readDocumentBytes(request, 4096);
    let command;
    try { command = record(JSON.parse(body.toString("utf8"))); } catch { /* Invalid command. */ }
    if (!command || command.type === "status") throw new DocumentHttpError(400, "Invalid extraction action.");
    return Response.json(await quotationExtractionCommand(command, actor), { headers });
  } catch (error) { return extractionError(error); }
}
