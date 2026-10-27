import { materialId } from "./ids.ts";
import { copyIdentity, validIdentity } from "./audit.ts";
import { normalizedQuantity } from "./delivery-flow.ts";
import { procurementReady } from "./request-archive.ts";
import { applyTransferCommand, requestSourcing, sourceStockAvailable } from "./stock-transfers.ts";
import { equivalentStockUnit, matchingStockDescription } from "./stock-matching.ts";
import type { CommandContext, CommandResult } from "./commands.ts";
import type { DemoSnapshot, Item, StockSuitabilityReview } from "./types.ts";

const q = normalizedQuantity;
export const exactStockMatch = (item: Pick<Item, "name" | "unit">, name: string, unit: string) => matchingStockDescription(item, name, unit);
export function reviewIsCurrent(state: DemoSnapshot, review: StockSuitabilityReview) {
  const request = state.requests.find(value => value.id === review.requestId);
  const item = request?.items.find(value => value.id === review.itemId);
  return !!item && request?.siteId === review.destinationSiteId && item.name === review.requestedName && item.unit === review.requestedUnit && item.quantity === review.requestedQuantity;
}
export function suitabilityQuantityFor(state: DemoSnapshot, requestId: string, itemId: string) {
  return q((state.stockSuitabilityReviews || []).filter(value => value.requestId === requestId && value.itemId === itemId && ["pending", "approved"].includes(value.status) && reviewIsCurrent(state, value)).reduce((sum, value) => sum + (value.status === "pending" ? value.proposed : value.approved), 0));
}
export function invalidateStockReviews(state: DemoSnapshot, requestId: string, at: string) {
  for (const review of state.stockSuitabilityReviews || []) if (review.requestId === requestId && ["pending", "approved"].includes(review.status) && !reviewIsCurrent(state, review)) {
    review.status = "stale"; review.updatedAt = at; review.reason = "The requested material or quantity changed. Submit a new suitability review.";
  }
}
export type StockSourcingSelection = { itemId: string; sourceSiteId: string; sourceName: string; unit: string; quantity: number; matchConfirmed: boolean; needsReview: boolean; explanation: string };
export type StockSourcingCommand =
  | { type: "submitStockSourcingPlan"; requestId: string; note: string; selections: StockSourcingSelection[] }
  | { type: "reviewStockSuitability"; specificationsConfirmed?: boolean; id: string; decision: "approve" | "reject"; quantity: number; reason: string }
  | { type: "cancelStockSuitability"; id: string; reason: string }
  | { type: "requestApprovedStockRelease"; id: string; quantity: number };
export const isStockSourcingCommand = (command: { type: string }): command is StockSourcingCommand => ["submitStockSourcingPlan", "reviewStockSuitability", "cancelStockSuitability", "requestApprovedStockRelease"].includes(command.type);

