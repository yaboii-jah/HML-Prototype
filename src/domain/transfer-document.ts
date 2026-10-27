import { equivalentStockUnit } from "./stock-matching.ts";
import { validTransferStockPosting } from "./transfer-stock-posting.ts";
import { materialId } from "./ids.ts";
import { requestSourcing, sourceStockOnHand, transferReservedFor } from "./stock-transfers.ts";
import { COMPANY_WAREHOUSE } from "./company.ts";
import { isTransferSiteDelivery, isTransferSourceDelivery, transferLegFor, transferReceivingRole } from "./transfer-delivery-flow.ts";
import type { DeliveryLocation, DemoSnapshot, TransferReceiptData } from "./types.ts";

const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const time = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const sameLocation = (a: DeliveryLocation, b: DeliveryLocation) => a?.name === b?.name && a?.address === b?.address;
export function validTransferReceipt(value: unknown): value is TransferReceiptData {
  try {
    const data = value as TransferReceiptData, { transfer, delivery, request, project, sourceProject } = data;
    if (data.kind !== "transfer" || !transfer || !delivery || !request || !project || !sourceProject || transfer.status !== "approved" || !text(transfer.id) || !text(transfer.ref) || !text(delivery.ref) || !text(delivery.id) || delivery.transferId !== transfer.id || transfer.requestId !== request.id || transfer.destinationSiteId !== request.siteId || project.id !== request.siteId || sourceProject.id !== transfer.sourceSiteId || project.id === sourceProject.id || !text(project.name) || !text(sourceProject.name)) return false;
    if (!["expected", "dispatched", "confirmed", "posted"].includes(delivery.status) || !Array.isArray(delivery.lines) || !delivery.lines.length || delivery.lines.length > 2000 || !Array.isArray(transfer.lines) || !Array.isArray(request.items)) return false;
    if (!text(delivery.origin?.name) || !text(delivery.origin?.address) || !text(delivery.destination?.name) || !text(delivery.destination?.address) || !time(delivery.scheduledDate) || !time(transfer.reviewedAt) || transfer.reviewedBy?.role !== "Site Personnel") return false;
    const leg = transferLegFor(delivery), parent = data.parentDelivery;
    if (!["site-site", "site-warehouse", "warehouse-site"].includes(leg)) return false;
    if (leg === "warehouse-site") {
      if (!parent || parent.id === delivery.id || parent.id !== delivery.parentDeliveryId || parent.transferId !== transfer.id || transferLegFor(parent) !== "site-warehouse" || parent.status !== "confirmed" || !validTransferReceipt({ ...data, delivery: parent, parentDelivery: undefined }) || !sameLocation(delivery.origin, parent.destination)) return false;
    } else if (delivery.parentDeliveryId !== undefined || parent || !sameLocation(delivery.origin, transfer.origin)) return false;
    if (!sameLocation(delivery.destination, leg === "site-warehouse" ? COMPANY_WAREHOUSE : transfer.destination)) return false;
    if (new Set(delivery.lines.map(line => line.transferLineId)).size !== delivery.lines.length) return false;
    if (delivery.status !== "expected" && (!time(delivery.dispatchedAt) || delivery.dispatchedBy?.role !== "Logistics")) return false;
    if (["confirmed", "posted"].includes(delivery.status) && (!time(delivery.receivedAt) || delivery.receivedBy?.role !== transferReceivingRole(delivery))) return false;
    if (delivery.status === "posted" && (!isTransferSiteDelivery(delivery) || !time(delivery.postedAt) || delivery.postedBy?.role !== "Site Personnel")) return false;
    return delivery.lines.every(line => {
      const source = transfer.lines.find(value => value.id === line.transferLineId), item = request.items.find(value => value.id === line.itemId);
      if (line.stockPosting !== undefined && (!item || delivery.status !== "posted" || line.accepted <= 0 || !validTransferStockPosting(line.stockPosting, item))) return false;
      return !!source && !!item && source.itemId === item.id && text(item.name) && text(source.sourceName) && source.sourceMaterialId === materialId(source.sourceName, source.unit) && equivalentStockUnit(source.unit, item.unit) && amount(line.expected) && line.expected > 0 && line.expected <= source.approved && (!parent || line.expected <= (parent.lines.find(value => value.transferLineId === line.transferLineId && value.itemId === line.itemId)?.accepted || 0)) && amount(line.accepted) && line.accepted <= line.expected && typeof line.issue === "string" && (!["confirmed", "posted"].includes(delivery.status) || line.accepted === line.expected || line.issue.trim().length >= 5);
    });
  } catch { return false; }
}
export function validTransferState(state: DemoSnapshot) {
  try {
    if (state.stockTransfers !== undefined && !Array.isArray(state.stockTransfers) || state.transferDeliveries !== undefined && !Array.isArray(state.transferDeliveries)) return false;
    const transfers = state.stockTransfers || [], deliveries = state.transferDeliveries || [];
    if (new Set(transfers.map(value => value.id)).size !== transfers.length || new Set(deliveries.map(value => value.id)).size !== deliveries.length) return false;
    for (const transfer of transfers) {
      const request = state.requests.find(value => value.id === transfer.requestId);
      if (!request || request.siteId !== transfer.destinationSiteId || transfer.sourceSiteId === transfer.destinationSiteId || !state.sites.some(value => value.id === transfer.sourceSiteId) || !["pending", "approved", "rejected", "cancelled"].includes(transfer.status) || !text(transfer.ref) || !time(transfer.createdAt) || !Array.isArray(transfer.lines) || !transfer.lines.length || new Set(transfer.lines.map(value => value.id)).size !== transfer.lines.length) return false;
      if (transfer.lines.some(line => !text(line.id) || !text(line.sourceName) || !text(line.unit) || line.sourceMaterialId !== materialId(line.sourceName, line.unit) || line.suitabilityConfirmed !== true || !request.items.some(item => item.id === line.itemId && equivalentStockUnit(item.unit, line.unit)) || !amount(line.proposed) || line.proposed <= 0 || !amount(line.approved) || line.approved > line.proposed || !amount(line.cancelled) || line.cancelled > line.approved)) return false;
      if (transfer.lines.some(line => line.suitabilityReviewId && !state.stockSuitabilityReviews?.some(review => review.id === line.suitabilityReviewId && review.status === "used" && review.transferId === transfer.id && review.requestId === transfer.requestId && review.itemId === line.itemId && review.sourceSiteId === transfer.sourceSiteId && review.sourceMaterialId === line.sourceMaterialId && review.released === line.proposed))) return false;
      if (transfer.status === "approved" && (!time(transfer.reviewedAt) || transfer.reviewedBy?.role !== "Site Personnel" || !transfer.lines.some(line => line.approved > 0))) return false;
      if (request.items.some(item => { const row = requestSourcing(state, request, item); return row.ordered + row.transfers + row.staged + row.suitability > row.requested + .000001; })) return false;
      if (transfer.lines.some(line => sourceStockOnHand(state, transfer.sourceSiteId, line.sourceName, line.unit) + .000001 < transferReservedFor(state, transfer.sourceSiteId, line.sourceMaterialId))) return false;
      for (const line of transfer.lines) {
        const total = deliveries.filter(value => value.transferId === transfer.id && isTransferSourceDelivery(value) && value.status !== "cancelled").flatMap(value => value.lines).filter(value => value.transferLineId === line.id).reduce((sum, value) => sum + value.expected, 0);
        if (total + line.cancelled > line.approved + .000001) return false;
      }
      if (transfer.documents?.some(doc => !text(doc.id) || !text(doc.localFileId) || !/^[a-f0-9]{64}$/.test(doc.sha256) || !amount(doc.size) || doc.size <= 0 || !deliveries.some(batch => batch.id === doc.deliveryId && batch.transferId === transfer.id) || !["Signed delivery receipt", "Other"].includes(doc.kind))) return false;
    }
    for (const delivery of deliveries) {
      const transfer = transfers.find(value => value.id === delivery.transferId), request = state.requests.find(value => value.id === transfer?.requestId), project = state.sites.find(value => value.id === transfer?.destinationSiteId), sourceProject = state.sites.find(value => value.id === transfer?.sourceSiteId);
      if (!transfer || !request || !project || !sourceProject) return false;
      if (delivery.status === "cancelled" && !text(delivery.reason)) return false;
      const parentDelivery = deliveries.find(value => value.id === delivery.parentDeliveryId);
      if (!validTransferReceipt({ kind: "transfer", transfer: delivery.status === "cancelled" ? { ...transfer, status: "approved" } : transfer, delivery: delivery.status === "cancelled" ? { ...delivery, status: "expected" } : delivery, parentDelivery, request, project, sourceProject })) return false;
      if (transferLegFor(delivery) === "site-warehouse") for (const line of delivery.lines) {
        const allocated = deliveries.filter(value => value.parentDeliveryId === delivery.id && value.status !== "cancelled").flatMap(value => value.lines).filter(value => value.transferLineId === line.transferLineId).reduce((sum, value) => sum + value.expected, 0);
        if (allocated > line.accepted + .000001) return false;
      }
      if (delivery.receiptVersions?.some((receipt, index) => receipt.version !== index + 1 || !text(receipt.id) || receipt.data.delivery.id !== delivery.id || !validTransferReceipt(receipt.data) || !["confirmed", "posted"].includes(receipt.data.delivery.status))) return false;
    }
    // Reconcile the physical ledger with each trip, including deliberate zero receipts.
    for (const delivery of deliveries) {
      const transfer = transfers.find(value => value.id === delivery.transferId)!;
      const request = state.requests.find(value => value.id === transfer.requestId)!;
      const expected = new Map<string, number>();
      const key = (site: string, item: string, name: string, unit: string, kind: string) => JSON.stringify([site, item, materialId(name, unit), kind]);
      for (const line of delivery.lines) {
        const source = transfer.lines.find(value => value.id === line.transferLineId), item = request.items.find(value => value.id === line.itemId);
        if (!source || !item) return false;
        if (isTransferSourceDelivery(delivery) && !["expected", "cancelled"].includes(delivery.status)) {
          const id = key(transfer.sourceSiteId, item.id, source.sourceName, source.unit, "transfer-out");
          expected.set(id, (expected.get(id) || 0) - line.expected);
        }
        if (delivery.status === "posted" && line.accepted > 0) {
          const posting = line.stockPosting;
          if (posting?.mode === "existing" && !state.movements.some(movement => movement.siteId === transfer.destinationSiteId && movement.transferDeliveryId !== delivery.id && materialId(movement.itemName, movement.unit) === posting.materialId)) return false;
          const id = key(transfer.destinationSiteId, item.id, posting?.name ?? item.name, posting?.unit ?? item.unit, "transfer-in");
          expected.set(id, (expected.get(id) || 0) + line.accepted);
        }
      }
      const actual = new Map<string, number>();
      for (const movement of state.movements.filter(value => value.transferDeliveryId === delivery.id)) {
        if (movement.transferId !== transfer.id || !["transfer-in", "transfer-out"].includes(movement.kind) || !movement.requestItemId || !Number.isFinite(movement.quantity)) return false;
        const id = key(movement.siteId, movement.requestItemId, movement.itemName, movement.unit, movement.kind);
        actual.set(id, (actual.get(id) || 0) + movement.quantity);
      }
      if (expected.size !== actual.size || [...expected].some(([id, value]) => !actual.has(id) || Math.abs(actual.get(id)! - value) > 1e-9)) return false;
    }
    if (state.movements.some(value => ["transfer-in", "transfer-out"].includes(value.kind) && !deliveries.some(delivery => delivery.id === value.transferDeliveryId))) return false;
    return true;
  } catch { return false; }
}
