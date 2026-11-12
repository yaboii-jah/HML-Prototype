import {
  documentActor,
  readDocumentBytes,
  sameOrigin,
} from "@/src/server/documents/access";
import {
  paymentFileCommand,
  paymentFileError,
} from "@/src/server/payments/files";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await documentActor();
    let input: unknown;
    try {
      input = JSON.parse(
        Buffer.from(await readDocumentBytes(request, 16384)).toString("utf8"),
      );
    } catch {
      return Response.json(
        { error: "Invalid payment-proof action." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(await paymentFileCommand(input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return paymentFileError(error);
  }
}
