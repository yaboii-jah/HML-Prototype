import { readPaymentDocument } from "@/src/server/payments/read-document";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return readPaymentDocument(request, (await context.params).id);
}
