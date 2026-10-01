import { MAX_BID_FILE, validBidReport } from "@/src/domain/bid-reports";
import { bidWorkbookResponse } from "@/src/server/bid-response";
import { downloadBidFile, prepareBidFile } from "@/src/server/drive";
import { sealBidUploadTicket } from "@/src/server/bid-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const { report, size, format = "xlsx" } = await request.json();
    if (!validBidReport(report) || !["xlsx", "pdf"].includes(format) || !(format === "pdf" ? report.pdf?.sha256 : report.sha256) || !Number.isInteger(size) || size < 4 || size > MAX_BID_FILE) return Response.json({ error: "The bid report archive is invalid." }, { status: 400 });
    const artifact = format === "pdf" ? report.pdf! : report;
    const result = await prepareBidFile(report.data.project.driveFolderId!, report.requestId, report.data.request.ref, report.id, report.version, artifact.fileName, artifact.sha256!, size, format);
    if ("driveFileId" in result) return Response.json(result);
    return Response.json({ ticket: sealBidUploadTicket({ reportId: report.id, format, total: size, sessionUri: result.sessionUri }), offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
export async function GET(request: Request) {
  const denied = driveAccessError(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const project = params.get("projectFolderId"), requestId = params.get("requestId"), reportId = params.get("reportId"), fileId = params.get("fileId");
    if (!project || !requestId || !reportId || !fileId) return Response.json({ error: "The report download is invalid." }, { status: 400 });
    const format = params.get("format") || "xlsx";
    if (!["xlsx", "pdf"].includes(format)) return Response.json({ error: "Unknown report format." }, { status: 400 });
    const bytes = await downloadBidFile(project, requestId, reportId, fileId, format as "xlsx" | "pdf");
    if (bytes.length > MAX_BID_FILE) throw new Error("The archived workbook exceeds the report limit.");
    return bidWorkbookResponse(bytes, params.get("format") === "pdf" ? "application/pdf" : undefined);
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}
