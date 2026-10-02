import type { AccountingDocument, Batch, MRF, PO } from "@/src/domain/types";
import { MAX_ACCOUNTING_FILE, validAccountingDocument } from "@/src/domain/accounting-documents";
import { prepareAccountingFile, downloadAccountingFile } from "@/src/server/drive";
import { sealAccountingUploadTicket } from "@/src/server/accounting-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export async function POST(request: Request) {
  const denied = driveAccessError(request, true); if (denied) return denied;
  try {
    const { document, po, batch, mrf, projectFolderId } = await request.json() as { document: AccountingDocument; po: PO; batch: Batch; mrf: MRF; projectFolderId: string };
    if (!document || !validAccountingDocument(document) || !nonempty(document.id) || document.archive?.status !== "pending" || !po || !nonempty(po.id) || !nonempty(po.ref) || po.status !== "served" || !batch || !nonempty(batch.id) || !nonempty(batch.ref) || !["confirmed", "posted"].includes(batch.status) || batch.id !== document.batchId || batch.poId !== po.id || !mrf || !nonempty(mrf.id) || !nonempty(mrf.ref) || mrf.id !== po.mrfId || !nonempty(projectFolderId)) return Response.json({ error: "The delivered accounting document is invalid." }, { status: 400 });
    const result = await prepareAccountingFile(projectFolderId, mrf, po, batch, document);
    if ("driveFileId" in result) return Response.json(result);
    return Response.json({ ticket: sealAccountingUploadTicket({ documentId: document.id, poId: po.id, batchId: batch.id, total: document.size, mime: document.mime, sessionUri: result.sessionUri }), offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function GET(request: Request) {
  const denied = driveAccessError(request); if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams;
    const project = query.get("projectFolderId"), requestId = query.get("requestId"), poId = query.get("poId"), batchId = query.get("batchId"), documentId = query.get("documentId"), fileId = query.get("fileId");
    if (!project || !requestId || !poId || !batchId || !documentId || !fileId) return Response.json({ error: "The document download is invalid." }, { status: 400 });
    const { bytes, mime } = await downloadAccountingFile(project, requestId, poId, batchId, documentId, fileId);
    if (bytes.length > MAX_ACCOUNTING_FILE) throw new Error("The document exceeds the file limit.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
