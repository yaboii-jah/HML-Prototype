import { poFinancialBreakdown, poLineTotal } from "../domain/pricing.ts";
import type { MRF, PO, Quote } from "../domain/types.ts";
import { documentMoney, documentTemplate } from "./document-template.ts";
import { drawPoLayout } from "./po-table-layout.ts";

export async function generatePoPdf(po: PO, request: MRF, quote: Quote, projectName: string) {
  const template = await documentTemplate("po");
  const { pdf } = template;
  const lines = po.lines || (quote.lines ? quote.lines.map(line => ({ itemId: line.requestItemId, quoteLineId: line.id, quantity: line.quantity * (line.requestItemId ? line.conversionFactor : 1), unitPrice: line.unitPrice / (line.requestItemId ? line.conversionFactor : 1), discountType: line.discountType, discountValue: line.discountValue, taxRate: line.taxRate })) : request.items.map(item => ({ itemId: item.id, quoteLineId: "", quantity: item.quantity, unitPrice: quote.prices[item.id] || 0 })));
  // Legacy POs priced the complete source quotation, including its charges.
  const pricedPo = po.lines ? po : { ...po, lines, adjustments: quote.lines ? (quote.adjustments || [
    { id: "tax", label: "Tax", kind: "tax" as const, calculation: "fixed" as const, value: quote.tax || 0 },
    { id: "freight", label: "Delivery Fee", kind: "shipping" as const, calculation: "fixed" as const, value: quote.freight || 0 },
    { id: "discount", label: "Discount", kind: "discount" as const, calculation: "fixed" as const, value: quote.discount || 0 },
  ]).filter(value => value.value).map(value => ({ ...value, included: true, confirmed: true })) : [] };
  const financial = poFinancialBreakdown(pricedPo);
  const rows: string[][] = [];
  for (const [index, line] of lines.entries()) {
    const item = request.items.find(value => value.id === line.itemId);
    const amount = po.financial ? financial.lines[index]?.amount || 0 : poLineTotal(line);
    const source = quote.lines?.find(value => value.id === line.quoteLineId);
    rows.push([String(index + 1), item?.name || source?.description || "", String(line.quantity), item?.unit || source?.unit || "", documentMoney(line.quantity ? amount / line.quantity : 0), documentMoney(amount)]);
  }
  for (const value of financial.adjustments) rows.push([String(rows.length + 1), value.adjustment.label, "1", "LOT", documentMoney(value.amount), documentMoney(value.amount)]);
  if (!pricedPo.adjustments) for (const [label, amount] of [["Delivery Fee", po.freight || 0], ["Discount", -(po.discount || 0)], ["Tax", po.tax || 0]] as const) if (amount) rows.push([String(rows.length + 1), label, "1", "LOT", documentMoney(amount), documentMoney(amount)]);
  drawPoLayout(template, po, request, quote, projectName, rows, financial);
  return pdf.save();
}
