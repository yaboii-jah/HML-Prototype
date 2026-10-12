import type { Quote, MRF } from "@/src/domain/types";
import { prepareQuoteFile } from "@/src/server/drive";
import { sealQuoteUploadTicket } from "@/src/server/quote-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as { quote?: Quote; mrf?: MRF; projectFolderId?: string; index?: number; size?: number };
    const { quote, mrf, index, size } = body;
    const document = Number.isInteger(index) ? quote?.documents[index!] : undefined;
    if (!quote || quote.reviewStatus !== "finalized" || quote.archive?.status !== "pending" || !mrf || mrf.id !== quote.mrfId || mrf.status !== "approved" || !body.projectFolderId || !document?.fileId || !document.name || !allowed.has(document.type) || !Number.isInteger(index) || index! < 0 || index! >= 12 || !Number.isInteger(size) || size! < 5 || size! > 20 * 1024 * 1024 || quote.documents.length > 12) return Response.json({ error: "The supplier quotation file is invalid." }, { status: 400 });
    const supplier = quote.supplierDetails?.name || "Supplier";
    const prepared = await prepareQuoteFile(body.projectFolderId, mrf.id, mrf.ref, quote.id, quote.supplierId, supplier, quote.version || 1, index!, document.name, document.type, size!, document.archiveName);
    if ("driveFileId" in prepared) return Response.json(prepared);
    return Response.json({ ticket: sealQuoteUploadTicket({ quoteId: quote.id, fileIndex: index!, total: size!, mime: document.type, sessionUri: prepared.sessionUri }), offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
