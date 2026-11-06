import "server-only";
import {
  documentActor,
  DocumentHttpError,
  privateDocumentRead,
} from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { quotationFileError } from "./files";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { quoteUuid, QUOTE_MIMES } from "@/src/domain/quotations/drafts";
import { documentRange } from "@/src/domain/requests/documents";

export async function readQuotationDocument(
  request: Request,
  id: string,
  kind: "original" | "review",
) {
  try {
    privateDocumentRead(request);
    const actor = await documentActor();
    if (!quoteUuid(id))
      throw new DocumentHttpError(404, "Quotation document unavailable.");
    const file = record(
      await serviceRpc(
        kind === "original" ? "quotation_file" : "quotation_review_pdf",
        kind === "original"
          ? { actor, file_id: id }
          : { actor, revision_id: id },
      ),
    );
    if (
      !file ||
      typeof file.fileId !== "string" ||
      typeof file.name !== "string" ||
      typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 5 ||
      typeof file.mime !== "string" ||
      !QUOTE_MIMES.some((mime) => mime === file.mime) ||
      (kind === "review" && file.mime !== "application/pdf")
    )
      throw Error("Invalid quotation document metadata");
    let range;
    try {
      range = documentRange(request.headers.get("range"), file.size);
    } catch {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${file.size}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const upstream = await documentDrive().stream(
      file.fileId,
      range ?? undefined,
      request.signal,
    );
    const headers = new Headers({
      "Content-Type": file.mime,
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      Vary: "Cookie, Origin",
      "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="quotation-document"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : file.size),
    );
    if (range)
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${file.size}`,
      );
    return new Response(upstream.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return quotationFileError(error);
  }
}
