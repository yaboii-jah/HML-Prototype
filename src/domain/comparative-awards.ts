import { normalizedQuantity } from "./delivery-flow.ts";
import { latestFinalizedQuotes } from "./procurement.ts";
import { orderedFor, poSupplierId } from "./selectors.ts";
import type { ComparisonSelections, DemoSnapshot, Item, MRF, Quote, QuoteLine } from "./types.ts";

export type ComparisonOffer = { quote: Quote; line: QuoteLine };
export type AwardEdits = Record<string, string>;
export function currentComparisonQuotes(state: DemoSnapshot, requestId: string) {
  const latest = new Map<string, Quote>();
  for (const quote of latestFinalizedQuotes(state, requestId).filter(value => !value.currency || value.currency === "PHP")) {
    const previous = latest.get(quote.supplierId);
    if (!previous || (quote.reviewedAt || "") > (previous.reviewedAt || "") || (quote.reviewedAt || "") === (previous.reviewedAt || "") && (quote.version || 1) >= (previous.version || 1)) latest.set(quote.supplierId, quote);
  }
  return [...latest.values()];
}
export const materialAwardOffers = (state: DemoSnapshot, requestId: string, itemId: string): ComparisonOffer[] => state.quotes.filter(quote => quote.mrfId === requestId).flatMap(quote => (quote.lines || []).filter(line => line.requestItemId === itemId).map(line => ({ quote, line })));
export const savedAwardQuantity = (state: DemoSnapshot, requestId: string, lineId: string) => state.pendingAwards.filter(award => award.requestId === requestId && award.quoteLineId === lineId).reduce((sum, award) => sum + award.quantity, 0);
export const awardInputValue = (state: DemoSnapshot, requestId: string, lineId: string, edits: AwardEdits) => edits[lineId] ?? String(savedAwardQuantity(state, requestId, lineId));
export function awardInputDirty(state: DemoSnapshot, requestId: string, lineId: string, edits: AwardEdits) {
  const value = edits[lineId];
  return value !== undefined && (!value.trim() || !Number.isFinite(Number(value)) || Number(value) !== savedAwardQuantity(state, requestId, lineId));
}
export const activeSupplierPO = (state: DemoSnapshot, quote: Quote) => state.pos.find(po => po.mrfId === quote.mrfId && po.status !== "rejected" && poSupplierId(state, po) === quote.supplierId);
export function offerAwardError(state: DemoSnapshot, quote: Quote) {
  return !latestFinalizedQuotes(state, quote.mrfId).some(current => current.id === quote.id) ? "Earlier quotation revision" : quote.currency && quote.currency !== "PHP" ? "Only PHP offers can be awarded" : quote.archive?.status === "pending" ? "Quotation archive pending" : activeSupplierPO(state, quote) ? "An active PO already exists; edit that PO instead" : "";
}
export function offerAwardCapacity(state: DemoSnapshot, { quote, line }: ComparisonOffer) {
  const used = state.pos.filter(po => po.mrfId === quote.mrfId && po.status !== "rejected" && po.quoteId === quote.id).reduce((sum, po) => sum + (po.lines || []).filter(row => row.quoteLineId === line.id).reduce((total, row) => total + row.quantity, 0), 0);
  return Math.max(0, normalizedQuantity(line.quantity * line.conversionFactor - used));
}
export function materialAwardStatus(state: DemoSnapshot, request: MRF, item: Item, edits: AwardEdits) {
  const ordered = normalizedQuantity(state.pos.filter(po => po.mrfId === request.id && po.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, item.id), 0));
  const saved = normalizedQuantity(state.pendingAwards.filter(award => award.requestId === request.id && award.itemId === item.id).reduce((sum, award) => sum + award.quantity, 0));
  const proposed = normalizedQuantity(materialAwardOffers(state, request.id, item.id).reduce((sum, { line }) => sum + Math.max(0, Number(awardInputValue(state, request.id, line.id, edits)) || 0), 0));
  return { ordered, saved, proposed, remainingToOrder: Math.max(0, normalizedQuantity(item.quantity - ordered)), unassigned: Math.max(0, normalizedQuantity(item.quantity - ordered - proposed)), edited: materialAwardOffers(state, request.id, item.id).some(({ line }) => awardInputDirty(state, request.id, line.id, edits)) };
}
export function selectedMaterialOffer(quote: Quote, itemId: string, selections: ComparisonSelections): QuoteLine | undefined {
  const lines = (quote.lines || []).filter(line => line.requestItemId === itemId);
  return lines.length === 1 ? lines[0] : lines.find(line => line.id === selections[quote.id]?.[itemId]);
}

/** Replace covered quantities; retaining gaps is used only for the whole-supplier preview. */
export function chooseMaterialOffer(state: DemoSnapshot, request: MRF, item: Item, offer: ComparisonOffer, edits: AwardEdits, retainGaps = false): AwardEdits {
  if (offer.quote.mrfId !== request.id || offer.line.requestItemId !== item.id || offerAwardError(state, offer.quote)) return edits;
  const desired = Math.min(materialAwardStatus(state, request, item, edits).remainingToOrder, offerAwardCapacity(state, offer));
  if (desired <= 0) return edits;
  let gap = normalizedQuantity(materialAwardStatus(state, request, item, edits).remainingToOrder - desired);
  const next = { ...edits };
  for (const row of materialAwardOffers(state, request.id, item.id)) {
    if (row.line.id === offer.line.id) { next[row.line.id] = String(desired); continue; }
    const retained = retainGaps ? Math.min(gap, Math.max(0, Number(awardInputValue(state, request.id, row.line.id, edits)) || 0)) : 0;
    next[row.line.id] = String(retained);
    gap = normalizedQuantity(gap - retained);
  }
  return next;
}

export function wholeSupplierProposal(state: DemoSnapshot, request: MRF, quote: Quote, edits: AwardEdits, selections: ComparisonSelections) {
  let next = { ...edits };
  const rows = request.items.map(item => {
    const before = materialAwardStatus(state, request, item, edits);
    const line = selectedMaterialOffer(quote, item.id, selections);
    const reason = offerAwardError(state, quote);
    const capacity = line ? offerAwardCapacity(state, { quote, line }) : 0;
    if (line && !reason && capacity > 0 && before.remainingToOrder > 0) next = chooseMaterialOffer(state, request, item, { quote, line }, next, true);
    const after = materialAwardStatus(state, request, item, next);
    const quantity = line ? Math.max(0, Number(awardInputValue(state, request.id, line.id, next)) || 0) : 0;
    const assigned = !reason && capacity > 0 && before.remainingToOrder > 0 && line ? quantity : 0;
    const note = before.remainingToOrder === 0 ? "Already ordered" : reason || (!line ? (quote.lines || []).some(value => value.requestItemId === item.id) ? "Choose a comparison offer first" : "Not quoted" : capacity <= 0 ? "No quantity available" : capacity < before.remainingToOrder ? `Only ${capacity} ${item.unit} available` : "");
    return { item, assigned, retained: normalizedQuantity(after.proposed - assigned), gap: after.unassigned, note };
  });
  return { edits: next, rows, changedCount: request.items.filter(item => materialAwardOffers(state, request.id, item.id).some(({ line }) => awardInputValue(state, request.id, line.id, next) !== awardInputValue(state, request.id, line.id, edits))).length };
}
