import { normalizedQuantity as q } from "./delivery-flow.ts";
import type { DemoSnapshot, Role, StockTransfer, TransferDelivery, TransferDeliveryLeg } from "./types.ts";

export const transferLegFor = (delivery: TransferDelivery): TransferDeliveryLeg => delivery.leg ?? "site-site";
export const isTransferSourceDelivery = (delivery: TransferDelivery) => transferLegFor(delivery) !== "warehouse-site";
export const isTransferSiteDelivery = (delivery: TransferDelivery) => transferLegFor(delivery) !== "site-warehouse";
export const transferReceivingRole = (delivery: TransferDelivery): Role => isTransferSiteDelivery(delivery) ? "Site Personnel" : "Procurement";
export function canReceiveTransfer(role: Role, siteIds: readonly string[], transfer: StockTransfer, delivery: TransferDelivery) {
  return isTransferSiteDelivery(delivery) ? role === "Site Personnel" && siteIds.includes(transfer.destinationSiteId) : role === "Procurement";
}
export function canManageTransferDocuments(role: Role, siteIds: readonly string[], transfer: StockTransfer, delivery: TransferDelivery) {
  return role === "Accounting / Auditing" || role === "Administrator" || canReceiveTransfer(role, siteIds, transfer, delivery);
}
export function transferDeliveryStage(delivery: TransferDelivery) {
  if (delivery.status === "expected") return "Scheduled";
  if (delivery.status === "dispatched") return "In transit";
  if (delivery.status === "posted") return "Stock posted";
  if (delivery.status === "cancelled") return "Cancelled";
  return isTransferSiteDelivery(delivery) ? "Received · To post" : "Received at warehouse";
}
function warehouseBalance(state: DemoSnapshot, parentId: string, lineId: string, held: boolean, excludingId?: string) {
  const parent = state.transferDeliveries?.find(value => value.id === parentId && transferLegFor(value) === "site-warehouse" && value.status === "confirmed");
  if (!parent) return 0;
  const used = (state.transferDeliveries || []).filter(value => value.parentDeliveryId === parent.id && value.transferId === parent.transferId && transferLegFor(value) === "warehouse-site" && value.status !== "cancelled" && value.id !== excludingId && (!held || value.status !== "expected"))
    .flatMap(value => value.lines).filter(line => line.transferLineId === lineId).reduce((sum, line) => q(sum + line.expected), 0);
  return Math.max(0, q((parent.lines.find(line => line.transferLineId === lineId)?.accepted || 0) - used));
}
export const transferWarehouseAvailableFor = (state: DemoSnapshot, parentId: string, lineId: string, excludingId?: string) => warehouseBalance(state, parentId, lineId, false, excludingId);
export const transferWarehouseHeldFor = (state: DemoSnapshot, parentId: string, lineId: string) => warehouseBalance(state, parentId, lineId, true);
