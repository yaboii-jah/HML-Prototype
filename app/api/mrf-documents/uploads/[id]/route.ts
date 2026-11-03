import { documentActor, documentError, DocumentHttpError, readDocumentBytes, sameOrigin } from "@/src/server/documents/access";
import { transferSupportingPdf } from "@/src/server/documents/uploads";
import { uuid } from "@/src/domain/requests/drafts";
import { DOCUMENT_CHUNK_SIZE } from "@/src/domain/requests/documents";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function POST(request: Request, context: RouteContext<"/api/mrf-documents/uploads/[id]">) {
  try {
    await documentActor(); sameOrigin(request);
    const { id } = await context.params;
    if (!uuid(id)) throw new DocumentHttpError(400, "Invalid upload.");
    return Response.json(await transferSupportingPdf(id), { headers });
  } catch (error) { return documentError(error); }
}
export async function PUT(request: Request, context: RouteContext<"/api/mrf-documents/uploads/[id]">) {
  try {
    await documentActor(); sameOrigin(request);
    const { id } = await context.params, length = Number(request.headers.get("content-length")), offset = Number(request.headers.get("x-upload-offset"));
    if (!uuid(id) || !Number.isSafeInteger(length) || length < 1 || length > DOCUMENT_CHUNK_SIZE || !request.headers.has("x-upload-offset") || !Number.isSafeInteger(offset) || offset < 0) throw new DocumentHttpError(400, "Invalid PDF chunk.");
    const bytes = await readDocumentBytes(request, length);
    if (bytes.length !== length) throw new DocumentHttpError(400, "PDF chunk was interrupted.");
    return Response.json(await transferSupportingPdf(id, bytes, offset), { headers });
  } catch (error) { return documentError(error); }
}
