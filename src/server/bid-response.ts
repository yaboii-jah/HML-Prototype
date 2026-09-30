import { XLSX_MIME } from "../domain/bid-reports.ts";

export function bidWorkbookResponse(bytes: Uint8Array, mime = XLSX_MIME) {
  let offset = 0;
  // Stream downloads rather than buffering the HTTP response at the deployment boundary.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
  });
  return new Response(stream, { headers: { "Content-Type": mime, "Cache-Control": "no-store" } });
}
