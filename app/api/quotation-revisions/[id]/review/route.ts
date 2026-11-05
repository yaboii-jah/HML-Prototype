import { readQuotationDocument } from "@/src/server/quotations/read-document";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return readQuotationDocument(request, (await context.params).id, "review");
}
