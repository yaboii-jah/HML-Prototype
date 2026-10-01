import { sameOriginError, driveError } from "@/src/server/local-drive";
import { generateMrfPdf } from "@/src/server/mrf-pdf";
import { generatePoPdf } from "@/src/server/po-pdf";
import { poFinancialError } from "@/src/domain/pricing";
import type { MRF, PO, Quote, Site } from "@/src/domain/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = sameOriginError(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 2 * 1024 * 1024) return Response.json({ error: "The document input is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { kind: "mrf" | "po"; request: MRF; po?: PO; quote?: Quote; project: Site };
    if (!["mrf", "po"].includes(body.kind) || !body.project || typeof body.project.name !== "string" || typeof body.project.location !== "string" || body.project.id !== body.request?.siteId || typeof body.request?.ref !== "string" || !Array.isArray(body.request.items) || body.request.items.length > 2000 || !body.request.items.every(item => typeof item.name === "string" && typeof item.unit === "string" && Number.isFinite(item.quantity) && item.quantity > 0)) return Response.json({ error: "The document data is invalid." }, { status: 400 });
    if (body.kind === "po" && (!body.po || !body.quote || body.po.mrfId !== body.request.id || body.po.quoteId !== body.quote.id || body.quote.mrfId !== body.request.id || poFinancialError(body.po))) return Response.json({ error: "The linked PO or financial values are invalid." }, { status: 400 });
    const bytes = body.kind === "mrf" ? await generateMrfPdf(body.request, body.project.name, body.project.location) : await generatePoPdf(body.po!, body.request, body.quote!, body.project.name);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 400 }); }
}
