"use client";

import { useArchive } from "@/src/app-state/ArchiveProvider";
import type { ArchiveProgressListener } from "@/src/domain/archive-progress";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { useConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { InlineError } from "@/src/components/ui/Primitives";
import { normalizedBidReportReadiness } from "@/src/domain/bid-reports";
import { captureBidReport } from "@/src/domain/bid-reports";
import { comparisonOffers, materialOffers, resolveComparisonSelections } from "@/src/domain/comparison-report";
import type { BidReport, ComparisonSelections } from "@/src/domain/types";
import { archiveBidWorkbook, downloadBidWorkbook, getBidWorkbook } from "./bid-report-files";
import { BidReportPreview } from "./BidReportPreview";

export function BidComparisonReports({ requestId, comparisonSelections, onComparisonSelectionsChange }: { requestId: string; comparisonSelections?: ComparisonSelections; onComparisonSelectionsChange?: (selections: ComparisonSelections) => void }) {
  const { perform } = useArchive();
  const { snapshot, run, beginOperation } = useDemo();
  const { notify, update } = useActionFeedback();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<BidReport | null>(null);
  const [localSelections, setLocalSelections] = useState<ComparisonSelections>({});
  const selections = comparisonSelections ?? localSelections;
  const setSelections = (next: ComparisonSelections) => onComparisonSelectionsChange ? onComparisonSelectionsChange(next) : setLocalSelections(next);
  const { confirmAction, working, confirmation } = useConfirmedAction(setError);
  if (!snapshot) return null;
  const procurement = snapshot.role === "Procurement";
  const readiness = normalizedBidReportReadiness(snapshot, requestId);
  const currentData = !readiness ? captureBidReport(snapshot, requestId, true) : undefined;
  const alternatives = currentData ? comparisonOffers(currentData).flatMap(offer => currentData.request.items.flatMap(item => {
    const lines = materialOffers(currentData, offer, item);
    return lines.length > 1 ? [{ offer, item, lines }] : [];
  })) : [];
  const reports = snapshot.bidReports.filter(report => report.requestId === requestId).sort((a, b) => b.version - a.version);
  const process = async (report: BidReport, action: "download" | "generate" | "archive", selectedFormat: "xlsx" | "pdf" = "xlsx") => {
    setBusy(report.id); setError("");
    const label = `Bid comparison v${report.version}${action === "download" ? ` · ${selectedFormat.toUpperCase()} download` : action === "archive" ? " · archiving to Google Drive" : " · generating"}`;
    const toast = action === "download" ? "" : notify({ tone: "progress", title: label, detail: "Preparing document" });
    try {
      const needsWrite = action !== "download" || !(selectedFormat === "pdf" ? report.pdf : report)?.sha256;
      const pipeline = needsWrite ? await beginOperation({kind:"report",id:report.id,...(action === "download" ? {format:selectedFormat} : {})}) : undefined;
      const errors: string[] = [];
      for (const format of action === "download" ? [selectedFormat] : report.pdf ? ["xlsx", "pdf"] as const : ["xlsx"] as const) {
        try {
          const artifact = format === "pdf" ? report.pdf! : report;
          const operation = async (progress?: ArchiveProgressListener) => {
            if (toast) update(toast, { title: label, detail: action === "archive" ? `Uploading ${format.toUpperCase()}` : `Generating ${format.toUpperCase()}` });
            progress?.({ phase: "preparing" });
            const workbook = await getBidWorkbook(report, procurement ? pipeline : undefined, format);
            if (action === "download") downloadBidWorkbook(workbook.blob, artifact.fileName);
            else await archiveBidWorkbook(workbook.report, workbook.blob, pipeline!, format, progress);
          };
          if (action === "download") await operation();
          else await perform(`bid-${report.id}-${format}`, `Bid comparison v${report.version} ${format.toUpperCase()}`, operation, {kind:"report",id:report.id,format});
        } catch (cause) { errors.push(`${format.toUpperCase()}: ${cause instanceof Error ? cause.message : "The report could not be processed."}`); }
      }
      if (errors.length) throw new Error(errors.join(" "));
      if (toast) update(toast, { tone: "success", title: action === "archive" ? `Bid comparison v${report.version} archived.` : `Bid comparison v${report.version} ready.`, detail: "PDF and Excel saved" });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "The bid report could not be processed.";
      setError(text);
      if (toast) update(toast, { tone: "error", title: text, detail: `Bid comparison v${report.version}` });
    } finally { setBusy(""); }
  };
  const generate = async () => {
    if (!currentData) return;
    let selected: ComparisonSelections;
    try {
      const active: ComparisonSelections = {};
      for (const { offer, item, lines } of alternatives) {
        const choice = selections[offer.quote.id]?.[item.id];
        if (lines.some(line => line.id === choice)) (active[offer.quote.id] ||= {})[item.id] = choice;
      }
      selected = resolveComparisonSelections(currentData, active);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Choose the comparison alternatives."); return; }
    await confirmAction(reports.length ? "Generate a new bid comparison version?" : "Generate bid comparison?", "Save the current supplier bids and selected alternatives as PDF and a single comparison worksheet, then archive both to Google Drive. Material totals use the full requested quantity after item discounts, including VAT where applicable. Quotation-level charges, discounts and EWT are excluded. This does not save awards or create POs.", "Generate report", async () => {
    setBusy("new"); setError("");
    try {
      const result = await run({ type: "createBidReport", requestId, comparisonSelections: selected });
      if (!result.ok) { setError(result.message); return; }
      await process(result.snapshot.bidReports.find(report => report.id === result.recordId)!, "generate");
    } finally { setBusy(""); }
    });
  };
  const retry = (report: BidReport, action: "generate" | "archive") => confirmAction(action === "generate" ? "Retry bid report generation?" : "Retry bid report Drive archive?", `Bid comparison v${report.version}: ${action === "generate" ? "retry preparing" : "retry uploading"} the saved ${report.pdf ? "PDF and Excel files" : "Excel workbook"} in the project Drive folder. This uses the existing saved report version.`, action === "generate" ? "Retry generation" : "Retry archive", () => process(report, action));
  return <section className="panel">
    <fieldset className="quotation-operation-fields" disabled={working || !!busy}>
    <div className="panel-heading"><div><h2>Bid comparison reports</h2><p className="helper-note">New PDF and Excel versions use the comparison table’s material prices: item discounts applied, VAT included where applicable, and full requested quantities. Previous versions retain their original calculations.</p></div>
      {procurement && <button className="button primary" type="button" disabled={!!busy || !!readiness} onClick={() => void generate()}>{busy ? "Processing…" : reports.length ? "Generate new version" : "Generate bid comparison"}</button>}
    </div>
    {procurement && readiness && <p className="helper-note">{readiness}</p>}
    {procurement && alternatives.length > 0 && (comparisonSelections !== undefined ? <p className="helper-note">Alternative offers use your choices in the comparison table. Choose an offer for each unresolved alternative before generating a report.</p> : <fieldset className="comparison-alternatives" disabled={!!busy}><legend>Choose comparison alternatives</legend><p className="helper-note">Choose one offer per supplier and material. These choices apply to this report and do not change PO awards.</p>{alternatives.map(({ offer, item, lines }) => <label className="field" key={`${offer.quote.id}/${item.id}`}><span>{offer.supplierName} · {item.name}</span><select value={lines.some(line => line.id === selections[offer.quote.id]?.[item.id]) ? selections[offer.quote.id][item.id] : ""} onChange={event => setSelections({ ...selections, [offer.quote.id]: { ...selections[offer.quote.id], [item.id]: event.target.value } })}><option value="">Choose an offer</option>{lines.map(line => <option key={line.id} value={line.id}>{line.description} · {line.brand} {line.specification} · PHP {line.unitPrice.toLocaleString("en-PH")} / {line.unit} · offered {line.quantity}</option>)}</select></label>)}</fieldset>)}
    {!reports.length && <p className="muted">No saved bid comparison yet.</p>}
    {reports.map(report => <article className="bid-report-row" key={report.id}>
      <div><strong>Bid comparison v{report.version}</strong><small>{new Date(report.generatedAt).toLocaleString()} · {report.data.project.name}</small><small>{report.sha256 ? report.archive.status === "complete" ? "Archived to Google Drive" : "Workbook ready · Drive archive pending" : "Workbook generation pending"}</small>
        {(report.generationError || report.archive.error) && <p className="field-error">{report.generationError || report.archive.error}</p>}
        {report.pdf && <><small>{report.pdf.sha256 ? report.pdf.archive.status === "complete" ? "PDF archived to Google Drive" : "PDF ready · Drive archive pending" : "PDF generation pending"}</small>{(report.pdf.generationError || report.pdf.archive.error) && <p className="field-error">{report.pdf.generationError || report.pdf.archive.error}</p>}</>}
      </div>
      <div className="button-row">
        {report.pdf?.sha256 && <button className="button secondary" type="button" onClick={() => setPreview(report)}>Preview PDF</button>}
        {report.sha256 && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void process(report, "download")}>Download Excel</button>}
        {report.pdf?.sha256 && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void process(report, "download", "pdf")}>Download PDF</button>}
        {procurement && (!report.sha256 || report.pdf && !report.pdf.sha256) && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void retry(report, "generate")}>Retry generation</button>}
        {procurement && (report.sha256 && report.archive.status !== "complete" || report.pdf?.sha256 && report.pdf.archive.status !== "complete") && <button className="button secondary" type="button" disabled={!!busy} onClick={() => void retry(report, "archive")}>Retry Drive archive</button>}
        {report.archive.url && <a className="text-link" href={report.archive.url} target="_blank" rel="noopener noreferrer">Open in Drive</a>}
        {report.pdf?.archive.url && <a className="text-link" href={report.pdf.archive.url} target="_blank" rel="noopener noreferrer">Open PDF in Drive</a>}
        {busy === report.id && <span role="status">Processing report…</span>}
      </div>
    </article>)}
    <InlineError message={error}/></fieldset>{confirmation}{preview && <BidReportPreview key={preview.id} report={preview} onClose={() => setPreview(null)}/>}
  </section>;
}
