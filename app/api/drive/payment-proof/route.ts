import type { MRF, PO, PaymentProof } from "@/src/domain/types";
import { canAttachPaymentProof, proofAssigned } from "@/src/domain/full-disbursement";
import { MAX_ACCOUNTING_FILE, validAccountingDocument } from "@/src/domain/accounting-documents";
import { preparePaymentProof, downloadPaymentProof } from "@/src/server/drive";
import { sealAccountingUploadTicket } from "@/src/server/accounting-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const { proof, po, mrf, projectFolderId } = await request.json() as { proof: PaymentProof; po: PO; mrf: MRF; projectFolderId: string };
    if (!proof || !validAccountingDocument({ ...proof, kind: "Payment receipt" }) || !nonempty(proof.id) || proof.archive?.status !== "pending" || !po || !canAttachPaymentProof(po) || proofAssigned(po, proof.id) || po.archive?.status !== "complete" || !po.paymentProofs?.some(value => value.id === proof.id && value.sha256 === proof.sha256 && value.localFileId === proof.localFileId) || !mrf || mrf.id !== po.mrfId || mrf.status !== "approved" || !!mrf.correction || mrf.archive?.status !== "complete" || !nonempty(mrf.ref) || !nonempty(po.id) || !nonempty(po.ref) || !nonempty(projectFolderId)) return Response.json({ error: "The payment proof is invalid." }, { status: 400 });
    const result = await preparePaymentProof(projectFolderId, mrf, po, proof);
    if ("driveFileId" in result) return Response.json(result);
    return Response.json({ ticket: sealAccountingUploadTicket({ documentId: proof.id, poId: po.id, batchId: "payment-proof", total: proof.size, mime: proof.mime, sessionUri: result.sessionUri }), offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function GET(request: Request) {
  const denied = driveAccessError(request); if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams, project = query.get("projectFolderId"), requestId = query.get("requestId"), poId = query.get("poId"), documentId = query.get("documentId"), fileId = query.get("fileId");
    if (!project || !requestId || !poId || !documentId || !fileId) return Response.json({ error: "The proof download is invalid." }, { status: 400 });
    const { bytes, mime } = await downloadPaymentProof(project, requestId, poId, documentId, fileId);
    if (bytes.length > MAX_ACCOUNTING_FILE) throw new Error("The proof exceeds the file limit.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
