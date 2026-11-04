import {
  documentActor,
  DocumentHttpError,
  privateDocumentRead,
} from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { quotationFileError } from "@/src/server/quotations/files";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { quoteUuid, QUOTE_MIMES } from "@/src/domain/quotations/drafts";
import { documentRange } from "@/src/domain/requests/documents";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    privateDocumentRead(request);
    const actor = await documentActor(),
      { id } = await context.params;
    if (!quoteUuid(id))
      throw new DocumentHttpError(404, "Original unavailable.");
    const file = record(
      await serviceRpc("quotation_file", { actor, file_id: id }),
    );
    if (
      !file ||
      typeof file.fileId !== "string" ||
      typeof file.name !== "string" ||
      typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) ||
      typeof file.mime !== "string" ||
      !QUOTE_MIMES.some((mime) => mime === file.mime)
    )
      throw Error("Invalid original metadata");
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
      "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="original"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
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
