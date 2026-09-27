import { quoteLineTotal, totalWithAdjustments } from "./pricing.ts";
import type { DemoSnapshot, Quote } from "./types.ts";

export const isFinalizedQuote = (quote: Quote) => quote.reviewStatus !== "draft";
export const hasFinalizedSuccessor = (state: DemoSnapshot, quoteId: string) => state.quotes.some(candidate => candidate.supersedesId === quoteId && isFinalizedQuote(candidate));
export const latestFinalizedQuotes = (state: DemoSnapshot, requestId: string) => state.quotes.filter(quote => quote.mrfId === requestId && isFinalizedQuote(quote) && !hasFinalizedSuccessor(state, quote.id));

export function upgradeLegacyQuotes(state: DemoSnapshot): DemoSnapshot {
  for (const quote of state.quotes) {
    if (!quote.reviewStatus) quote.reviewStatus = "finalized";
    if (!quote.currency) quote.currency = "PHP";
    if (!quote.extraction) quote.extraction = "legacy";
    if (!quote.lines) {
      const request = state.requests.find(value => value.id === quote.mrfId);
      quote.lines = (request?.items || []).filter(item => Number.isFinite(quote.prices[item.id]) && quote.prices[item.id] > 0).map(item => ({ id: `${quote.id}-${item.id}-legacy`, description: item.name, quantity: item.quantity, unit: item.unit, unitPrice: quote.prices[item.id], brand: "", specification: "", requestItemId: item.id, conversionFactor: 1, varianceReason: "", matchConfirmed: true, discountType: "none", discountValue: 0, taxRate: 0 }));
    }
  }
  return state;
}

export function quoteReviewIssues(state: DemoSnapshot, quote: Quote): string[] {
  const request = state.requests.find(value => value.id === quote.mrfId);
  if (!request) return ["The linked MRF is missing."];
  const issues: string[] = [];
  if (!(quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name)?.trim()) issues.push("Enter a supplier name.");
  if (!quote.ref.trim()) issues.push("Enter the quotation reference.");
  if (!quote.currency?.trim()) issues.push("Enter the quotation currency.");
  if (!quote.lines?.length) issues.push("Add at least one offered line.");
  for (const [index, line] of (quote.lines || []).entries()) {
    const label = `Line ${index + 1}`;
    if (!line.description.trim() || !line.unit.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice <= 0) issues.push(`${label}: enter description, positive quantity, unit, and unit price.`);
    const item = request.items.find(value => value.id === line.requestItemId);
    if (line.requestItemId && !item) issues.push(`${label}: select a valid MRF material or mark it unmatched.`);
    if (item && line.matchConfirmed !== true) issues.push(`${label}: confirm the suggested material match.`);
    if (item && (!Number.isFinite(line.conversionFactor) || line.conversionFactor <= 0)) issues.push(`${label}: enter a valid unit conversion.`);
    if (item && line.unit.trim().toLowerCase() !== item.unit.trim().toLowerCase() && !line.varianceReason.trim()) issues.push(`${label}: explain the unit difference.`);
    if (line.discountType === "percentage" && (!Number.isFinite(line.discountValue) || (line.discountValue || 0) < 0 || (line.discountValue || 0) > 100)) issues.push(`${label}: enter a discount from 0 to 100%.`);
    if (line.discountType === "fixed" && (!Number.isFinite(line.discountValue) || (line.discountValue || 0) < 0 || (line.discountValue || 0) > line.quantity * line.unitPrice)) issues.push(`${label}: enter a valid fixed discount.`);
    if (!Number.isFinite(line.taxRate ?? 0) || (line.taxRate || 0) < 0) issues.push(`${label}: enter a valid tax rate.`);
    if (line.printedTotal !== null && line.printedTotal !== undefined && Math.abs(quoteLineTotal(line) - line.printedTotal) > 0.01 && !(line.discrepancyReason || "").trim()) issues.push(`${label}: correct or explain the printed total difference.`);
  }
  for (const adjustment of quote.adjustments || []) if (!adjustment.label.trim() || !Number.isFinite(adjustment.value) || adjustment.value < 0 || (adjustment.calculation === "percentage" && adjustment.value > 100)) issues.push("Review each quotation adjustment label and amount.");
  const total = totalWithAdjustments((quote.lines || []).reduce((sum, line) => sum + quoteLineTotal(line), 0), quote.adjustments || []);
  if (!Number.isFinite(total) || total <= 0) issues.push("Quotation total must be positive after discounts and charges.");
  return issues;
}
