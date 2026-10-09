import { pricedLine, roundMoney } from "./pricing.ts";
import type { Quote, QuoteAdjustment } from "./types.ts";

/** Move explicitly classified service rows out of awardable material offers. */
export function moveQuotationServices(quote: Quote, lineIds: string[]): Quote {
  const ids = new Set(lineIds), adjustments = [...(quote.adjustments || [])];
  for (const line of (quote.lines || []).filter(value => ids.has(value.id))) {
    const amount = pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue);
    const existing = adjustments.findIndex(value => (value.kind === "shipping" || value.kind === "other") && value.calculation === "fixed" && value.label.trim().toLowerCase() === line.description.trim().toLowerCase() && roundMoney(value.value) === amount);
    const adjustment: QuoteAdjustment = { id: `service-${line.id}`, label: line.description, kind: /delivery|freight|shipping/i.test(line.description) ? "shipping" : "other", calculation: "fixed", value: amount, sourceLine: line };
    if (existing >= 0) adjustments[existing] = { ...adjustments[existing], sourceLine: line };
    else adjustments.push(adjustment);
  }
  return { ...quote, lines: quote.lines?.filter(value => !ids.has(value.id)), adjustments };
}
