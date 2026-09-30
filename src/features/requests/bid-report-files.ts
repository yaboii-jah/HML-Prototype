import type { Command, CommandResult } from "../../domain/commands.ts";
import type { BidReport } from "../../domain/types.ts";
import { XLSX_MIME } from "../../domain/bid-reports.ts";
import { readQuoteFile, saveGeneratedFile } from "./quote-files.ts";
import { uploadDocument } from "./archive-purchasing.ts";

export type RunBidCommand = (command: Command) => Promise<CommandResult>;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "The bid report could not be processed.";
export async function workbookDigest(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
}
async function checked(response: Response) {
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || "The report request failed."); }
  return response;
}
async function save(command: Command, run: RunBidCommand) {
  const result = await run(command);
  if (!result.ok) throw new Error(result.message);
  return result;
}
export async function getBidWorkbook(report: BidReport, run?: RunBidCommand): Promise<{ blob: Blob; report: BidReport }> {
  let cached: Blob | undefined;
  try { cached = report.localFileId ? await readQuoteFile(report.localFileId) : undefined; } catch { /* An archived report can still be downloaded without a local cache. */ }
  if (cached && report.sha256 && await workbookDigest(cached) === report.sha256) return { blob: cached, report };
  if (report.archive.status === "complete" && report.archive.fileId) {
    const query = new URLSearchParams({ projectFolderId: report.data.project.driveFolderId!, requestId: report.requestId, reportId: report.id, fileId: report.archive.fileId });
    const blob = await (await checked(await fetch(`/api/drive/bid-comparisons?${query}`))).blob();
    if (!report.sha256 || await workbookDigest(blob) !== report.sha256) throw new Error("The Drive workbook no longer matches this saved report version.");
    if (report.localFileId) try { await saveGeneratedFile(report.localFileId, blob); } catch { /* Download remains available if browser storage is full or disabled. */ }
    return { blob, report };
  }
  if (report.sha256) throw new Error("The saved workbook is missing from this browser and has no completed Drive archive. Generate a new report version.");
  if (!run) throw new Error("Procurement must finish generating this workbook first.");
  try {
    const blob = await (await checked(await fetch("/api/bid-comparisons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }))).blob();
    const fileId = `bid-file-${report.id}`;
    await saveGeneratedFile(fileId, blob);
    const result = await save({ type: "saveBidReportFile", id: report.id, localFileId: fileId, sha256: await workbookDigest(blob) }, run);
    return { blob, report: result.snapshot.bidReports.find(value => value.id === report.id)! };
  } catch (cause) {
    await run({ type: "failBidGeneration", id: report.id, error: errorMessage(cause) });
    throw cause;
  }
}
export function downloadBidWorkbook(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(new Blob([blob], { type: XLSX_MIME }));
  const link = document.createElement("a"); link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function archiveBidWorkbook(report: BidReport, blob: Blob, run: RunBidCommand) {
  if (report.archive.status === "complete") return;
  try {
    if (!report.sha256 || await workbookDigest(blob) !== report.sha256) throw new Error("The workbook does not match this saved report version.");
    const response = await checked(await fetch("/api/drive/bid-comparisons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report, size: blob.size }) }));
    const start = await response.json();
    const result = start.driveFileId && start.url ? start : start.ticket && Number.isInteger(start.offset) ? await uploadDocument(blob, start.ticket, start.offset, "/api/drive/bid-comparisons/chunk") : undefined;
    if (!result?.driveFileId || !result.url) throw new Error("Drive did not confirm the workbook upload.");
    await save({ type: "completeBidArchive", id: report.id, fileId: result.driveFileId, url: result.url }, run);
  } catch (cause) {
    await run({ type: "failBidArchive", id: report.id, error: errorMessage(cause) });
    throw cause;
  }
}
