import type { POAdjustment, POLine, QuoteAdjustment, QuoteLine } from "./types.ts";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function pricedLine(quantity: number, unitPrice: number, discountType: "none" | "percentage" | "fixed" = "none", discountValue = 0, taxRate = 0) {
  const base = roundMoney(quantity * unitPrice);
  const discount = discountType === "percentage" ? roundMoney(base * discountValue / 100) : discountType === "fixed" ? discountValue : 0;
  const afterDiscount = Math.max(0, roundMoney(base - discount));
  return roundMoney(afterDiscount + roundMoney(afterDiscount * taxRate / 100));
}

export const quoteLineTotal = (line: QuoteLine) => pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, line.taxRate);
export const poLineTotal = (line: POLine) => pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, line.taxRate);

export function totalWithAdjustments(subtotal: number, adjustments: (QuoteAdjustment | POAdjustment)[]) {
  return roundMoney(adjustments.reduce((total, adjustment) => {
    if ("included" in adjustment && !adjustment.included) return total;
    const amount = adjustment.calculation === "percentage" ? roundMoney(subtotal * adjustment.value / 100) : adjustment.value;
    return total + (adjustment.kind === "discount" ? -amount : amount);
  }, subtotal));
}
