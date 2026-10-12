import { pricedLine, quoteFinancialBreakdown, roundMoney } from "../../domain/pricing.ts";
import type { Quote } from "../../domain/types.ts";

export function quotationReviewMoney(quote: Pick<Quote, "currency">, value: number) {
  if (!Number.isFinite(value)) return "—";
  const currency = quote.currency?.trim().toUpperCase() || "PHP";
  const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const amount = value === 0 ? 0 : value;
  return currency === "PHP"
    ? new Intl.NumberFormat("en-PH", { ...options, style: "currency", currency }).format(amount)
    : `${currency} ${new Intl.NumberFormat("en-PH", options).format(amount)}`;
}

/** Presentation amounts reconcile to the existing quotation calculation, never a second tax calculation. */
export function quotationReviewSummary(quote: Quote) {
  const summary = quoteFinancialBreakdown(quote);
  if (!summary) return undefined;
  const materials = roundMoney((quote.lines || []).reduce((sum, line) => sum + pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue), 0));
  // Percentage adjustments use the original unrounded subtotal in the pricing engine.
  const inputSubtotal = (quote.lines || []).reduce((sum, line) => sum + pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue), 0);
  const adjustments = (quote.adjustments || []).map(adjustment => {
    const recorded = summary.adjustments.find(value => value.adjustment.id === adjustment.id);
    const base = adjustment.calculation === "percentage" ? roundMoney(inputSubtotal * adjustment.value / 100) : adjustment.value;
    return { adjustment, amount: adjustment.kind === "tax" ? 0 : roundMoney(base) * (adjustment.kind === "discount" ? -1 : 1), contribution: recorded?.amount ?? 0, ignored: adjustment.kind === "tax" };
  });
  const beforeVat = roundMoney(materials + adjustments.reduce((sum, value) => sum + value.amount, 0));
  return { materials, adjustments, vatAdded: roundMoney(summary.gross - beforeVat), gross: summary.gross, ewtGoods: summary.ewtGoods, ewtServices: summary.ewtServices, net: summary.net };
}
