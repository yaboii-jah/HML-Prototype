import { QUOTE_CHUNK_SIZE, quoteUuid } from '@/src/domain/quotations/drafts';
import { documentActor, documentError, DocumentHttpError, readDocumentBytes, sameOrigin } from '@/src/server/documents/access';
import { readReceiptFile, transferReceiptFile } from '@/src/server/deliveries/receipt-files';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!quoteUuid(id)) throw new DocumentHttpError(404, 'Receipt file unavailable.');
    return await readReceiptFile(request, id, true);
  } catch (error) {
    return documentError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await documentActor();
    const { id } = await params;
    const offset = request.headers.get('upload-offset');
    if (!quoteUuid(id) || !offset || !/^\d{1,8}$/.test(offset)) throw new DocumentHttpError(400, 'Invalid receipt upload.');
    const bytes = await readDocumentBytes(request, QUOTE_CHUNK_SIZE);
    if (!bytes.length) throw new DocumentHttpError(400, 'Receipt upload chunk is empty.');
    return Response.json(await transferReceiptFile(id, bytes, Number(offset), actor, true), { headers:{ 'Cache-Control':'private, no-store' } });
  } catch (error) {
    return documentError(error);
  }
}
