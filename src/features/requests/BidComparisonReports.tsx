"use client";

import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { InlineError } from "@/src/components/ui/Primitives";
import { bidReportReadiness } from "@/src/domain/bid-reports";
import type { BidReport } from "@/src/domain/types";
import { archiveBidWorkbook, downloadBidWorkbook, getBidWorkbook } from "./bid-report-files";

export function BidComparisonReports({ requestId }: { requestId: string }) {
  const { snapshot, run } = useDemo();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { confirm, confirmation } = useConfirmation();
  if (!snapshot) return null;
  const procurement = snapshot.role === "Procurement";
  const readiness = bidReportReadiness(snapshot, requestId);
  const reports = snapshot.bidReports.filter(report => report.requestId === requestId).sort((a, b) => b.version - a.version);
  const process = async (report: BidReport, action: "download" | "generate" | "archive") => {
    setBusy(report.id); setError("");
    try {
      const workbook = await getBidWorkbook(report, procurement ? run : undefined);
      if (action !== "archive") downloadBidWorkbook(workbook.blob, report.fileName);
      if (action !== "download") await archiveBidWorkbook(workbook.report, workbook.blob, run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The bid report could not be processed."); }
    finally { setBusy(""); }
  };
  const generate = async () => {
    if (!await confirm(reports.length ? "Generate a new bid comparison version?" : "Generate bid comparison?", "Capture the current PHP bids and PO awards in a fixed Excel workbook. Download it and archive a copy to Google Drive.", "Generate report")) return;
    setBusy("new"); setError("");
    try {
      const result = await run({ type: "createBidReport", requestId });
      if (!result.ok) { setError(result.message); return; }
      await process(result.snapshot.bidReports.find(report => report.id === result.recordId)!, "generate");
    } finally { setBusy(""); }
  };
  return <section className="panel">
    <div className="panel-heading"><div><h2>Bid comparison reports</h2><p className="helper-note">Saved Excel versions include PHP bid comparisons, quotation details, and PO awards. Partial material coverage is shown.</p></div>
      {procurement && <button className="button primary" type="button" disabled={!!busy || !!readiness} onClick={() => void generate()}>{busy === "new" ? "Generating…" : reports.length ? "Generate new version" : "Generate bid comparison"}</button>}
    </div>
    {procurement && readiness && <p className="helper-note">{readiness}</p>}
    {!reports.length && <p className="muted">No saved bid comparison yet.</p>}
    {reports.map(report => <article className="bid-report-row" key={report.id}>
      <div><strong>Bid comparison v{report.version}</strong><small>{new Date(report.generatedAt).toLocaleString()} · {report.data.project.name}</small><small>{report.sha256 ? report.archive.status === "complete" ? "Archived to Google Drive" : "Workbook ready · Drive archive pending" : "Workbook generation pending"}</small>
        {(report.generationError || report.archive.error) && <p className="field-error">{report.generationError || report.archive.error}</p>}
      </div>
      <div className="button-row">
        {report.sha256 && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void process(report, "download")}>Download Excel</button>}
        {procurement && !report.sha256 && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void process(report, "generate")}>Retry generation</button>}
        {procurement && report.sha256 && report.archive.status !== "complete" && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void process(report, "archive")}>Retry Drive archive</button>}
        {report.archive.url && <a className="text-link" href={report.archive.url} target="_blank" rel="noopener noreferrer">Open in Drive</a>}
        {busy === report.id && <span role="status">Processing report…</span>}
      </div>
    </article>)}
    <InlineError message={error}/>{confirmation}
  </section>;
}
