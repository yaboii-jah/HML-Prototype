import "server-only";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { documentActor, DocumentHttpError, privateDocumentRead } from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { documentRange } from "@/src/domain/requests/documents";
import { id } from "@/src/domain/purchasing/contracts";
import { record } from "@/src/domain/projects/projects";
import { quotationFileError } from "@/src/server/quotations/files";
import { purchasingView } from "./purchasing";
import { generatePurchasingPoPreview, XLSX_MIME } from "./documents";

export async function readPurchasingDocument(request: Request, target: string, kind: "comparison" | "po") {
  try {
    privateDocumentRead(request);
    const actor = await documentActor();
    if (!id(target)) throw new DocumentHttpError(404, "Purchasing document unavailable.");
    const headers = new Headers({ "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Origin", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    if (kind === "po") {
      const mrfId = await serviceRpc("purchasing_po_request", { actor, po_id: target });
      if (!id(mrfId)) throw new DocumentHttpError(404, "PO unavailable.");
      const view = await purchasingView(mrfId), po = view?.records.find(r => r.id === target && r.kind === "po");
      if (!view || !po) throw new DocumentHttpError(404, "PO unavailable.");
      if (new URL(request.url).searchParams.get("version") !== po.version) throw new DocumentHttpError(409, "The saved PO changed. Review its current version before previewing.");
      const bytes = await generatePurchasingPoPreview(view, po);
      headers.set("Content-Type", "application/pdf"); headers.set("Content-Disposition", "inline; filename=PO-draft-preview.pdf");
      return new Response(Buffer.from(bytes), { headers });
    }
    const file = record(await serviceRpc("comparison_document", { actor, artifact_id: target }));
    if (!file || typeof file.fileId !== "string" || typeof file.name !== "string" || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 5 || (file.mime !== "application/pdf" && file.mime !== XLSX_MIME)) throw Error("Invalid comparison metadata.");
    let range;
    try { range = documentRange(request.headers.get("range"), file.size); }
    catch { headers.set("Content-Range", `bytes */${file.size}`); return new Response(null, { status: 416, headers }); }
    const upstream = await documentDrive().stream(file.fileId, range ?? undefined, request.signal);
    headers.set("Content-Type", file.mime); headers.set("Accept-Ranges", "bytes"); headers.set("Content-Length", String(range ? range.end - range.start + 1 : file.size));
    headers.set("Content-Disposition", `${file.mime === XLSX_MIME || new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="comparison-document"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
    return new Response(upstream.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof ServiceCommandError && error.code === "P4801") return quotationFileError(new DocumentHttpError(404, "Purchasing document unavailable."));
    return quotationFileError(error);
  }
}
