import type { PO, POAdjustment, POLine, QuoteAdjustment, QuoteLine } from "./types.ts";

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

export function poFinancialBreakdown(po: PO) {
  const settings = po.financial;
  const multiplier = settings?.vatStatus === "VAT" && settings.priceBasis === "exclusive" ? 1 + settings.vatRate / 100 : 1;
  const lines = (po.lines || []).map(line => ({ line, amount: roundMoney(pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, settings ? 0 : line.taxRate) * multiplier) }));
  const inputSubtotal = (po.lines || []).reduce((sum, line) => sum + pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, settings ? 0 : line.taxRate), 0);
  const adjustments = (po.adjustments || []).filter(value => value.included && (!settings || value.kind !== "tax")).map(adjustment => {
    const base = adjustment.calculation === "percentage" ? roundMoney(inputSubtotal * adjustment.value / 100) : adjustment.value;
    const amount = roundMoney(base * (adjustment.taxable === false ? 1 : multiplier)) * (adjustment.kind === "discount" ? -1 : 1);
    return { adjustment, amount };
  });
  const legacyCharges = po.adjustments ? 0 : (po.tax || 0) + (po.freight || 0) - (po.discount || 0);
  const gross = roundMoney(lines.reduce((sum, value) => sum + value.amount, 0) + adjustments.reduce((sum, value) => sum + value.amount, 0) + legacyCharges);
  const ewtGoods = settings?.ewtGoods || 0, ewtServices = settings?.ewtServices || 0;
  return { lines, adjustments, gross, ewtGoods, ewtServices, net: roundMoney(gross - ewtGoods - ewtServices) };
}

export function poFinancialError(po: PO, finalizing = false) {
  if (!po.financial) return "";
  const settings = po.financial;
  if (!["VAT", "NON-VAT"].includes(settings.vatStatus) || !["inclusive", "exclusive"].includes(settings.priceBasis) || [settings.vatRate, settings.ewtGoods, settings.ewtServices].some(value => !Number.isFinite(value) || value < 0) || settings.vatRate > 100) return "Review the VAT basis, rate and nonnegative EWT amounts.";
  if (settings.ewtGoods + settings.ewtServices > poFinancialBreakdown(po).gross) return "EWT deductions cannot exceed the gross PO amount.";
  if (finalizing && !settings.reviewed) return "Confirm the VAT basis and both EWT amounts before Accounting approval.";
  if (finalizing && (!po.document || ![po.document.date, po.document.vendorName, po.document.shipToName, po.document.shipToAddress, po.document.requisitioner, po.document.terms].every(value => typeof value === "string" && value.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(po.document.date) || Number.isNaN(Date.parse(po.document.date)) || new Date(po.document.date).toISOString().slice(0, 10) !== po.document.date)) return "Complete the PO date, vendor, ship-to name/address, requisitioner and payment terms.";
  return "";
}
