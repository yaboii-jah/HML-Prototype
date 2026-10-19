import { MAX_BID_FILE, validBidReport } from "@/src/domain/bid-reports";
import { bidWorkbookResponse } from "@/src/server/bid-response";
import { generateBidPdf } from "@/src/server/bid-pdf";
import { generateBidWorkbook } from "@/src/server/bid-workbook";
import { sameOriginError, validatedRequestOrigin, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = sameOriginError(request);
  if (denied) return denied;
  try {
    const report: unknown = await request.json();
    if (!validBidReport(report)) return Response.json({ error: "The frozen bid comparison is invalid." }, { status: 400 });
    const format = new URL(request.url).searchParams.get("format") || "xlsx";
    if (!["xlsx", "pdf"].includes(format)) return Response.json({ error: "Unknown report format." }, { status: 400 });
    // Downloaded PDF/XLSX files need absolute source links; a relative local
    // archive path would otherwise resolve against the downloaded file itself.
    if (report.data.project.localArchiveId) for (const offer of report.data.offers) for (const file of offer.quote.archive?.files || []) {
      if (file.url.startsWith("/demo-files/")) file.url = new URL(file.url, validatedRequestOrigin(request)!).href;
    }
    const bytes = format === "pdf" ? await generateBidPdf(report) : await generateBidWorkbook(report);
    if (bytes.length > MAX_BID_FILE) return Response.json({ error: "The workbook exceeds the 50 MB report limit." }, { status: 413 });
    return bidWorkbookResponse(bytes, format === "pdf" ? "application/pdf" : undefined);
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 400 }); }
}
