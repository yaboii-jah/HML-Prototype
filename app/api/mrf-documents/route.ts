import { documentActor, documentCommand, documentError, documentsView, privateDocumentRead, sameOrigin, DocumentHttpError } from "@/src/server/documents/access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Origin" };
export async function GET(request: Request) {
  try {
    privateDocumentRead(request);
    const url = new URL(request.url);
    return Response.json(await documentsView(url.searchParams.get("mrfId") ?? undefined, url.searchParams.get("projectId") ?? undefined), { headers });
  } catch (error) { return documentError(error); }
}
export async function POST(request: Request) {
  try {
    await documentActor();
    sameOrigin(request);
    if (Number(request.headers.get("content-length")) > 4096) throw new DocumentHttpError(413, "Document action is too large.");
    const body = await request.text();
    if (body.length > 4096) throw new DocumentHttpError(413, "Document action is too large.");
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new DocumentHttpError(400, "Invalid document action."); }
    return Response.json(await documentCommand(input), { headers });
  } catch (error) { return documentError(error); }
}
