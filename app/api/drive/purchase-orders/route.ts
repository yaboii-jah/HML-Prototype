import type { MRF, PO, Quote } from "@/src/domain/types";
import { archivePurchaseOrder } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";
import { generatePoPdf } from "@/src/server/po-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as { po?: PO; mrf?: MRF; quote?: Quote; projectFolderId?: string; projectName?: string };
    const { po, mrf, quote } = body;
    if (!po || po.status !== "approved" || po.archive?.status !== "pending" || !mrf || mrf.id !== po.mrfId || mrf.status !== "approved" || !quote || quote.id !== po.quoteId || quote.mrfId !== mrf.id || !body.projectFolderId) return Response.json({ error: "The approved PO or its linked records are invalid." }, { status: 400 });
    const bytes = await generatePoPdf(po, mrf, quote, body.projectName || "");
    return Response.json(await archivePurchaseOrder(body.projectFolderId, mrf.id, mrf.ref, po.id, po.ref, bytes));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
