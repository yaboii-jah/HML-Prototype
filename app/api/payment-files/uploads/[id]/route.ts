import {
  documentActor,
  DocumentHttpError,
  readDocumentBytes,
  sameOrigin,
} from "@/src/server/documents/access";
import {
  paymentFileError,
  transferPaymentProof,
} from "@/src/server/payments/files";
import { QUOTE_CHUNK_SIZE, quoteUuid } from "@/src/domain/quotations/drafts";

export const runtime = "nodejs";
async function transfer(
  request: Request,
  context: { params: Promise<{ id: string }> },
  send: boolean,
) {
  try {
    sameOrigin(request);
    await documentActor();
    const { id } = await context.params;
    if (!quoteUuid(id))
      throw new DocumentHttpError(400, "Valid upload required.");
    const rawOffset = new URL(request.url).searchParams.get("offset");
    if (
      send &&
      (!rawOffset ||
        !/^\d+$/.test(rawOffset) ||
        !Number.isSafeInteger(Number(rawOffset)))
    )
      throw new DocumentHttpError(400, "Valid upload offset required.");
    const bytes = send
      ? await readDocumentBytes(request, QUOTE_CHUNK_SIZE)
      : undefined;
    return Response.json(
      await transferPaymentProof(
        id,
        bytes,
        send ? Number(rawOffset) : undefined,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return paymentFileError(error);
  }
}
export const POST = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => transfer(request, context, false);
export const PUT = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => transfer(request, context, true);
