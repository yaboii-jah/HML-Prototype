import { validTransferReceipt } from "@/src/domain/transfer-document";
import type { TransferReceiptVersion } from "@/src/domain/types";
import { generateTransferReceiptPdf } from "@/src/server/transfer-receipt-pdf";
import { archiveTransferReceipt } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "The transfer receipt is too large." }, { status: 413 });
    const { receipt, projectFolderId } = JSON.parse(raw) as { receipt: TransferReceiptVersion; projectFolderId: string };
    if (!receipt || !receipt.id || !Number.isInteger(receipt.version) || receipt.version < 1 || typeof receipt.fileName !== "string" || !receipt.fileName.endsWith(".pdf") || receipt.archive?.status !== "pending" || !validTransferReceipt(receipt.data) || !["confirmed", "posted"].includes(receipt.data.delivery.status) || typeof projectFolderId !== "string" || !projectFolderId.trim()) return Response.json({ error: "Invalid confirmed transfer receipt." }, { status: 400 });
    return Response.json(await archiveTransferReceipt(projectFolderId, receipt, () => generateTransferReceiptPdf(receipt.data)), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