export function applyStockSourcingCommand(state: DemoSnapshot, command: StockSourcingCommand, ctx: CommandContext): CommandResult {
  const identity = copyIdentity(ctx.actor), at = ctx.now();
  const fail = (message: string): CommandResult => ({ ok: false, message });
  if (!identity) return fail("Sign in with a named account to continue.");
  const log = (review: StockSuitabilityReview, message: string) => {
    state.activity.unshift({ id: ctx.id("act"), entity: review.id, at, actor: identity.role, actorIdentity: identity, action: message, reason: review.reason || review.explanation, requestId: review.requestId, projectId: review.destinationSiteId, relatedProjectIds: [review.sourceSiteId, review.destinationSiteId], entityType: "allocation", entityRef: state.requests.find(value => value.id === review.requestId)?.ref });
  };
  if (command.type === "submitStockSourcingPlan") {
    if (identity.role !== "Procurement") return fail("Sign in as Procurement to send stock requests.");
    const request = state.requests.find(value => value.id === command.requestId);
    if (!request || !procurementReady(request)) return fail("Use an approved MRF with no pending correction or archive.");
    if (!command.selections.length || command.selections.length > 2000) return fail("Add at least one stock selection.");
    const byItem = new Map<string, number>(), byStock = new Map<string, number>();
    for (const line of command.selections) {
      const item = request.items.find(value => value.id === line.itemId);
      if (!item || !state.sites.some(site => site.id === line.sourceSiteId) || line.sourceSiteId === request.siteId || !equivalentStockUnit(item.unit, line.unit) || !line.sourceName.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0 || q(line.quantity) <= 0) return fail("Choose another project's stock and enter a positive quantity in the requested unit.");
      if (!line.needsReview && (!exactStockMatch(item, line.sourceName, line.unit) || line.matchConfirmed !== true)) return fail("Verify the matching description, or request site approval for alternative or uncertain stock.");
      if (line.needsReview && !line.explanation.trim()) return fail("Explain why each alternative might meet the request.");
      const stockKey = line.sourceSiteId + "/" + materialId(line.sourceName, line.unit);
      byItem.set(item.id, q((byItem.get(item.id) || 0) + line.quantity));
      byStock.set(stockKey, q((byStock.get(stockKey) || 0) + line.quantity));
      if (byItem.get(item.id)! > requestSourcing(state, request, item).unassigned) return fail("Selected quantities exceed the remaining material need. Review existing requests and supplier awards.");
      if (byStock.get(stockKey)! > sourceStockAvailable(state, line.sourceSiteId, line.sourceName, line.unit)) return fail("Stock availability changed. Reduce the selected quantities and review again.");
    }
    // applyCommand commits only successful results; keep all sites and reviews in one snapshot.
    let next = state;
    const sourceIds = [...new Set(command.selections.filter(line => !line.needsReview).map(line => line.sourceSiteId))];
    for (const sourceSiteId of sourceIds) {
      const result = applyTransferCommand(next, { type: "proposeStockTransfer", requestId: request.id, sourceSiteId, note: command.note, lines: command.selections.filter(line => !line.needsReview && line.sourceSiteId === sourceSiteId).map(line => ({ ...line, suitabilityConfirmed: true })) }, ctx);
      if (!result.ok) return result;
      next = result.snapshot;
    }
    for (const line of command.selections.filter(value => value.needsReview)) {
      const item = request.items.find(value => value.id === line.itemId)!;
      const review: StockSuitabilityReview = { id: ctx.id("stock-review"), requestId: request.id, destinationSiteId: request.siteId, itemId: item.id, requestedName: item.name, requestedUnit: item.unit, requestedQuantity: item.quantity, sourceSiteId: line.sourceSiteId, sourceMaterialId: materialId(line.sourceName, line.unit), sourceName: line.sourceName.trim(), unit: line.unit.trim(), proposed: q(line.quantity), approved: 0, explanation: line.explanation.trim(), note: command.note.trim(), status: "pending", createdAt: at, updatedAt: at, createdBy: identity };
      (next.stockSuitabilityReviews ||= []).push(review); log(review, "Stock suitability review requested; MRF demand set aside.");
    }
    return { ok: true, snapshot: next, message: "Requests sent. Source sites confirm release; the requesting site reviews alternatives." };
  }
  const review = state.stockSuitabilityReviews?.find(value => value.id === command.id);
  if (!review) return fail("Stock suitability review not found.");
  if (command.type === "cancelStockSuitability") {
    if (identity.role !== "Procurement" || !["pending", "approved"].includes(review.status) || command.reason.trim().length < 5) return fail("Procurement must explain cancellation of an unresolved review.");
    review.status = "cancelled"; review.reason = command.reason.trim(); review.cancelledBy = identity;
  } else {
    const request = state.requests.find(value => value.id === review.requestId);
    if (!reviewIsCurrent(state, review) || !procurementReady(request)) return fail("The MRF changed or is awaiting correction. Review its current specifications before continuing.");
    if (command.type === "reviewStockSuitability") {
      if (identity.role !== "Site Personnel" || !ctx.siteIds?.includes(review.destinationSiteId) || review.status !== "pending") return fail("Only Site Personnel assigned to the requesting project can review this material.");
      if (command.decision !== "approve" && command.decision !== "reject") return fail("Approve or reject the proposed material.");
      if (command.decision === "approve" && command.specificationsConfirmed !== true) return fail("Confirm the proposed stock has the same specifications as the requested material.");
      if (command.decision === "approve" && (!Number.isFinite(command.quantity) || q(command.quantity) <= 0 || command.quantity > review.proposed)) return fail("Approve a positive quantity within the proposed amount, or reject the selection.");
      if ((command.decision === "reject" || command.quantity < review.proposed) && command.reason.trim().length < 5) return fail("Explain rejection or reduced quantities.");
      if (command.decision === "approve") review.specificationsConfirmed = true;
      review.status = command.decision === "approve" ? "approved" : "rejected"; review.approved = command.decision === "approve" ? q(command.quantity) : 0; review.reason = command.reason.trim(); review.reviewedAt = at; review.reviewedBy = identity;
    } else {
      if (identity.role !== "Procurement" || review.status !== "approved") return fail("Procurement requests release after suitability approval.");
      if (!Number.isFinite(command.quantity) || q(command.quantity) <= 0 || command.quantity > review.approved) return fail("Enter a positive release quantity within the site-approved amount.");
      // Consume the entire demand-only hold before creating the actual stock reservation.
      review.status = "used"; review.released = q(command.quantity); review.updatedAt = at;
      const result = applyTransferCommand(state, { type: "proposeStockTransfer", requestId: review.requestId, sourceSiteId: review.sourceSiteId, note: review.note, lines: [{ itemId: review.itemId, sourceName: review.sourceName, unit: review.unit, quantity: command.quantity, suitabilityConfirmed: true, suitabilityReviewId: review.id }] }, ctx);
      if (!result.ok) return result;
      review.transferId = result.recordId;
    }
  }
  review.updatedAt = at;
  const message = review.status === "approved" ? "Same specifications confirmed. Procurement must recheck availability and request release." : review.status === "used" ? "Source release requested. Any unused approved quantity is available to purchase." : "Review closed; its quantity is available to purchase.";
  log(review, message);
  return { ok: true, snapshot: state, message, recordId: review.id };
}

