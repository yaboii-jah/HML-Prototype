import { documentActor, documentError, DocumentHttpError, readDocumentBytes, sameOrigin } from '@/src/server/documents/access';
import { transferFileCommand } from '@/src/server/deliveries/receipt-files';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await documentActor();
    const raw = await readDocumentBytes(request, 4096);
    let command: unknown;
    try { command = JSON.parse(raw.toString('utf8')); }
    catch { throw new DocumentHttpError(400, 'Invalid receipt document action.'); }
    return Response.json(await transferFileCommand(command, actor), { headers:{ 'Cache-Control':'private, no-store' } });
  } catch (error) {
    return documentError(error);
  }
}
