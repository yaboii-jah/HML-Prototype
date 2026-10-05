import { isFinalizedQuote, latestFinalizedQuotes } from "./procurement.ts";
import { resolveComparisonSelections } from "./comparison-report.ts";
import { procurementReady } from "./request-archive.ts";
import type { BidReport, BidReportData, DemoSnapshot, Quote, QuoteAdjustment, QuoteLine } from "./types.ts";
import { poFinancialBreakdown, poFinancialError, poLineTotal, quoteLineTotal, totalWithAdjustments } from "./pricing.ts";
import type { PO, POLine } from "./types.ts";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_BID_FILE = 50 * 1024 * 1024;

export function bidReportReadiness(state: DemoSnapshot, requestId: string): string {
  const request = state.requests.find(value => value.id === requestId);
  if (!procurementReady(request)) return "The MRF must be approved, with no correction or pending archive.";
  if (!state.sites.some(site => site.id === request?.siteId && site.driveFolderId)) return "Map the project's Google Drive folder before generating a report.";
  const quotes = latestFinalizedQuotes(state, requestId).filter(quote => !quote.currency || quote.currency === "PHP");
  if (!quotes.length) return "Finalize a PHP supplier quotation before generating a comparison.";
  if (quotes.some(quote => quote.archive?.status === "pending")) return "Archive the finalized supplier quotations before generating a comparison.";
  return "";
}

export function captureBidReport(state: DemoSnapshot, requestId: string, currentComparison = false): BidReportData {
  const error = bidReportReadiness(state, requestId);
  if (error) throw new Error(error);
  const request = state.requests.find(value => value.id === requestId)!;
  const project = state.sites.find(site => site.id === request.siteId)!;
  const pos = state.pos.filter(po => po.mrfId === requestId && po.status !== "rejected");
  const latestBySupplier = new Map<string, Quote>();
  if (currentComparison) for (const quote of state.quotes.filter(value => value.mrfId === requestId && isFinalizedQuote(value) && (!value.currency || value.currency === "PHP"))) {
    const previous = latestBySupplier.get(quote.supplierId);
    const newer = !previous || (quote.reviewedAt || "") > (previous.reviewedAt || "") || (quote.reviewedAt || "") === (previous.reviewedAt || "") && (quote.version || 1) >= (previous.version || 1);
    if (newer) latestBySupplier.set(quote.supplierId, quote);
  }
  const latest = currentComparison ? [...latestBySupplier.values()] : latestFinalizedQuotes(state, requestId);
  const sourceIds = new Set(pos.map(po => po.quoteId));
  const selected = state.quotes.filter(quote => quote.mrfId === requestId && isFinalizedQuote(quote) && (latest.some(value => value.id === quote.id) || sourceIds.has(quote.id)));
  const name = (quote: Quote) => quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier";
  return structuredClone({
    project, request, pos,
    offers: selected.filter(quote => !quote.currency || quote.currency === "PHP").map(quote => ({ quote, supplierName: name(quote), source: sourceIds.has(quote.id) ? latest.some(value => value.id === quote.id) ? "Latest bid / PO source" as const : "PO source" as const : "Latest bid" as const })),
    excluded: selected.filter(quote => quote.currency && quote.currency !== "PHP").map(quote => ({ supplierName: name(quote), ref: quote.ref, currency: quote.currency!, version: quote.version || 1 })),
  });
}

export function bidLines(data: BidReportData, quote: Quote): QuoteLine[] {
  if (quote.lines) return quote.lines;
  // Older records priced the full MRF quantity rather than recording offered quantities.
  return data.request.items.filter(item => (quote.prices[item.id] || 0) > 0).map(item => ({ id: `${quote.id}-${item.id}-legacy`, requestItemId: item.id, description: item.name, quantity: item.quantity, unit: item.unit, unitPrice: quote.prices[item.id], conversionFactor: 1, brand: "", specification: "", varianceReason: "Legacy quotation: quantity inferred from MRF", matchConfirmed: true }));
}

export function bidQuoteTotal(data: BidReportData, quote: Quote) {
  const subtotal = bidLines(data, quote).reduce((sum, line) => sum + quoteLineTotal(line), 0);
  if (!quote.lines) return subtotal;
  return quote.adjustments ? totalWithAdjustments(subtotal, quote.adjustments) : subtotal + (quote.tax || 0) + (quote.freight || 0) - (quote.discount || 0);
}

export function bidPoLines(data: BidReportData, po: PO): POLine[] {
  if (po.lines) return po.lines;
  const quote = data.offers.find(offer => offer.quote.id === po.quoteId)!.quote;
  return data.request.items.map(item => ({ itemId: item.id, quoteLineId: "", quantity: item.quantity, unitPrice: quote.prices[item.id] || 0 }));
}

export function bidPoTotal(data: BidReportData, po: PO) {
  if (po.financial) return poFinancialBreakdown(po).net;
  if (!po.lines) return bidQuoteTotal(data, data.offers.find(offer => offer.quote.id === po.quoteId)!.quote);
  const subtotal = po.lines.reduce((sum, line) => sum + poLineTotal(line), 0);
  return po.adjustments ? totalWithAdjustments(subtotal, po.adjustments) : subtotal + (po.tax || 0) + (po.freight || 0) - (po.discount || 0);
}

