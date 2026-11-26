import { DocumentHttpError, readDocumentBytes, sameOrigin } from "@/src/server/documents/access";
import { QUOTE_CHUNK_SIZE, quoteUuid } from "@/src/domain/quotations/drafts";
import { quotationFileError } from "@/src/server/quotations/files";
import { transferIntakeOriginal } from "@/src/server/quotations/intake";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const { id } = await params;
    if (!quoteUuid(id)) throw new DocumentHttpError(400, "Choose a quotation original.");
    return Response.json(await transferIntakeOriginal(id), { headers });
  } catch (error) { return quotationFileError(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const { id } = await params;
    const offset = new URL(request.url).searchParams.get("offset");
    if (!quoteUuid(id) || !offset || !/^\d{1,8}$/.test(offset) || request.headers.get("content-type") !== "application/octet-stream") {
      throw new DocumentHttpError(400, "Invalid original-file chunk.");
    }
    return Response.json(await transferIntakeOriginal(id, await readDocumentBytes(request, QUOTE_CHUNK_SIZE), Number(offset)), { headers });
  } catch (error) { return quotationFileError(error); }
}
