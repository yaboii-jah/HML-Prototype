import type { Command } from "./commands.ts";
import type { DemoSnapshot } from "./types.ts";

/** Resolve ownership from the record, never from the selected UI project. */
export function siteActionProject(state: DemoSnapshot, command: Command): string | undefined {
  if (command.type === "startOperation" && ["delivery-receipt", "evidence", "attachment"].includes(command.target.kind)) {
    const target = command.target;
    const poId = "poId" in target ? target.poId : "batchId" in target ? state.batches.find(batch => batch.id === target.batchId)?.poId : undefined;
    return state.requests.find(request => request.id === state.pos.find(po => po.id === poId)?.mrfId)?.siteId;
  }
  if (command.type === "startOperation" && command.target.kind.startsWith("transfer-")) {
    const target = command.target;
    const transferId = "transferId" in target ? target.transferId : "deliveryId" in target ? state.transferDeliveries?.find(delivery => delivery.id === target.deliveryId)?.transferId : undefined;
    return state.stockTransfers?.find(value => value.id === transferId)?.destinationSiteId;
  }
  if (command.type === "reviewStockSuitability") return state.stockSuitabilityReviews?.find(review => review.id === command.id)?.destinationSiteId;
  if (command.type === "saveRequest" || command.type === "recordMovement") return command.siteId;
  if (command.type === "confirmBatch" || command.type === "postBatch" || command.type === "captureDeliveryReceipt") {
    const batch = state.batches.find(value => value.id === command.id);
    return state.requests.find(value => value.id === state.pos.find(po => po.id === batch?.poId)?.mrfId)?.siteId;
  }
  if (command.type === "completeDeliveryReceiptArchive" || command.type === "failDeliveryReceiptArchive") {
    const batch = state.batches.find(value => value.id === command.batchId);
    return state.requests.find(value => value.id === state.pos.find(po => po.id === batch?.poId)?.mrfId)?.siteId;
  }
  if (command.type === "attachAccountingDocuments" || command.type === "completeAccountingArchive" || command.type === "failAccountingArchive") return state.requests.find(value => value.id === state.pos.find(po => po.id === command.poId)?.mrfId)?.siteId;
  return undefined;
}
