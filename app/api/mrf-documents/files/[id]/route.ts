import { documentActor, documentError, DocumentHttpError, privateDocumentRead } from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { uuid } from "@/src/domain/requests/drafts";
import { documentRange } from "@/src/domain/requests/documents";

export const runtime = "nodejs";
export async function GET(request: Request, context: RouteContext<"/api/mrf-documents/files/[id]">) {
  try {
    privateDocumentRead(request);
    const actor = await documentActor(), { id } = await context.params;
    if (!uuid(id)) throw new DocumentHttpError(404, "Document unavailable.");
    const file = record(await serviceRpc("document_file", { actor, document_id: id }));
    if (!file || typeof file.fileId !== "string" || typeof file.name !== "string" || typeof file.size !== "number" || !Number.isSafeInteger(file.size)) throw Error("Invalid document metadata");
    let range;
    try { range = documentRange(request.headers.get("range"), file.size); }
    catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}`, "Cache-Control": "private, no-store" } }); }
    const upstream = await documentDrive().stream(file.fileId, range ?? undefined, request.signal);
    const headers = new Headers({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="supporting.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}` });
    headers.set("Content-Length", String(range ? range.end - range.start + 1 : file.size));
    headers.set("Vary", "Cookie, Origin");
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
    return new Response(upstream.body, { status: range ? 206 : 200, headers });
  } catch (error) { return documentError(error); }
}
