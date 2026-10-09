import type { Batch, DeliveryLeg, DeliveryLocation, DemoSnapshot, MRF, PO } from "./types.ts";

export const DELIVERY_LEGS: DeliveryLeg[] = ["supplier-site", "supplier-warehouse", "warehouse-site"];
export function deliveryToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export const legFor = (batch: Batch): DeliveryLeg => batch.leg || "supplier-site";
export const isSiteBatch = (batch: Batch) => ["supplier-site", "warehouse-site"].includes(legFor(batch));
export const isReceivedBatch = (batch: Batch) => ["confirmed", "posted"].includes(batch.status);
export const legLabel = (batch: Batch) => ({ "supplier-site": "Supplier → Site", "supplier-warehouse": "Supplier → Company Warehouse", "warehouse-site": "Company Warehouse → Site" })[legFor(batch)];
export function batchStage(batch: Batch) {
  if (batch.status === "expected") return "Scheduled";
  if (batch.status === "dispatched") return "In transit";
  if (batch.status === "posted") return "Stock posted";
  return isSiteBatch(batch) ? "Received · To post" : "Received at warehouse";
}
export const normalizedQuantity = (value: number) => Number(value.toPrecision(15));
export const orderedQuantity = (po: PO, request: MRF | undefined, itemId: string) => normalizedQuantity(po.lines ? po.lines.filter(line => line.itemId === itemId).reduce((sum, line) => sum + line.quantity, 0) : request?.items.find(item => item.id === itemId)?.quantity || 0);
const quantity = (batch: Batch, itemId: string, field: "expected" | "accepted") => batch.lines.find(line => line.itemId === itemId)?.[field] || 0;
export const siteAcceptedFor = (state: DemoSnapshot, poId: string, itemId: string, excludingBatchId?: string) => normalizedQuantity(state.batches.filter(batch => batch.poId === poId && batch.id !== excludingBatchId && isSiteBatch(batch) && isReceivedBatch(batch)).reduce((sum, batch) => sum + quantity(batch, itemId, "accepted"), 0));
export function supplierSchedulableFor(state: DemoSnapshot, po: PO, itemId: string, excludingBatchId?: string) {
  const used = state.batches.filter(batch => batch.poId === po.id && batch.id !== excludingBatchId && legFor(batch) !== "warehouse-site").reduce((sum, batch) => {
    // Direct receipts retain their reservation until stock review fixes the final quantity.
    const resolved = legFor(batch) === "supplier-warehouse" ? isReceivedBatch(batch) : batch.status === "posted";
    return sum + quantity(batch, itemId, resolved ? "accepted" : "expected");
  }, 0);
  return Math.max(0, normalizedQuantity(orderedQuantity(po, state.requests.find(request => request.id === po.mrfId), itemId) - normalizedQuantity(used)));
}
export function warehouseAvailableFor(state: DemoSnapshot, parentId: string, itemId: string, excludingBatchId?: string) {
  const parent = state.batches.find(batch => batch.id === parentId && legFor(batch) === "supplier-warehouse" && batch.status === "confirmed");
  if (!parent) return 0;
  const allocated = state.batches.filter(batch => batch.parentBatchId === parent.id && batch.poId === parent.poId && legFor(batch) === "warehouse-site" && batch.id !== excludingBatchId).reduce((sum, batch) => sum + quantity(batch, itemId, "expected"), 0);
  return Math.max(0, normalizedQuantity(quantity(parent, itemId, "accepted") - normalizedQuantity(allocated)));
}
export function warehouseHeldFor(state: DemoSnapshot, parentId: string, itemId: string) {
  const parent = state.batches.find(batch => batch.id === parentId && legFor(batch) === "supplier-warehouse" && batch.status === "confirmed");
  if (!parent) return 0;
  const dispatched = state.batches.filter(batch => batch.parentBatchId === parent.id && batch.poId === parent.poId && legFor(batch) === "warehouse-site" && batch.status !== "expected").reduce((sum, batch) => sum + quantity(batch, itemId, "expected"), 0);
  return Math.max(0, normalizedQuantity(quantity(parent, itemId, "accepted") - normalizedQuantity(dispatched)));
}
export function batchQuantityLimit(state: DemoSnapshot, po: PO, batch: Batch, itemId: string) {
  const source = legFor(batch) === "warehouse-site" ? warehouseAvailableFor(state, batch.parentBatchId || "", itemId, batch.id) : supplierSchedulableFor(state, po, itemId, batch.id);
  const remaining = normalizedQuantity(orderedQuantity(po, state.requests.find(request => request.id === po.mrfId), itemId) - siteAcceptedFor(state, po.id, itemId, batch.id));
  return Math.max(0, Math.min(quantity(batch, itemId, "expected"), source, isSiteBatch(batch) ? remaining : source));
}
export function deliveryLocations(state: DemoSnapshot, po: PO, batch?: Batch): { origin: DeliveryLocation; destination: DeliveryLocation } {
  const request = state.requests.find(value => value.id === po.mrfId), project = state.sites.find(value => value.id === request?.siteId);
  const quote = state.quotes.find(value => value.id === po.quoteId), supplier = state.suppliers.find(value => value.id === (po.supplierId || quote?.supplierId));
  return {
    origin: batch?.origin || { name: po.document?.vendorName || supplier?.name || "Supplier", address: po.document?.vendorAddress || (po.supplierId ? "" : quote?.supplierDetails?.address) || supplier?.location || "" },
    destination: batch?.destination || { name: po.document?.shipToName || project?.name || "Site", address: po.document?.shipToAddress || project?.location || "" },
  };
}
export function deliveryPayment(state: DemoSnapshot, po: PO) {
  const arrangement = po.paymentMode === "credit" ? "Credit / terms" : po.paymentMode === "upfront" ? "Upfront" : "Arrangement not recorded";
  const methods = [...new Set([...(po.externalPayment ? [po.externalPayment.method] : []), ...state.payments.filter(payment => payment.poId === po.id).map(payment => payment.method)])];
  return `${arrangement} · ${methods.length ? methods.join(", ") : "Method not recorded"}`;
}
