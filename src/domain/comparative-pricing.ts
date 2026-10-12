import { quotationFinancialError, quotationLineAmount, roundMoney } from "./pricing.ts";
import type { Item, Quote, QuoteLine } from "./types.ts";

/** A comparison price is a material price, not a PO payable or an awarded-price promise. */
export function comparisonFinancialError(quote: Quote): string {
  if (quote.currency && quote.currency !== "PHP") return "Only PHP offers can be compared.";
  if (!quote.financial || !quote.financial.reviewed || quotationFinancialError(quote.financial)) return "VAT review needed";
  return "";
}

export function comparableUnitPrice(quote: Quote, line: QuoteLine): number | undefined {
  if (comparisonFinancialError(quote) || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.conversionFactor) || line.conversionFactor <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice <= 0) return undefined;
  const amount = quotationLineAmount(quote, line);
  const result = amount / (line.quantity * line.conversionFactor);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

export function comparableMaterialAmount(quote: Quote, line: QuoteLine, item: Pick<Item, "quantity">): number | undefined {
  const price = comparableUnitPrice(quote, line);
  if (price === undefined || !Number.isFinite(item.quantity) || item.quantity < 0) return undefined;
  const amount = roundMoney(item.quantity * price);
  return Number.isFinite(amount) ? amount : undefined;
}

export const comparisonPriceText = (price: number) => `₱${price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