export function validStockReviews(state: DemoSnapshot) {
  try {
    const reviews = state.stockSuitabilityReviews;
    if (reviews === undefined) return true;
    if (!Array.isArray(reviews) || new Set(reviews.map(value => value.id)).size !== reviews.length) return false;
    for (const review of reviews) {
      if (review.specificationsConfirmed !== undefined && review.specificationsConfirmed !== true) return false;
      const request = state.requests.find(value => value.id === review.requestId);
      if (typeof review.id !== "string" || !review.id || typeof review.itemId !== "string" || !review.itemId || typeof review.note !== "string" || (review.reason !== undefined && typeof review.reason !== "string") || !request || request.siteId !== review.destinationSiteId || review.sourceSiteId === review.destinationSiteId || !state.sites.some(site => site.id === review.sourceSiteId) || !["pending", "approved", "rejected", "cancelled", "used", "stale"].includes(review.status)) return false;
      if (![review.requestedName, review.requestedUnit, review.sourceName, review.unit, review.explanation].every(value => typeof value === "string" && value.trim()) || review.sourceMaterialId !== materialId(review.sourceName, review.unit) || !equivalentStockUnit(review.requestedUnit, review.unit)) return false;
      if (![review.proposed, review.approved, review.requestedQuantity].every(value => Number.isFinite(value) && value >= 0) || review.proposed <= 0 || review.requestedQuantity <= 0 || review.proposed > review.requestedQuantity || review.approved > review.proposed || !validIdentity(review.createdBy) || review.createdBy.role !== "Procurement" || !Number.isFinite(Date.parse(review.createdAt)) || !Number.isFinite(Date.parse(review.updatedAt))) return false;
      if (["pending", "approved"].includes(review.status) && !reviewIsCurrent(state, review)) return false;
      if (["approved", "used", "rejected"].includes(review.status) && (!review.reviewedBy || !validIdentity(review.reviewedBy) || review.reviewedBy.role !== "Site Personnel" || !Number.isFinite(Date.parse(review.reviewedAt || "")))) return false;
      if (["approved", "used"].includes(review.status) && review.approved <= 0) return false;
      if (["pending", "rejected"].includes(review.status) && review.approved !== 0) return false;
      if (review.status === "rejected" && (review.reason || "").trim().length < 5 || ["approved", "used"].includes(review.status) && review.approved < review.proposed && (review.reason || "").trim().length < 5) return false;
      if (review.status === "cancelled" && (!review.cancelledBy || !validIdentity(review.cancelledBy) || review.cancelledBy.role !== "Procurement" || (review.reason || "").trim().length < 5)) return false;
      if (review.status === "used" && (!Number.isFinite(review.released) || !review.released || review.released > review.approved || !state.stockTransfers?.some(transfer => transfer.id === review.transferId && transfer.requestId === review.requestId && transfer.sourceSiteId === review.sourceSiteId && transfer.lines.some(line => line.suitabilityReviewId === review.id && line.itemId === review.itemId && line.sourceMaterialId === review.sourceMaterialId && line.proposed === review.released)))) return false;
    }
    return state.requests.every(request => request.items.every(item => { const row = requestSourcing(state, request, item); return row.ordered + row.transfers + row.staged + row.suitability <= item.quantity + .000001; }));
  } catch { return false; }
}
