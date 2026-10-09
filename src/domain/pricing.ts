import type { PO, POAdjustment, POFinancial, POLine, Quote, QuoteAdjustment, QuoteLine, QuotationFinancial } from "./types.ts";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function pricedLine(quantity: number, unitPrice: number, discountType: "none" | "percentage" | "fixed" = "none", discountValue = 0, taxRate = 0) {
  const base = roundMoney(quantity * unitPrice);
  const discount = discountType === "percentage" ? roundMoney(base * discountValue / 100) : discountType === "fixed" ? discountValue : 0;
  const afterDiscount = Math.max(0, roundMoney(base - discount));
  return roundMoney(afterDiscount + roundMoney(afterDiscount * taxRate / 100));
}

export const quoteLineTotal = (line: QuoteLine) => pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, line.taxRate);
export const poLineTotal = (line: POLine) => pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue, line.taxRate);
export function quotationLineAmount(quote: Quote, line: QuoteLine) {
  if (!quote.financial) return quoteLineTotal(line);
  const settings = quote.financial;
  return roundMoney(pricedLine(line.quantity, line.unitPrice, line.discountType, line.discountValue) * (settings.vatStatus === "VAT" && settings.priceBasis === "exclusive" ? 1 + settings.vatRate / 100 : 1));
}

export function totalWithAdjustments(subtotal: number, adjustments: (QuoteAdjustment | POAdjustment)[]) {
  return roundMoney(adjustments.reduce((total, adjustment) => {
    if ("included" in adjustment && !adjustment.included) return total;
    const amount = adjustment.calculation === "percentage" ? roundMoney(subtotal * adjustment.value / 100) : adjustment.value;
    return total + (adjustment.kind === "discount" ? -amount : amount);
  }, subtotal));
}

export const defaultQuotationFinancial = (): QuotationFinancial => ({ vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, reviewed: false });
export function quotationFinancialError(settings: QuotationFinancial) {
  return !["VAT", "NON-VAT"].includes(settings.vatStatus) || !["inclusive", "exclusive"].includes(settings.priceBasis) || !Number.isFinite(settings.vatRate) || settings.vatRate < 0 || settings.vatRate > 100 ? "Review the VAT status, price basis and VAT rate." : "";
}

export function poFinancialBreakdown(po: Pick<PO, "lines" | "adjustments" | "financial" | "tax" | "freight" | "discount">) {
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
  const divisor = settings?.vatStatus === "VAT" && settings.priceBasis === "inclusive" ? 1 + settings.vatRate / 100 : 1;
  const goodsBase = inputSubtotal / divisor;
  const servicesBase = (po.adjustments || []).filter(value => value.included && value.taxable !== false && (value.kind === "shipping" || value.kind === "other")).reduce((sum, value) => {
    const amount = value.calculation === "percentage" ? roundMoney(inputSubtotal * value.value / 100) : value.value;
    return sum + amount / divisor;
  }, 0);
  const calculatedGoods = settings?.vatStatus === "VAT" ? roundMoney(goodsBase * .01) : 0;
  const calculatedServices = settings?.vatStatus === "VAT" ? roundMoney(servicesBase * .02) : 0;
  const revised = !!settings?.ewtMode;
  const nonVat = revised && settings?.vatStatus === "NON-VAT";
  const goodsManual = settings?.ewtMode === "manual" && settings.ewtGoodsManual !== false;
  const servicesManual = settings?.ewtMode === "manual" && settings.ewtServicesManual !== false;
  const ewtGoods = nonVat ? 0 : revised && !goodsManual ? calculatedGoods : settings?.ewtGoods || 0;
  const ewtServices = nonVat ? 0 : revised && !servicesManual ? calculatedServices : settings?.ewtServices || 0;
  return { lines, adjustments, gross, goodsBase, servicesBase, calculatedGoods, calculatedServices, ewtGoods, ewtServices, net: roundMoney(gross - ewtGoods - ewtServices) };
}

export function quoteFinancialBreakdown(quote: Quote) {
  if (!quote.financial) return undefined;
  return poFinancialBreakdown({ financial: { ...quote.financial, ewtMode: "automatic", ewtGoods: 0, ewtServices: 0 }, lines: (quote.lines || []).map(line => ({ ...line, itemId: line.requestItemId, quoteLineId: line.id })), adjustments: (quote.adjustments || []).map(value => ({ ...value, included: true, confirmed: true })) });
}

export function calculatedPoFinancial(po: Pick<PO, "lines" | "adjustments" | "financial" | "tax" | "freight" | "discount">): POFinancial | undefined {
  if (!po.financial) return undefined;
  const breakdown = poFinancialBreakdown(po);
  return { ...po.financial, ewtGoods: breakdown.ewtGoods, ewtServices: breakdown.ewtServices };
}

export function poFinancialError(po: PO, finalizing = false) {
  if (!po.financial) return "";
  const settings = po.financial;
  if (settings.ewtMode !== undefined && !["automatic", "manual"].includes(settings.ewtMode)) return "Choose calculated or manual EWT.";
  if (settings.ewtMode && settings.vatStatus === "NON-VAT" && (settings.ewtGoods || settings.ewtServices)) return "NON VAT purchase orders must have zero EWT.";
  if (!["VAT", "NON-VAT"].includes(settings.vatStatus) || !["inclusive", "exclusive"].includes(settings.priceBasis) || [settings.vatRate, settings.ewtGoods, settings.ewtServices].some(value => !Number.isFinite(value) || value < 0) || settings.vatRate > 100) return "Review the VAT basis, rate and nonnegative EWT amounts.";
  const breakdown = poFinancialBreakdown(po);
  if (breakdown.ewtGoods + breakdown.ewtServices > breakdown.gross) return "EWT deductions cannot exceed the gross PO amount.";
  if (finalizing && !settings.reviewed) return "Confirm the VAT basis and both EWT amounts before Accounting approval.";
  if (finalizing && (!po.document || ![po.document.date, po.document.vendorName, po.document.shipToName, po.document.shipToAddress, po.document.requisitioner, po.document.terms].every(value => typeof value === "string" && value.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(po.document.date) || Number.isNaN(Date.parse(po.document.date)) || new Date(po.document.date).toISOString().slice(0, 10) !== po.document.date)) return "Complete the PO date, vendor, ship-to name/address, requisitioner and payment terms.";
  return "";
}
