import { validArchiveFileLink } from "./archive-destination.ts";
import { exactStockMatch, reviewIsCurrent, suitabilityQuantityFor } from "./stock-suitability.ts";
import { materialId } from "./ids.ts";
import { normalizedQuantity, orderedQuantity } from "./delivery-flow.ts";
import { procurementReady } from "./request-archive.ts";
import { projectCodeRequired, issueDocumentReference } from "./document-numbering.ts";
import { copyIdentity } from "./audit.ts";
import type { CommandContext, CommandResult } from "./commands.ts";
import type { DemoSnapshot, Item, MRF, StockTransfer, TransferDelivery, TransferEvidence, TransferReceiptData, TransferReceiptVersion } from "./types.ts";

const q = normalizedQuantity;
const positive = (value: number) => Number.isFinite(value) && value > 0;
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const reasonOK = (value: string) => typeof value === "string" && value.trim().length >= 5;
export const normalizedStockText = (value: string) => value.trim().toLowerCase();
export const sameStockUnit = (a: string, b: string) => normalizedStockText(a) === normalizedStockText(b);
export const transfersForRequest = (state: DemoSnapshot, requestId: string) => (state.stockTransfers || []).filter(value => value.requestId === requestId);
export const deliveriesForTransfer = (state: DemoSnapshot, transferId: string) => (state.transferDeliveries || []).filter(value => value.transferId === transferId);
export const transferReceived = (delivery: TransferDelivery) => delivery.status === "confirmed" || delivery.status === "posted";
export function sourceStockOnHand(state: DemoSnapshot, siteId: string, name: string, unit: string) {
  return state.movements.filter(value => value.siteId === siteId && normalizedStockText(value.itemName) === normalizedStockText(name) && sameStockUnit(value.unit, unit)).reduce((sum, value) => q(sum + value.quantity), 0);
}
export function transferUnscheduled(state: DemoSnapshot, transfer: StockTransfer, lineId: string) {
  const line = transfer.lines.find(value => value.id === lineId);
  if (!line || transfer.status !== "approved") return 0;
  const scheduled = deliveriesForTransfer(state, transfer.id).filter(value => value.status !== "cancelled").flatMap(value => value.lines).filter(value => value.transferLineId === lineId).reduce((sum, value) => sum + value.expected, 0);
  return Math.max(0, q(line.approved - line.cancelled - scheduled));
}
export function transferReservedFor(state: DemoSnapshot, siteId: string, stockId: string) {
  return q((state.stockTransfers || []).filter(value => value.sourceSiteId === siteId).reduce((sum, transfer) => sum + transfer.lines.filter(line => line.sourceMaterialId === stockId).reduce((amount, line) => {
    if (transfer.status === "pending") return amount + line.proposed;
    if (transfer.status !== "approved") return amount;
    const dispatched = deliveriesForTransfer(state, transfer.id).filter(value => value.status !== "expected" && value.status !== "cancelled").flatMap(value => value.lines).filter(value => value.transferLineId === line.id).reduce((total, value) => total + value.expected, 0);
    return amount + Math.max(0, q(line.approved - line.cancelled - dispatched));
  }, 0), 0));
}
export function sourceStockAvailable(state: DemoSnapshot, siteId: string, name: string, unit: string) {
  return Math.max(0, q(sourceStockOnHand(state, siteId, name, unit) - transferReservedFor(state, siteId, materialId(name, unit))));
}
export function transferQuantityFor(state: DemoSnapshot, requestId: string, itemId: string, stage: "committed" | "served" | "accepted" | "posted" = "committed") {
  return q(transfersForRequest(state, requestId).reduce((sum, transfer) => {
    if (stage === "committed" && transfer.status === "pending") return sum + transfer.lines.filter(line => line.itemId === itemId).reduce((n, line) => n + line.proposed, 0);
    if (transfer.status !== "approved") return sum;
    if (stage === "accepted" || stage === "posted") return sum + deliveriesForTransfer(state, transfer.id).filter(delivery => stage === "posted" ? delivery.status === "posted" : transferReceived(delivery)).flatMap(delivery => delivery.lines).filter(line => line.itemId === itemId).reduce((n, line) => n + line.accepted, 0);
    const shortages = deliveriesForTransfer(state, transfer.id).filter(transferReceived).flatMap(delivery => delivery.lines).filter(line => line.itemId === itemId).reduce((n, line) => n + line.expected - line.accepted, 0);
    return sum + transfer.lines.filter(line => line.itemId === itemId).reduce((n, line) => n + line.approved - line.cancelled, 0) - shortages;
  }, 0));
}
export function requestSourcing(state: DemoSnapshot, request: MRF, item: Item) {
  const ordered = q(state.pos.filter(po => po.mrfId === request.id && po.status !== "rejected").reduce((sum, po) => sum + orderedQuantity(po, request, item.id), 0));
  const transfers = transferQuantityFor(state, request.id, item.id);
  const staged = q(state.pendingAwards.filter(award => award.requestId === request.id && award.itemId === item.id).reduce((sum, award) => sum + award.quantity, 0));
  const suitability = suitabilityQuantityFor(state, request.id, item.id);
  return { requested: item.quantity, ordered, transfers, staged, suitability, purchase: Math.max(0, q(item.quantity - ordered - transfers - suitability)), unassigned: Math.max(0, q(item.quantity - ordered - transfers - suitability - staged)) };
}
export type TransferCommand =
  | { type: "proposeStockTransfer"; requestId: string; sourceSiteId: string; note: string; lines: { itemId: string; sourceName: string; unit: string; quantity: number; suitabilityConfirmed: boolean; suitabilityReviewId?: string }[] }
  | { type: "reviewStockTransfer"; id: string; decision: "approve" | "reject"; quantities: Record<string, number>; reason: string }
  | { type: "cancelStockTransfer"; id: string; reason: string }
  | { type: "scheduleTransferDelivery"; transferId: string; scheduledDate: string; evidence: string; quantities: Record<string, number> }
  | { type: "cancelTransferDelivery" | "dispatchTransferDelivery"; id: string; reason?: string }
  | { type: "receiveTransferDelivery"; id: string; lines: Record<string, { accepted: number; issue: string }> }
  | { type: "postTransferDelivery"; id: string; quantities: Record<string, number>; reason: string }
  | { type: "completeTransferReceiptArchive"; deliveryId: string; receiptId: string; fileId: string; url: string }
  | { type: "failTransferReceiptArchive"; deliveryId: string; receiptId: string; error: string }
  | { type: "attachTransferEvidence"; transferId: string; documents: TransferEvidence[] }
  | { type: "completeTransferEvidenceArchive"; transferId: string; documentId: string; fileId: string; url: string }
  | { type: "failTransferEvidenceArchive"; transferId: string; documentId: string; error: string }
  | { type: "reviewTransferDocuments"; id: string; status: "Under Review" | "Complete" | "Discrepancy"; note: string };
