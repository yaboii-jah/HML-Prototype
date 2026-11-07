import { readPurchasingDocument } from "@/src/server/purchasing/read-document";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return readPurchasingDocument(request, (await context.params).id, "comparison");
}
