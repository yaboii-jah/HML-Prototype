import { orderedFor, poSupplierId } from "./selectors.ts";
import { suitabilityQuantityFor } from "./stock-suitability.ts";
import { transferQuantityFor } from "./stock-transfers.ts";
import type { DemoSnapshot, PO, POLine } from "./types.ts";

/** Validate direct PO edits without changing the original supplier quotation. */
export function directPoError(state: DemoSnapshot, po: PO, lines: POLine[], supplierId: string) {
  const request = state.requests.find(value => value.id === po.mrfId);
  if (!request || !state.suppliers.some(value => value.id === supplierId)) return "Choose an existing supplier and a valid MRF.";
  if (state.pos.some(value => value.id !== po.id && value.mrfId === po.mrfId && value.status !== "rejected" && poSupplierId(state, value) === supplierId)) return "An active PO already exists for this supplier and MRF.";
  if (!lines.length) return "Add at least one requested material.";
  const quantities = new Map<string, number>();
  const ids = new Set<string>();
  for (const line of lines) {
    if (!request.items.some(value => value.id === line.itemId) || ids.has(line.quoteLineId) || !line.quoteLineId || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice <= 0) return "Choose MRF materials with positive quantities and prices.";
    ids.add(line.quoteLineId);
    if (!["none", "percentage", "fixed"].includes(line.discountType || "none") || !Number.isFinite(line.discountValue ?? 0) || (line.discountValue || 0) < 0 || line.discountType === "percentage" && (line.discountValue || 0) > 100 || line.discountType === "fixed" && (line.discountValue || 0) > line.quantity * line.unitPrice || !Number.isFinite(line.taxRate ?? 0) || (line.taxRate || 0) < 0) return "Review PO line discounts and tax rates.";
    quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + line.quantity);
  }
  for (const item of request.items) {
    const existing = state.pos.filter(value => value.id !== po.id && value.mrfId === po.mrfId && value.status !== "rejected").reduce((sum, value) => sum + orderedFor(state, value, item.id), 0);
    const staged = state.pendingAwards.filter(value => value.requestId === request.id && value.itemId === item.id).reduce((sum, value) => sum + value.quantity, 0);
    if (existing + staged + transferQuantityFor(state, request.id, item.id) + suitabilityQuantityFor(state, request.id, item.id) + (quantities.get(item.id) || 0) > item.quantity + .000001) return "Awarded quantities exceed the MRF request or overlap stock requests and suitability reviews.";
  }
  return "";
}
