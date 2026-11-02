// Isolated prototype handler coverage. Never imported by the application.
import { validDeliveryReceipt } from "@/src/domain/delivery-document";
import type { DeliveryReceiptVersion } from "@/src/domain/types";
import { generateDeliveryReceiptPdf } from "@/src/server/delivery-receipt-pdf";
import { archiveDeliveryReceipt } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "The receipt input is too large." }, { status: 413 });
    const { receipt, projectFolderId } = JSON.parse(raw) as { receipt: DeliveryReceiptVersion; projectFolderId: string };
    if (!receipt || typeof receipt.id !== "string" || !receipt.id.trim() || !Number.isInteger(receipt.version) || receipt.version < 1 || receipt.archive?.status !== "pending" || !validDeliveryReceipt(receipt.data) || !["confirmed", "posted"].includes(receipt.data.batch.status) || typeof projectFolderId !== "string" || !projectFolderId.trim()) return Response.json({ error: "The confirmed delivery receipt is invalid." }, { status: 400 });
    const result = await archiveDeliveryReceipt(projectFolderId, receipt, () => generateDeliveryReceiptPdf(receipt.data));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
