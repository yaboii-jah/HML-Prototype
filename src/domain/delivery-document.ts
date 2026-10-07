import { DELIVERY_LEGS, isSiteBatch, legFor, orderedQuantity } from "./delivery-flow.ts";
import { validIdentity } from "./audit.ts";
import type { Batch, MRF, PO, Site } from "./types.ts";

export type DeliveryReceiptData = { kind: "delivery"; batch: Batch; parentBatch?: Batch; request: MRF; po: PO; project: Site };
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export function validDeliveryReceipt(value: unknown): value is DeliveryReceiptData {
  if (!value || typeof value !== "object") return false;
  const body = value as DeliveryReceiptData, { batch, po, request, project, parentBatch } = body;
  if (body.kind !== "delivery" || !batch || !po || !request || !project || ![batch.id, batch.poId, po.id, po.mrfId, request.id, request.siteId, project.id].every(text) || !text(batch.ref) || !text(po.ref) || !text(request.ref) || po.status !== "released" || batch.poId !== po.id || po.mrfId !== request.id || request.siteId !== project.id || !text(project.name) || typeof project.location !== "string") return false;
  if (!["expected", "dispatched", "confirmed", "posted"].includes(batch.status) || batch.leg !== undefined && !DELIVERY_LEGS.includes(batch.leg) || !Array.isArray(batch.lines) || !batch.lines.length || batch.lines.length > 2000 || !Array.isArray(request.items) || request.items.length > 2000 || !request.items.every(item => item && text(item.id) && text(item.name) && text(item.unit) && Number.isFinite(item.quantity) && item.quantity > 0)) return false;
  if (typeof batch.scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(batch.scheduledDate) || !Number.isFinite(Date.parse(batch.scheduledDate)) || new Date(batch.scheduledDate).toISOString().slice(0, 10) !== batch.scheduledDate || typeof batch.evidence !== "string" || typeof batch.delayReason !== "string" || batch.postingReason !== undefined && typeof batch.postingReason !== "string") return false;
  if (po.lines !== undefined && (!Array.isArray(po.lines) || !po.lines.every(line => line && text(line.itemId) && Number.isFinite(line.quantity) && line.quantity > 0))) return false;
  if (new Set(batch.lines.map(line => line?.itemId)).size !== batch.lines.length || !batch.lines.every(line => line && request.items.some(item => item.id === line.itemId) && Number.isFinite(line.expected) && line.expected >= 0 && Number.isFinite(line.accepted) && line.accepted >= 0 && line.accepted <= line.expected && typeof line.issue === "string")) return false;
  if (!batch.lines.every(line => line.expected <= orderedQuantity(po, request, line.itemId))) return false;
  for (const location of [batch.origin, batch.destination]) if (location !== undefined && (!location || !text(location.name) || typeof location.address !== "string")) return false;
  if (batch.leg && (!batch.origin || !batch.destination || !text(batch.destination.address))) return false;
  for (const timestamp of [batch.dispatchedAt, batch.receivedAt, batch.postedAt]) if (timestamp !== undefined && (typeof timestamp !== "string" || !timestamp.includes("T") || !Number.isFinite(Date.parse(timestamp)))) return false;
  for (const [identity, role] of [[batch.createdByIdentity, "Logistics"], [batch.dispatchedByIdentity, "Logistics"], [batch.receivedByIdentity, isSiteBatch(batch) ? "Site Personnel" : "Procurement"], [batch.postedByIdentity, "Site Personnel"]] as const) if (identity !== undefined && (!identity || typeof identity !== "object" || !validIdentity(identity) || identity.role !== role)) return false;
  if (!isSiteBatch(batch) && batch.status === "posted") return false;
  if (legFor(batch) === "warehouse-site") {
    if (!parentBatch || parentBatch.id !== batch.parentBatchId || parentBatch.poId !== po.id || legFor(parentBatch) !== "supplier-warehouse" || parentBatch.status !== "confirmed" || !Array.isArray(parentBatch.lines) || !parentBatch.destination || batch.origin?.name !== parentBatch.destination.name || batch.origin?.address !== parentBatch.destination.address) return false;
    if (!batch.lines.every(line => line.expected <= (parentBatch.lines.find(parentLine => parentLine.itemId === line.itemId)?.accepted ?? -1))) return false;
  } else if (batch.parentBatchId) return false;
  return true;
}
