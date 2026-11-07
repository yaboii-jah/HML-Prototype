import { readPurchasingDocument } from "@/src/server/purchasing/read-document";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return readPurchasingDocument(request, (await params).id, "approvedPo");
}
