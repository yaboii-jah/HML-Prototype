import { DocumentHttpError, documentError, privateDocumentRead, readDocumentBytes, sameOrigin } from "@/src/server/documents/access";
import { mrfExtractionCommand } from "@/src/server/requests/extraction";
import { ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Origin" };

function extractionError(error: unknown) {
  if (error instanceof DocumentHttpError || error instanceof ServiceCommandError && error.code === "42501") return documentError(error);
  return Response.json({ error: "Extraction status is unavailable. Check again or continue entering the MRF manually." }, { status: 503, headers });
}

export async function GET(request: Request) {
  try {
    privateDocumentRead(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await mrfExtractionCommand({
      type: "status", mrfId: query.get("mrfId"), version: query.get("version"), attachmentRevision: query.get("attachmentRevision"),
    }), { headers });
  } catch (error) { return extractionError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readDocumentBytes(request, 4096);
    let command;
    try { command = record(JSON.parse(body.toString("utf8"))); } catch { /* Handled as an invalid command. */ }
    if (!command) throw new DocumentHttpError(400, "Invalid extraction action.");
    return Response.json(await mrfExtractionCommand(command), { headers });
  } catch (error) { return extractionError(error); }
}
