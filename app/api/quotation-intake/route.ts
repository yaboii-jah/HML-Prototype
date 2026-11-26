import { documentActor, documentError, DocumentHttpError, privateDocumentRead, readDocumentBytes, sameOrigin } from "@/src/server/documents/access";
import { quotationIntakeCommand } from "@/src/server/quotations/intake";
import { quotationFileError } from "@/src/server/quotations/files";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Origin" };

export async function GET(request: Request) {
  try {
    privateDocumentRead(request);
    const actor = await documentActor();
    const mrfId = new URL(request.url).searchParams.get("mrfId");
    return Response.json(await quotationIntakeCommand({ type: "status", mrfId }, actor), { headers });
  } catch (error) { return quotationFileError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await documentActor();
    const body = await readDocumentBytes(request, 16_384);
    let value: unknown;
    try { value = JSON.parse(body.toString("utf8")); } catch { return documentError(new DocumentHttpError(400, "Invalid quotation intake action.")); }
    return Response.json(await quotationIntakeCommand(value, actor), { headers });
  } catch (error) { return quotationFileError(error); }
}
