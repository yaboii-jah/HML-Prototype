import { isExternalCredit, isExternalPayment } from "./full-disbursement.ts";
import { isSiteBatch, normalizedQuantity, orderedQuantity, siteAcceptedFor, supplierSchedulableFor } from "./delivery-flow.ts";
import { stockMaterialsAt } from "./stock-matching.ts";
import { sourceStockOnHand } from "./stock-transfers.ts";
import { poFinancialBreakdown, poLineTotal, quoteFinancialBreakdown, quoteLineTotal, totalWithAdjustments } from "./pricing.ts";
import type { DemoSnapshot, MRF, PO, Quote } from "./types.ts";

export const requestForPO = (state: DemoSnapshot, po: PO) => state.requests.find(r => r.id === po.mrfId);
export const quoteForPO = (state: DemoSnapshot, po: PO) => state.quotes.find(q => q.id === po.quoteId);
export const siteName = (state: DemoSnapshot, id: string) => state.sites.find(s => s.id === id)?.name ?? "Unknown site";
export const earliestNeededDate = (request: MRF) => request.items.map(item => item.neededDate).filter(Boolean).sort()[0] ?? "";
export const poSupplierId = (state: DemoSnapshot, po: PO) => po.supplierId || quoteForPO(state, po)?.supplierId;
export const supplierName = (state: DemoSnapshot, po: PO) => state.suppliers.find(s => s.id === poSupplierId(state, po))?.name ?? po.document?.vendorName ?? "Unknown supplier";
export const poItems = (state: DemoSnapshot, po: PO) => {
  const request = requestForPO(state, po);
  return request?.items.filter(item => !po.lines || po.lines.some(line => line.itemId === item.id)) ?? [];
};
export const orderedFor = (state: DemoSnapshot, po: PO, itemId: string) => orderedQuantity(po, requestForPO(state, po), itemId);
export const poItemTotal = (state: DemoSnapshot, po: PO, itemId: string) => po.lines ? po.financial ? poFinancialBreakdown(po).lines.filter(value => value.line.itemId === itemId).reduce((sum, value) => sum + value.amount, 0) : po.lines.filter(line => line.itemId === itemId).reduce((sum, line) => sum + poLineTotal(line), 0) : orderedFor(state, po, itemId) * (quoteForPO(state, po)?.prices[itemId] || 0);
export const quoteTotal = (state: DemoSnapshot, quote: Quote) => quote.financial ? quoteFinancialBreakdown(quote)!.gross : quote.lines
  ? quote.adjustments ? totalWithAdjustments(quote.lines.reduce((sum, line) => sum + quoteLineTotal(line), 0), quote.adjustments) : quote.lines.reduce((sum, line) => sum + quoteLineTotal(line), 0) + (quote.tax || 0) + (quote.freight || 0) - (quote.discount || 0)
  : state.requests.find(r => r.id === quote.mrfId)?.items.reduce((sum, item) => sum + item.quantity * (quote.prices[item.id] || 0), 0) ?? 0;
export const poTotal = (state: DemoSnapshot, po: PO) => po.financial ? poFinancialBreakdown(po).net : po.lines
  ? po.adjustments ? totalWithAdjustments(po.lines.reduce((sum, line) => sum + poLineTotal(line), 0), po.adjustments) : po.lines.reduce((sum, line) => sum + poLineTotal(line), 0) + (po.tax || 0) + (po.freight || 0) - (po.discount || 0)
  : (quoteForPO(state, po) ? quoteTotal(state, quoteForPO(state, po)!) : 0);
export const paidTotal = (state: DemoSnapshot, poId: string) => { const po = state.pos.find(value => value.id === poId); return po && isExternalCredit(po) ? Math.round((po.creditPayments || []).filter(payment => !payment.voided).reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100 : po && isExternalPayment(po) ? po.externalPayment?.amount || 0 : state.payments.filter(p => p.poId === poId).reduce((sum, p) => sum + p.amount, 0); };
export const paymentStatus = (state: DemoSnapshot, po: PO) => { const paid = paidTotal(state, po.id); return paid <= 0 ? "Unpaid" : paid >= poTotal(state, po) ? "Paid" : "Partly Paid"; };
export const budgetFor = (state: DemoSnapshot, siteId: string) => {
  const allocated = state.sites.find(s => s.id === siteId)?.budget ?? 0;
  const approved = state.pos.filter(po => ["approved", "released"].includes(po.status) && requestForPO(state, po)?.siteId === siteId);
  const committed = approved.reduce((sum, po) => sum + Math.max(0, poTotal(state, po) - paidTotal(state, po.id)), 0);
  const spent = approved.reduce((sum, po) => sum + paidTotal(state, po.id), 0);
  return { allocated, committed, spent, available: allocated - committed - spent };
};
export const acceptedFor = siteAcceptedFor;
export const outstandingFor = (state: DemoSnapshot, po: PO, itemId: string) => Math.max(0, normalizedQuantity(orderedFor(state, po, itemId) - acceptedFor(state, po.id, itemId)));
export const schedulableFor = supplierSchedulableFor;
export const stockFor = sourceStockOnHand;
export const inventoryFor = (state: DemoSnapshot, siteId: string) => {
  return stockMaterialsAt(state, siteId).map(item => ({ ...item, onHand: stockFor(state, siteId, item.name, item.unit) }));
};
export const materialFor = (state: DemoSnapshot, siteId: string, id: string) => inventoryFor(state, siteId).find(item => item.id === id);
export const activityFor = (state: DemoSnapshot, ids: string[]) => state.activity.filter(a => ids.includes(a.entity) || !!a.requestId && ids.includes(a.requestId) || !!a.poId && ids.includes(a.poId)).sort((a,b) => b.at.localeCompare(a.at));
export const poForRequest = (state: DemoSnapshot, request: MRF) => state.pos.find(po => po.mrfId === request.id);
export const posForRequest = (state: DemoSnapshot, request: MRF) => state.pos.filter(po => po.mrfId === request.id);
export const deliveryStatus = (state: DemoSnapshot, po: PO) => {
  const items = poItems(state, po);
  if (items.length && items.every(item => outstandingFor(state, po, item.id) === 0)) return "Fully accepted";
  return items.some(item => acceptedFor(state, po.id, item.id) > 0) ? "Partly accepted" : "Not received";
};
export const postingStatus = (state: DemoSnapshot, po: PO) => state.batches.some(b => b.poId === po.id && isSiteBatch(b) && b.status === "confirmed") ? "Posting pending" : state.batches.some(b => b.poId === po.id && b.status === "posted") ? "Stock posted" : "No posting";
