import { quoteReviewIssues } from "../../domain/procurement.ts";
import { quotationLineAmount } from "../../domain/pricing.ts";
import type { DemoSnapshot, MRF, Quote } from "../../domain/types.ts";

/** A safe subset for explicitly confirming item links together, never financial approval. */
export function quotationMatchReview(state: DemoSnapshot, request: MRF, quote: Quote) {
  const issues = quoteReviewIssues(state, quote);
  return (quote.lines || []).map((line, index) => {
    const item = request.items.find(value => value.id === line.requestItemId);
    const reasons: string[] = [];
    if (line.matchConfirmed === true) return { id: line.id, number: index + 1, eligible: false, confirmed: true, reasons };
    if (!item) reasons.push("Choose a requested item");
    if (line.matchConfidence !== "high") reasons.push("Check the suggested item individually");
    if (item && line.unit.trim().toLowerCase() !== item.unit.trim().toLowerCase()) reasons.push("Check the unit difference");
    if (line.conversionFactor !== 1) reasons.push("Check the unit conversion");
    if (item && line.quantity !== item.quantity) reasons.push("Confirm the offered quantity individually");
    if (issues.some(message => message.startsWith(`Line ${index + 1}:`) && !message.includes("confirm the suggested material match"))) reasons.push("Resolve this line's review items");
    if (line.printedTotal != null && (!Number.isFinite(line.printedTotal) || Math.abs(quotationLineAmount(quote, line) - line.printedTotal) > 0.01)) reasons.push("Check the printed amount individually");
    return { id: line.id, number: index + 1, eligible: reasons.length === 0, confirmed: false, reasons };
  });
}
