// Isolated prototype handler coverage. Never imported by the application.
import { validTransferReceipt } from "@/src/domain/transfer-document";
import { validAccountingDocument, MAX_ACCOUNTING_FILE } from "@/src/domain/accounting-documents";
import type { TransferEvidence, TransferReceiptData } from "@/src/domain/types";
import { prepareTransferEvidence, downloadTransferEvidence } from "@/src/server/drive";
import { sealTransferUploadTicket } from "@/src/server/transfer-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "Evidence metadata is too large." }, { status: 413 });
    const { data, document, projectFolderId } = JSON.parse(raw) as { data: TransferReceiptData; document: TransferEvidence; projectFolderId: string };
    if (!validTransferReceipt(data) || !["confirmed", "posted"].includes(data.delivery.status) || !document || !validAccountingDocument(document) || !["Signed delivery receipt", "Other"].includes(document.kind) || document.deliveryId !== data.delivery.id || document.archive?.status !== "pending" || typeof projectFolderId !== "string" || !projectFolderId.trim() || document.kind === "Signed delivery receipt" && document.receiptVersion !== data.receiptVersion) return Response.json({ error: "Invalid transfer evidence relationship." }, { status: 400 });
    const result = await prepareTransferEvidence(projectFolderId, data.request, data.transfer, data.delivery, document);
    if ("driveFileId" in result) return Response.json(result);
    return Response.json({ ticket: sealTransferUploadTicket({ transferId: data.transfer.id, deliveryId: data.delivery.id, documentId: document.id, total: document.size, mime: document.mime, sessionUri: result.sessionUri }), offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function GET(request: Request) {
  const denied = driveAccessError(request); if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams;
    const keys = ["projectFolderId", "requestId", "transferId", "deliveryId", "documentId", "fileId"];
    if (keys.some(key => !query.get(key))) return Response.json({ error: "Invalid transfer evidence download." }, { status: 400 });
    const { bytes, mime } = await downloadTransferEvidence(query.get(keys[0])!, query.get(keys[1])!, query.get(keys[2])!, query.get(keys[3])!, query.get(keys[4])!, query.get(keys[5])!);
    if (bytes.length > MAX_ACCOUNTING_FILE) throw new Error("The evidence exceeds its file limit.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