export function validBidReport(value: unknown): value is BidReport {
  try {
    const report = value as BidReport;
    const data = report.data;
    if (report.comparisonRevision !== undefined && ![2, 3].includes(report.comparisonRevision)) return false;
    if ((report.comparisonRevision === 2 || report.comparisonRevision === 3)) {
      if (!report.comparisonSelections) return false;
      const selections = resolveComparisonSelections(data, report.comparisonSelections);
      for (const [quoteId, items] of Object.entries(selections)) for (const [itemId, lineId] of Object.entries(items)) {
        if (report.comparisonSelections[quoteId]?.[itemId] !== lineId) return false;
      }
      const offers = data.offers.filter(offer => offer.source !== "PO source");
      if (new Set(offers.map(offer => offer.quote.supplierId)).size !== offers.length) return false;
    }
    const finite = (value: number | undefined) => value === undefined || Number.isFinite(value) && value >= 0;
    const text = (value: unknown) => value === undefined || typeof value === "string";
    const strings = (...values: unknown[]) => values.every(text);
    const revision = (value: number | undefined) => value === undefined || Number.isInteger(value) && value > 0;
    const pricing = (line: { quantity: number; unitPrice: number; discountType?: string; discountValue?: number; taxRate?: number }) => line.quantity > 0 && finite(line.quantity) && finite(line.unitPrice) && finite(line.discountValue) && finite(line.taxRate) && (line.discountType === undefined || ["none", "percentage", "fixed"].includes(line.discountType));
    const charges = (value: { tax?: number; freight?: number; discount?: number; adjustments?: QuoteAdjustment[] }) => [value.tax, value.freight, value.discount].every(finite) && (value.adjustments || []).every(adjustment => typeof adjustment.label === "string" && ["tax", "discount", "shipping", "other"].includes(adjustment.kind) && ["percentage", "fixed"].includes(adjustment.calculation) && finite(adjustment.value));
    return !!report.id && typeof report.id === "string" && typeof report.fileName === "string" && report.fileName.endsWith(".xlsx") && Number.isInteger(report.version) && report.version > 0 && typeof report.generatedAt === "string" && !Number.isNaN(Date.parse(report.generatedAt)) &&
      (!report.pdf || typeof report.pdf.fileName === "string" && report.pdf.fileName.endsWith(".pdf") && ["pending", "complete"].includes(report.pdf.archive.status) && strings(report.pdf.localFileId, report.pdf.generationError, report.pdf.archive.error, report.pdf.archive.fileId, report.pdf.archive.url) && (!report.pdf.sha256 || /^[a-f0-9]{64}$/.test(report.pdf.sha256))) &&
      ["pending", "complete"].includes(report.archive.status) && strings(report.archive.error, report.archive.fileId, report.archive.url, report.localFileId, report.generationError) && (!report.sha256 || /^[a-f0-9]{64}$/.test(report.sha256)) &&
      strings(data.project.name, data.project.location, data.request.ref, data.request.requestDate, data.request.purchaser) &&
      data.request.id === report.requestId && data.project.id === data.request.siteId && typeof data.project.driveFolderId === "string" &&
      data.request.items.length > 0 && data.request.items.every(item => typeof item.name === "string" && typeof item.unit === "string" && strings(item.neededDate, item.location) && item.quantity > 0 && Number.isFinite(item.quantity)) &&
      Array.isArray(data.excluded) && data.excluded.every(offer => strings(offer.supplierName, offer.ref, offer.currency)) && Array.isArray(data.pos) && data.pos.every(po => strings(po.ref, po.selectionReason, po.notes, po.supersededReason) && charges(po) && !poFinancialError(po) && po.mrfId === report.requestId && ["draft", "submitted", "hold", "returned", "approved", "released", "finalized", "served"].includes(po.status) && data.offers.some(offer => offer.quote.id === po.quoteId) && (!po.lines || po.lines.every(line => pricing(line) && data.request.items.some(item => item.id === line.itemId)))) &&
      data.offers.length > 0 && data.offers.length <= 4094 && data.offers.every(offer => typeof offer.supplierName === "string" && typeof offer.source === "string" && revision(offer.quote.version) && strings(offer.quote.ref, offer.quote.terms, offer.quote.available, offer.quote.validity, offer.quote.quoteDate, offer.quote.deliveryTerms, offer.quote.quoteNotes) && (!offer.quote.supplierDetails || Object.values(offer.quote.supplierDetails).every(text)) && charges(offer.quote) && offer.quote.mrfId === report.requestId && [undefined, "finalized"].includes(offer.quote.reviewStatus) && (!offer.quote.currency || offer.quote.currency === "PHP") && bidLines(data, offer.quote).every(line => typeof line.description === "string" && typeof line.unit === "string" && strings(line.brand, line.specification, line.varianceReason, line.notes, line.supplierItemCode) && pricing(line) && (!line.requestItemId || line.conversionFactor > 0 && finite(line.conversionFactor))) && finite(offer.quote.leadDays));
  } catch { return false; }
}
