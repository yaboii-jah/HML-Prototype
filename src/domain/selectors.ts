import { materialId } from "./ids.ts";
import type { DemoSnapshot, MRF, PO, Quote } from "./types.ts";

export const requestForPO = (state: DemoSnapshot, po: PO) => state.requests.find(r => r.id === po.mrfId);
export const quoteForPO = (state: DemoSnapshot, po: PO) => state.quotes.find(q => q.id === po.quoteId);
export const siteName = (state: DemoSnapshot, id: string) => state.sites.find(s => s.id === id)?.name ?? "Unknown site";
export const supplierName = (state: DemoSnapshot, po: PO) => state.suppliers.find(s => s.id === quoteForPO(state, po)?.supplierId)?.name ?? "Unknown supplier";
export const quoteTotal = (state: DemoSnapshot, quote: Quote) => state.requests.find(r => r.id === quote.mrfId)?.items.reduce((sum, item) => sum + item.quantity * (quote.prices[item.id] || 0), 0) ?? 0;
export const poTotal = (state: DemoSnapshot, po: PO) => { const quote = quoteForPO(state, po); return quote ? quoteTotal(state, quote) : 0; };
export const paidTotal = (state: DemoSnapshot, poId: string) => state.payments.filter(p => p.poId === poId).reduce((sum, p) => sum + p.amount, 0);
export const paymentStatus = (state: DemoSnapshot, po: PO) => { const paid = paidTotal(state, po.id); return paid <= 0 ? "Unpaid" : paid >= poTotal(state, po) ? "Paid" : "Partly Paid"; };
export const budgetFor = (state: DemoSnapshot, siteId: string) => {
  const allocated = state.sites.find(s => s.id === siteId)?.budget ?? 0;
  const approved = state.pos.filter(po => ["approved", "served"].includes(po.status) && requestForPO(state, po)?.siteId === siteId);
  const committed = approved.reduce((sum, po) => sum + Math.max(0, poTotal(state, po) - paidTotal(state, po.id)), 0);
  const spent = approved.reduce((sum, po) => sum + paidTotal(state, po.id), 0);
  return { allocated, committed, spent, available: allocated - committed - spent };
};
export const acceptedFor = (state: DemoSnapshot, poId: string, itemId: string, excludingBatchId?: string) => state.batches.filter(b => b.poId === poId && b.id !== excludingBatchId && b.status !== "expected").reduce((sum, b) => sum + (b.lines.find(l => l.itemId === itemId)?.accepted ?? 0), 0);
export const outstandingFor = (state: DemoSnapshot, po: PO, itemId: string) => Math.max(0, (requestForPO(state, po)?.items.find(i => i.id === itemId)?.quantity ?? 0) - acceptedFor(state, po.id, itemId));
export const schedulableFor = (state: DemoSnapshot, po: PO, itemId: string) => Math.max(0, outstandingFor(state, po, itemId) - state.batches.filter(batch => batch.poId === po.id && batch.status === "expected").reduce((sum, batch) => sum + (batch.lines.find(line => line.itemId === itemId)?.expected ?? 0), 0));
export const stockFor = (state: DemoSnapshot, siteId: string, itemName: string, unit: string) => state.movements.filter(m => m.siteId === siteId && m.itemName.toLowerCase() === itemName.toLowerCase() && m.unit.toLowerCase() === unit.toLowerCase()).reduce((sum, m) => sum + m.quantity, 0);
export const inventoryFor = (state: DemoSnapshot, siteId: string) => {
  const entries = new Map<string, { id: string; name: string; unit: string }>();
  state.movements.filter(m => m.siteId === siteId).forEach(m => entries.set(materialId(m.itemName, m.unit), { id: materialId(m.itemName, m.unit), name: m.itemName, unit: m.unit }));
  return [...entries.values()].map(item => ({ ...item, onHand: stockFor(state, siteId, item.name, item.unit) }));
};
export const materialFor = (state: DemoSnapshot, siteId: string, id: string) => inventoryFor(state, siteId).find(item => item.id === id);
export const activityFor = (state: DemoSnapshot, ids: string[]) => state.activity.filter(a => ids.includes(a.entity)).sort((a,b) => b.at.localeCompare(a.at));
export const poForRequest = (state: DemoSnapshot, request: MRF) => state.pos.find(po => po.mrfId === request.id);
export const deliveryStatus = (state: DemoSnapshot, po: PO) => {
  const items = requestForPO(state, po)?.items ?? [];
  if (items.length && items.every(item => outstandingFor(state, po, item.id) === 0)) return "Fully accepted";
  return items.some(item => acceptedFor(state, po.id, item.id) > 0) ? "Partly accepted" : "Not received";
};
export const postingStatus = (state: DemoSnapshot, po: PO) => state.batches.some(b => b.poId === po.id && b.status === "confirmed") ? "Posting pending" : state.batches.some(b => b.poId === po.id && b.status === "posted") ? "Stock posted" : "No posting";
