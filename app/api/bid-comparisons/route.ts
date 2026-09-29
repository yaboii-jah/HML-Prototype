import { MAX_BID_FILE, validBidReport } from "@/src/domain/bid-reports";
import { bidWorkbookResponse } from "@/src/server/bid-response";
import { generateBidWorkbook } from "@/src/server/bid-workbook";
import { sameOriginError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = sameOriginError(request);
  if (denied) return denied;
  try {
    const report: unknown = await request.json();
    if (!validBidReport(report)) return Response.json({ error: "The frozen bid comparison is invalid." }, { status: 400 });
    const bytes = await generateBidWorkbook(report);
    if (bytes.length > MAX_BID_FILE) return Response.json({ error: "The workbook exceeds the 50 MB report limit." }, { status: 413 });
    return bidWorkbookResponse(bytes);
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 400 }); }
}