export const isTransferCommand = (command: { type: string }): command is TransferCommand => ["proposeStockTransfer", "reviewStockTransfer", "cancelStockTransfer", "scheduleTransferDelivery", "cancelTransferDelivery", "dispatchTransferDelivery", "receiveTransferDelivery", "postTransferDelivery", "completeTransferReceiptArchive", "failTransferReceiptArchive", "attachTransferEvidence", "completeTransferEvidenceArchive", "failTransferEvidenceArchive", "reviewTransferDocuments"].includes(command.type);
export function transferReceiptData(state: DemoSnapshot, delivery: TransferDelivery): TransferReceiptData {
  const transfer = state.stockTransfers!.find(value => value.id === delivery.transferId)!;
  const { receiptVersions: _versions, ...batch } = delivery; void _versions;
  const { documents: _documents, documentReview: _review, documentReviewHistory: _history, ...record } = transfer; void _documents; void _review; void _history;
  return structuredClone({ kind: "transfer", receiptVersion: delivery.receiptVersions?.at(-1)?.version || 0, delivery: batch, transfer: record, request: state.requests.find(value => value.id === transfer.requestId)!, sourceProject: state.sites.find(value => value.id === transfer.sourceSiteId)!, project: state.sites.find(value => value.id === transfer.destinationSiteId)! });
}
export function captureTransferReceipt(state: DemoSnapshot, delivery: TransferDelivery, id: string, at: string): TransferReceiptVersion {
  const version = (delivery.receiptVersions?.length || 0) + 1;
  return { id, version, fileName: delivery.ref + "-Stock-Transfer-Receipt-v" + version + ".pdf", createdAt: at, archive: { status: "pending" }, data: { ...transferReceiptData(state, delivery), receiptVersion: version } };
}
export function transferDocumentGaps(state: DemoSnapshot, transfer: StockTransfer) {
  const gaps: string[] = [];
  for (const delivery of deliveriesForTransfer(state, transfer.id).filter(transferReceived)) {
    const receipt = delivery.receiptVersions?.at(-1);
    if (receipt?.archive.status !== "complete") gaps.push(delivery.ref + ": archive generated receipt");
    if (!(transfer.documents || []).some(doc => doc.deliveryId === delivery.id && doc.kind === "Signed delivery receipt" && doc.receiptVersion === receipt?.version && doc.archive.status === "complete")) gaps.push(delivery.ref + ": upload and archive current signed receipt");
  }
  if ((transfer.documents || []).some(doc => doc.archive.status !== "complete")) gaps.push("Archive pending supporting documents");
  return gaps;
}
export function applyTransferCommand(state: DemoSnapshot, command: TransferCommand, ctx: CommandContext): CommandResult {
  const actor = ctx.actor?.role || state.role, identity = copyIdentity(ctx.actor), at = ctx.now();
  const fail = (message: string): CommandResult => ({ ok: false, message });
  if (!identity) return fail("Sign in with a named account to act on a stock transfer.");
  const done = (message: string, entity: string, transfer: StockTransfer): CommandResult => {
    const trip = state.transferDeliveries?.find(value => value.id === entity);
    const evidence = command.type === "attachTransferEvidence";
    state.activity.unshift({ id: ctx.id("act"), entity, at, actor, actorIdentity: identity, action: message, reason: "reason" in command ? command.reason : undefined, requestId: transfer.requestId, projectId: transfer.destinationSiteId, relatedProjectIds: [transfer.sourceSiteId, transfer.destinationSiteId], entityRef: trip?.ref || transfer.ref, entityType: trip ? "batch" : evidence ? "evidence" : "allocation" });
    return { ok: true, snapshot: state, message, recordId: entity };
  };
  const sitePermit = (siteId: string) => actor === "Site Personnel" && !!ctx.siteIds?.includes(siteId);
  const reopen = (transfer: StockTransfer) => {
    if (transfer.documentReview?.status === "Complete") { (transfer.documentReviewHistory ||= []).push(transfer.documentReview); transfer.documentReview = { status: "Under Review", note: "Delivery evidence changed", at, by: identity }; }
  };
  state.stockTransfers ||= []; state.transferDeliveries ||= [];
  if (command.type === "proposeStockTransfer") {
    if (actor !== "Procurement") return fail("Sign in as Procurement to propose a stock transfer.");
    const request = state.requests.find(value => value.id === command.requestId), source = state.sites.find(value => value.id === command.sourceSiteId), destination = state.sites.find(value => value.id === request?.siteId);
    if (!procurementReady(request) || !request || !source || !destination || source.id === destination.id) return fail("Choose another project and an approved, archived MRF.");
    const codeError = projectCodeRequired(state, destination.id); if (codeError) return fail(codeError);
    if (!command.lines.length || command.lines.length > 2000) return fail("Choose at least one stock material.");
    const byItem = new Map<string, number>(), byStock = new Map<string, number>();
    for (const line of command.lines) {
      const item = request.items.find(value => value.id === line.itemId), stockId = materialId(line.sourceName, line.unit);
      if (!item || !positive(line.quantity) || q(line.quantity) <= 0 || !line.sourceName.trim() || !sameStockUnit(item.unit, line.unit) || line.suitabilityConfirmed !== true) return fail("Confirm the selected stock is suitable and uses the requested unit.");
      const review = line.suitabilityReviewId ? state.stockSuitabilityReviews?.find(value => value.id === line.suitabilityReviewId) : undefined;
      if (line.suitabilityReviewId ? !review || review.status !== "used" || review.transferId !== undefined || !reviewIsCurrent(state, review) || review.requestId !== request.id || review.itemId !== item.id || review.sourceSiteId !== source.id || review.sourceMaterialId !== stockId || review.released !== q(line.quantity) : !exactStockMatch(item, line.sourceName, line.unit)) return fail("Alternative stock requires the requesting site approval before source release.");
      byItem.set(item.id, q((byItem.get(item.id) || 0) + line.quantity));
      byStock.set(stockId, q((byStock.get(stockId) || 0) + line.quantity));
      if (byItem.get(item.id)! > requestSourcing(state, request, item).unassigned) return fail("Transfers, saved awards and orders cannot exceed the MRF. Reduce existing supplier awards first.");
      if (byStock.get(stockId)! > sourceStockAvailable(state, source.id, line.sourceName, line.unit)) return fail("The selected source stock is no longer available.");
    }
    const transfer: StockTransfer = { id: ctx.id("transfer"), ...issueDocumentReference(state, destination.id, "TRF", at), requestId: request.id, sourceSiteId: source.id, destinationSiteId: destination.id, origin: { name: source.name, address: source.location }, destination: { name: destination.name, address: destination.location }, status: "pending", note: command.note.trim(), createdAt: at, updatedAt: at, createdBy: identity, lines: command.lines.map(line => ({ id: ctx.id("transfer-line"), itemId: line.itemId, sourceMaterialId: materialId(line.sourceName, line.unit), sourceName: line.sourceName.trim(), unit: line.unit.trim(), proposed: q(line.quantity), approved: 0, cancelled: 0, suitabilityConfirmed: true, ...(line.suitabilityReviewId ? { suitabilityReviewId: line.suitabilityReviewId } : { matchVerifiedBy: identity }) })) };
    state.stockTransfers.push(transfer);
    return done("Stock transfer proposed; source stock reserved.", transfer.id, transfer);
  }
  const delivery = "deliveryId" in command ? state.transferDeliveries.find(value => value.id === command.deliveryId) : "id" in command ? state.transferDeliveries.find(value => value.id === command.id) : undefined;
  const transferId = "transferId" in command ? command.transferId : delivery?.transferId || ("id" in command ? command.id : "");
  const transfer = state.stockTransfers.find(value => value.id === transferId);
  if (!transfer) return fail("Stock transfer not found.");
  if (command.type === "reviewStockTransfer") {
    if (!sitePermit(transfer.sourceSiteId) || transfer.status !== "pending") return fail("Only source-assigned Site Personnel can review a pending transfer.");
    if (command.decision === "reject") {
      if (!reasonOK(command.reason)) return fail("Explain why the transfer is rejected.");
      transfer.status = "rejected";
    } else {
      if (transfer.lines.some(line => !nonnegative(command.quantities[line.id]) || q(command.quantities[line.id]) > line.proposed) || !transfer.lines.some(line => command.quantities[line.id] > 0)) return fail("Confirm positive quantities within the proposed amounts, or reject the transfer.");
      if (transfer.lines.some(line => command.quantities[line.id] < line.proposed) && !reasonOK(command.reason)) return fail("Explain reduced release quantities.");
      for (const line of transfer.lines) line.approved = q(command.quantities[line.id]);
      transfer.status = "approved";
    }
    transfer.reviewedAt = at; transfer.reviewedBy = identity; transfer.reviewReason = command.reason.trim(); transfer.updatedAt = at;
    return done(transfer.status === "approved" ? "Source release confirmed; Logistics can schedule." : "Transfer rejected; reservation released.", transfer.id, transfer);
  }
  if (command.type === "cancelStockTransfer") {
    if (actor !== "Procurement" || !["pending", "approved"].includes(transfer.status) || !reasonOK(command.reason)) return fail("Procurement must explain cancellation of undispatched quantities.");
    for (const batch of deliveriesForTransfer(state, transfer.id).filter(value => value.status === "expected")) { batch.status = "cancelled"; batch.reason = command.reason.trim(); batch.updatedAt = at; }
    let changed = transfer.status === "pending";
    for (const line of transfer.lines) { const amount = transferUnscheduled(state, transfer, line.id); if (amount > 0) { line.cancelled = q(line.cancelled + amount); changed = true; } }
    if (!changed) return fail("No undispatched quantities remain to cancel.");
    if (transfer.status === "pending" || transfer.lines.every(line => line.approved === line.cancelled)) transfer.status = "cancelled";
    (transfer.cancellations ||= []).push({ at, by: identity, reason: command.reason.trim() }); transfer.updatedAt = at;
    return done("Undispatched transfer allocation cancelled; stock released.", transfer.id, transfer);
  }
  if (command.type === "scheduleTransferDelivery") {
    if (actor !== "Logistics" || transfer.status !== "approved") return fail("Logistics schedules source-approved transfers.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(command.scheduledDate) || !Number.isFinite(Date.parse(command.scheduledDate)) || new Date(command.scheduledDate).toISOString().slice(0, 10) !== command.scheduledDate || !command.evidence.trim()) return fail("Enter a valid delivery date and evidence reference.");
    const lines = transfer.lines.map(line => ({ transferLineId: line.id, itemId: line.itemId, expected: q(command.quantities[line.id] || 0), accepted: 0, issue: "" })).filter(line => line.expected !== 0);
    if (!lines.length || lines.some(line => !positive(line.expected) || line.expected > transferUnscheduled(state, transfer, line.transferLineId))) return fail("Trip quantities exceed the remaining approved allocation.");
    const batch: TransferDelivery = { id: ctx.id("transfer-delivery"), ...issueDocumentReference(state, transfer.destinationSiteId, "DEL", at), transferId: transfer.id, origin: structuredClone(transfer.origin), destination: structuredClone(transfer.destination), scheduledDate: command.scheduledDate, evidence: command.evidence.trim(), lines, status: "expected", createdAt: at, updatedAt: at, createdBy: identity };
    state.transferDeliveries.push(batch); reopen(transfer);
    return done("Transfer trip scheduled.", batch.id, transfer);
  }
  if (command.type === "cancelTransferDelivery" || command.type === "dispatchTransferDelivery") {
    if (actor !== "Logistics" || !delivery || delivery.status !== "expected" || transfer.status !== "approved") return fail("Logistics can dispatch or cancel a scheduled trip.");
    if (command.type === "cancelTransferDelivery") {
      if (!reasonOK(command.reason || "")) return fail("Explain cancellation of this trip.");
      delivery.status = "cancelled"; delivery.reason = command.reason!.trim();
    } else {
      const totals = new Map<string, number>();
      for (const line of delivery.lines) {
        const source = transfer.lines.find(value => value.id === line.transferLineId)!;
        totals.set(source.sourceMaterialId, q((totals.get(source.sourceMaterialId) || 0) + line.expected));
        if (totals.get(source.sourceMaterialId)! > sourceStockOnHand(state, transfer.sourceSiteId, source.sourceName, source.unit) + .000001) return fail("Source stock changed. Resolve the stock discrepancy before dispatch.");
      }
      for (const line of delivery.lines) {
        const source = transfer.lines.find(value => value.id === line.transferLineId)!;
        state.movements.push({ id: ctx.id("movement"), siteId: transfer.sourceSiteId, itemName: source.sourceName, unit: source.unit, quantity: -line.expected, kind: "transfer-out", reason: "Dispatched " + delivery.ref + " to " + transfer.destination.name, transferId: transfer.id, transferDeliveryId: delivery.id, requestItemId: line.itemId, actor, actorIdentity: identity, at });
      }
      delivery.status = "dispatched"; delivery.dispatchedAt = at; delivery.dispatchedBy = identity;
    }
    delivery.updatedAt = at;
    return done(command.type === "dispatchTransferDelivery" ? "Transfer dispatched; source stock deducted." : "Trip cancelled; approved stock remains reserved for rescheduling.", delivery.id, transfer);
  }
  if (command.type === "receiveTransferDelivery" || command.type === "postTransferDelivery") {
    if (!delivery || !sitePermit(transfer.destinationSiteId) || delivery.status !== (command.type === "receiveTransferDelivery" ? "dispatched" : "confirmed")) return fail("Only destination-assigned Site Personnel can receive and post this trip once.");
    const request = state.requests.find(value => value.id === transfer.requestId)!;
    const changed = command.type === "postTransferDelivery" && delivery.lines.some(line => command.quantities[line.transferLineId] !== line.accepted);
    if (changed && !reasonOK(command.reason)) return fail("Explain corrections before stock posting.");
    for (const line of delivery.lines) {
      const input = command.type === "receiveTransferDelivery" ? command.lines[line.transferLineId] : { accepted: command.quantities[line.transferLineId], issue: line.issue || command.reason };
      if (!input || !nonnegative(input.accepted) || q(input.accepted) > line.expected) return fail("Accepted quantities must fit this trip.");
      if (input.accepted < line.expected && !reasonOK(input.issue)) return fail("Explain missing or damaged materials.");
      const item = request.items.find(value => value.id === line.itemId)!;
      if (command.type === "postTransferDelivery" && input.accepted > line.accepted && input.accepted - line.accepted > requestSourcing(state, request, item).unassigned) return fail("The shortage has already been sourced elsewhere. Resolve overlapping allocations before increasing accepted stock.");
      line.accepted = q(input.accepted); line.issue = input.issue.trim();
    }
    if (command.type === "receiveTransferDelivery") {
      delivery.status = "confirmed"; delivery.receivedAt = at; delivery.receivedBy = identity;
    } else {
      if (state.movements.some(value => value.transferDeliveryId === delivery.id && value.kind === "transfer-in")) return fail("This transfer trip has already been posted.");
      delivery.status = "posted"; delivery.postedAt = at; delivery.postedBy = identity;
      for (const line of delivery.lines.filter(value => value.accepted > 0)) {
        const item = request.items.find(value => value.id === line.itemId)!;
        state.movements.push({ id: ctx.id("movement"), siteId: transfer.destinationSiteId, itemName: item.name, unit: item.unit, quantity: line.accepted, kind: "transfer-in", reason: "Posted " + delivery.ref + " from " + transfer.origin.name, transferId: transfer.id, transferDeliveryId: delivery.id, requestItemId: item.id, actor, actorIdentity: identity, at });
      }
    }
    delivery.updatedAt = at; delivery.reason = command.type === "postTransferDelivery" ? command.reason.trim() : undefined;
    if (command.type === "receiveTransferDelivery" || changed) { (delivery.receiptVersions ||= []).push(captureTransferReceipt(state, delivery, ctx.id("transfer-receipt"), at)); reopen(transfer); }
    return done(command.type === "receiveTransferDelivery" ? "Transfer received; shortages returned to sourcing." : "Accepted transfer stock posted.", delivery.id, transfer);
  }
  const canArchive = actor === "Accounting / Auditing" || actor === "Administrator" || sitePermit(transfer.destinationSiteId);
  if (command.type === "completeTransferReceiptArchive" || command.type === "failTransferReceiptArchive") {
    const receipt = delivery?.receiptVersions?.find(value => value.id === command.receiptId);
    if (!canArchive || !receipt) return fail("This transfer receipt cannot be archived by this account.");
    if (receipt.archive.status === "complete") return { ok: true, snapshot: state, message: "Receipt already archived." };
    if (command.type === "completeTransferReceiptArchive") {
      if (!validArchiveFileLink(state, command.url, command.fileId)) return fail("Invalid receipt archive link.");
      receipt.archive = { status: "complete", fileId: command.fileId, url: command.url };
    } else receipt.archive.error = command.error.slice(0, 300);
    return done(command.type === "completeTransferReceiptArchive" ? "Transfer receipt archived." : "Transfer receipt archive needs retry.", delivery!.id, transfer);
  }
  if (command.type === "attachTransferEvidence") {
    if (!(actor === "Accounting / Auditing" || sitePermit(transfer.destinationSiteId)) || !command.documents.length) return fail("Upload transfer evidence as destination Site Personnel or Accounting.");
    const existing = transfer.documents || [], all = [...existing, ...command.documents];
    if (new Set(all.map(doc => doc.id)).size !== all.length) return fail("Duplicate evidence record.");
    for (const doc of command.documents) {
      const batch = state.transferDeliveries.find(value => value.id === doc.deliveryId && value.transferId === transfer.id && transferReceived(value));
      if (!batch || !["Signed delivery receipt", "Other"].includes(doc.kind) || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(doc.mime) || !positive(doc.size) || doc.size > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(doc.sha256) || !doc.localFileId || !doc.name.trim() || doc.archive.status !== "pending" || doc.kind === "Signed delivery receipt" && doc.receiptVersion !== batch.receiptVersions?.at(-1)?.version) return fail("Invalid evidence or receipt version.");
      const group = all.filter(value => value.deliveryId === doc.deliveryId);
      if (group.length > 12 || group.reduce((sum, value) => sum + value.size, 0) > 45 * 1024 * 1024) return fail("Each trip allows 12 evidence files, 20 MB each and 45 MB total.");
    }
    transfer.documents = all.map(doc => existing.includes(doc) ? doc : { ...doc, uploadedAt: at, uploadedBy: actor, uploadedByIdentity: identity }); reopen(transfer);
    return done("Transfer evidence saved; archive to Drive.", transfer.id, transfer);
  }
  if (command.type === "completeTransferEvidenceArchive" || command.type === "failTransferEvidenceArchive") {
    const doc = transfer.documents?.find(value => value.id === command.documentId);
    if (!canArchive || !doc) return fail("Evidence archive not available to this account.");
    if (doc.archive.status === "complete") return { ok: true, snapshot: state, message: "Evidence already archived." };
    if (command.type === "completeTransferEvidenceArchive") {
      if (!validArchiveFileLink(state, command.url, command.fileId)) return fail("Invalid evidence archive link.");
      doc.archive = { status: "complete", fileId: command.fileId, url: command.url };
    } else doc.archive.error = command.error.slice(0, 300);
    return done(command.type === "completeTransferEvidenceArchive" ? "Transfer evidence archived." : "Transfer evidence archive needs retry.", transfer.id, transfer);
  }
  if (command.type === "reviewTransferDocuments") {
    if (actor !== "Accounting / Auditing" || !["Under Review", "Complete", "Discrepancy"].includes(command.status)) return fail("Accounting reviews transfer documents.");
    if (command.status === "Complete" && (!deliveriesForTransfer(state, transfer.id).some(transferReceived) || transferDocumentGaps(state, transfer).length)) return fail("Archive current generated and signed receipts plus all supporting evidence first.");
    if (command.status === "Discrepancy" && !reasonOK(command.note)) return fail("Explain the document discrepancy.");
    if (transfer.documentReview) (transfer.documentReviewHistory ||= []).push(transfer.documentReview);
    transfer.documentReview = { status: command.status, note: command.note.trim(), at, by: identity };
    return done("Transfer documents reviewed.", transfer.id, transfer);
  }
  return fail("Unsupported stock-transfer action.");
}
