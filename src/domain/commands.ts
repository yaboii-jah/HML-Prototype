import { newId, nextRef } from "./ids.ts";
import { acceptedFor, budgetFor, inventoryFor, orderedFor, outstandingFor, paidTotal, poItems, poTotal, requestForPO, schedulableFor, stockFor } from "./selectors.ts";
import { hasFinalizedSuccessor, isFinalizedQuote, latestFinalizedQuotes, quoteReviewIssues } from "./procurement.ts";
import { poLineTotal } from "./pricing.ts";
import { ROLES, type DemoSnapshot, type DocumentRef, type DocumentStatus, type Item, type POAdjustment, type POLine, type Priority, type Quote, type Role } from "./types.ts";

export type Command =
  | { type: "setRole"; role: Role }
  | { type: "setSiteFilter"; siteId: string }
  | { type: "saveRequest"; id?: string; intent: "draft" | "submit"; siteId: string; scopeDocument?: DocumentRef; requestedBy: string; approvedBy: string; purchaser: string; financeOfficer: string; items: Item[]; documents: DocumentRef[] }
  | { type: "reviewRequest"; id: string; decision: "approve" | "return" | "reject"; reason?: string }
  | { type: "addQuote"; requestId: string; supplierId: string; ref: string; prices: Record<string, number>; available: string; leadDays: number; terms: string; document?: string }
  | { type: "saveReviewedQuote"; requestId: string; supplierId: string; ref: string; available: string; leadDays: number; terms: string; documents: DocumentRef[]; lines: Quote["lines"]; currency: string; tax: number; freight: number; discount: number; validity: string; extraction: "gemini" | "manual"; supersedesId?: string }
  | { type: "saveQuoteDraft"; quote: Quote }
  | { type: "deleteQuoteDraft"; id: string }
  | { type: "finalizeQuote"; id: string }
  | { type: "stageAward"; requestId: string; quoteId: string; quoteLineId: string; quantity: number }
  | { type: "generateAwardPOs"; requestId: string; reasons: Record<string, string> }
  | { type: "createAwardPO"; requestId: string; quoteId: string; lines: POLine[]; tax: number; freight: number; discount: number; reason: string; notes: string }
  | { type: "createPO"; requestId: string; quoteId: string; reason: string; notes: string }
  | { type: "savePO"; id: string; quoteId: string; notes: string; finalize: boolean; lines?: POLine[]; tax?: number; freight?: number; discount?: number; adjustments?: POAdjustment[]; reason?: string; supersededReason?: string }
  | { type: "setPriority"; id: string; priority: Priority }
  | { type: "reviewPO"; id: string; decision: "approve" | "hold" | "return" | "reject"; reason?: string }
  | { type: "servePO"; id: string }
  | { type: "createBatch"; poId: string; scheduledDate: string; evidence: string; delayReason: string; expected: Record<string, number> }
  | { type: "confirmBatch"; id: string; lines: Record<string, { accepted: number; issue: string }> }
  | { type: "postBatch"; id: string; accepted: Record<string, number>; reason: string }
  | { type: "recordMovement"; siteId: string; itemName: string; unit: string; kind: "usage" | "adjustment"; quantity: number; reason: string }
  | { type: "saveDocuments"; poId: string; invoiceRef: string; receiptRef: string; review: DocumentStatus; note: string }
  | { type: "recordPayment"; poId: string; amount: number; method: "Cash" | "Bank" | "Check" | "Other"; reference: string; date: string }
  | { type: "updateAssignment"; siteId: string; manager: string }
  | { type: "addSite"; name: string; location: string; budget: number; manager: string }
  | { type: "addSupplierFromQuote"; name: string };

export type CommandContext = { now: () => string; id: (prefix: string) => string };
export type CommandResult = { ok: true; snapshot: DemoSnapshot; recordId?: string; message: string } | { ok: false; message: string; field?: string };
const defaultContext: CommandContext = { now: () => new Date().toISOString(), id: newId };
const fail = (message: string, field?: string): CommandResult => ({ ok: false, message, field });
const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const reasonOK = (s?: string) => (s?.trim().length ?? 0) >= 5;
const close = (left: number, right: number) => Math.abs(left - right) < 0.000001;

function awardError(state: DemoSnapshot, requestId: string, quote: Quote, lines: POLine[], tax: number, freight: number, discount: number, excludingPoId?: string) {
  const request = state.requests.find(r => r.id === requestId);
  if (!request || request.status !== "approved" || quote.mrfId !== requestId || !quote.lines?.length) return "Choose a reviewed quotation for an approved MRF.";
  if (!isFinalizedQuote(quote) || quote.currency && quote.currency !== "PHP") return "Only finalized PHP quotations can be awarded.";
  if (!lines.length || [tax, freight, discount].some(value => !nonnegative(value))) return "Enter awarded lines and valid PO charges.";
  const awarded = new Map<string, number>();
  const usedOffers = new Map<string, number>();
  for (const line of lines) {
    const item = request.items.find(value => value.id === line.itemId);
    const offer = quote.lines.find(value => value.id === line.quoteLineId);
    if (!item || !offer || offer.requestItemId !== item.id || !positive(line.quantity) || !positive(offer.conversionFactor) || !positive(offer.unitPrice) || !close(line.unitPrice, offer.unitPrice / offer.conversionFactor)) return "An award must use a confirmed matching offer and its converted unit price.";
    if (offer.unit.toLowerCase() !== item.unit.toLowerCase() && !offer.varianceReason.trim()) return "Explain the accepted unit difference before awarding.";
    awarded.set(item.id, (awarded.get(item.id) || 0) + line.quantity);
    usedOffers.set(offer.id, (usedOffers.get(offer.id) || 0) + line.quantity);
  }
  for (const po of state.pos.filter(value => value.mrfId === requestId && value.status !== "rejected" && value.id !== excludingPoId)) {
    for (const item of request.items) awarded.set(item.id, (awarded.get(item.id) || 0) + orderedFor(state, po, item.id));
    if (po.quoteId === quote.id) for (const line of po.lines || []) usedOffers.set(line.quoteLineId, (usedOffers.get(line.quoteLineId) || 0) + line.quantity);
  }
  if (request.items.some(item => (awarded.get(item.id) || 0) > item.quantity + 0.000001)) return "Awarded quantities exceed the MRF request.";
  if (quote.lines.some(offer => (usedOffers.get(offer.id) || 0) > offer.quantity * offer.conversionFactor + 0.000001)) return "Awarded quantity exceeds the supplier's quoted quantity.";
  const subtotal = lines.reduce((sum, line) => sum + poLineTotal(line), 0);
  if (discount > subtotal + tax + freight) return "Discount exceeds the PO amount.";
  return "";
}

export function applyCommand(previous: DemoSnapshot, command: Command, ctx: CommandContext = defaultContext): CommandResult {
  const state = structuredClone(previous);
  const actor = state.role;
  const at = ctx.now();
  const id = ctx.id;
  const log = (entity: string, action: string, reason?: string) => state.activity.unshift({ id: id("act"), entity, action, reason: reason?.trim() || undefined, actor, at });
  const done = (message: string, recordId?: string): CommandResult => ({ ok: true, snapshot: state, recordId, message });
  const permit = (...roles: Role[]) => roles.includes(actor);

  switch (command.type) {
    case "setRole":
      if (!ROLES.includes(command.role)) return fail("Unknown role.");
      state.role = command.role;
      return done(`Switched to ${command.role}`);
    case "setSiteFilter":
      if (command.siteId !== "all" && !state.sites.some(s => s.id === command.siteId)) return fail("Site not found.");
      state.siteFilter = command.siteId;
      return done("Site context updated.");
    case "saveRequest": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to edit an MRF.");
      if (!state.sites.some(s => s.id === command.siteId)) return fail("Choose a valid site.", "siteId");
      const original = command.id ? state.requests.find(r => r.id === command.id) : undefined;
      if (command.id && !original) return fail("MRF not found.");
      if (original && !["draft", "returned"].includes(original.status)) return fail("Only draft or returned MRFs can be edited.");
      if (command.intent === "submit") {
        if (![command.requestedBy, command.approvedBy, command.purchaser, command.financeOfficer].every(x => x.trim())) return fail("Complete the request's general information before submitting.");
        if (!command.items.length || command.items.some(i => !i.name.trim() || !i.unit.trim() || !positive(i.quantity) || !i.neededDate.trim() || !i.location.trim())) return fail("Each material needs a name, unit, positive quantity, date needed, and delivery location.", "items");
      }
      const items = command.items.map(i => ({ ...i, name: i.name.trim(), unit: i.unit.trim(), id: i.id || id("item"), neededDate: i.neededDate.trim(), purpose: i.purpose.trim(), location: i.location.trim(), remarks: i.remarks.trim() }));
      const fields = { siteId: command.siteId, category: original?.category || "", scope: original?.scope || "", scopeDocument: command.scopeDocument, requestedBy: command.requestedBy.trim(), approvedBy: command.approvedBy.trim(), purchaser: command.purchaser.trim(), financeOfficer: command.financeOfficer.trim(), items, documents: command.documents.filter(d => d.name.trim()), status: command.intent === "submit" ? "submitted" as const : "draft" as const, reason: undefined, updatedAt: at };
      if (original) { Object.assign(original, fields); log(original.id, command.intent === "submit" ? "MRF revised and resubmitted" : "MRF draft saved"); return done(command.intent === "submit" ? "MRF submitted to the Project Manager." : "MRF draft saved.", original.id); }
      const requestId = id("mrf");
      state.requests.push({ id: requestId, ref: nextRef("MRF-2026", state.requests), createdAt: at, ...fields });
      log(requestId, command.intent === "submit" ? "MRF submitted" : "MRF draft saved");
      return done(command.intent === "submit" ? "MRF submitted to the Project Manager." : "MRF draft saved.", requestId);
    }
    case "reviewRequest": {
      if (!permit("Project Manager")) return fail("Switch to Project Manager to review an MRF.");
      const request = state.requests.find(r => r.id === command.id);
      if (!request || request.status !== "submitted") return fail("This MRF is no longer awaiting PM review.");
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      request.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : "rejected";
      request.reason = command.decision === "approve" ? undefined : command.reason?.trim();
      request.updatedAt = at;
      log(request.id, `MRF ${request.status}`, request.reason);
      return done(command.decision === "approve" ? "MRF approved. Procurement is next." : `MRF ${request.status}.`);
    }
    case "addQuote": {
      if (!permit("Procurement")) return fail("Switch to Procurement to add quotations.");
      const request = state.requests.find(r => r.id === command.requestId);
      if (!request || request.status !== "approved") return fail("Only an approved MRF can receive quotations.");
      if (!state.suppliers.some(s => s.id === command.supplierId)) return fail("Choose a valid supplier.", "supplierId");
      if (state.quotes.some(q => q.mrfId === request.id && q.supplierId === command.supplierId)) return fail("This supplier already has a quote for the MRF.");
      if (!command.ref.trim() || !command.available.trim() || !command.terms.trim() || !nonnegative(command.leadDays)) return fail("Complete the quotation reference, availability, lead time, and terms.");
      if (request.items.some(item => !positive(command.prices[item.id]))) return fail("Enter a positive unit price for every material.", "prices");
      const quoteId = id("quote");
      state.quotes.push({ id: quoteId, mrfId: request.id, supplierId: command.supplierId, ref: command.ref.trim(), prices: command.prices, available: command.available.trim(), leadDays: command.leadDays, terms: command.terms.trim(), documents: command.document?.trim() ? [{ name: command.document.trim(), type: "Reference" }] : [] });
      log(request.id, "Supplier quotation added");
      return done("Quotation added.", quoteId);
    }
    case "saveQuoteDraft": {
      if (!permit("Procurement")) return fail("Switch to Procurement to review quotations.");
      const incoming = command.quote;
      const request = state.requests.find(value => value.id === incoming.mrfId);
      if (!request || request.status !== "approved") return fail("Only an approved MRF can receive quotations.");
      if (!incoming.id || !Array.isArray(incoming.lines) || !Array.isArray(incoming.adjustments)) return fail("The quotation draft is incomplete.");
      const existing = state.quotes.find(value => value.id === incoming.id);
      if (existing && existing.reviewStatus !== "draft") return fail("Finalized quotations cannot be changed. Create a revision.");
      if (existing && (existing.mrfId !== incoming.mrfId || existing.supersedesId !== incoming.supersedesId)) return fail("The quotation's source request or revision cannot change.");
      const previousQuote = incoming.supersedesId ? state.quotes.find(value => value.id === incoming.supersedesId && value.mrfId === incoming.mrfId && isFinalizedQuote(value)) : undefined;
      if (incoming.supersedesId && !previousQuote) return fail("Choose a finalized quotation to revise.");
      if (!existing && state.quotes.some(value => value.id === incoming.id)) return fail("Quotation ID already exists.");
      if (!existing && incoming.supersedesId && state.quotes.some(value => value.supersedesId === incoming.supersedesId && value.reviewStatus === "draft")) return fail("A draft revision already exists for this quotation.");
      const draft: Quote = { ...incoming, reviewStatus: "draft", prices: {}, version: existing?.version || (previousQuote?.version || 0) + 1, documents: existing?.documents || incoming.documents, reviewedAt: undefined };
      if (existing) Object.assign(existing, draft);
      else state.quotes.push(draft);
      return done(existing ? "Quotation draft saved." : "Quotation draft created.", draft.id);
    }
    case "deleteQuoteDraft": {
      if (!permit("Procurement")) return fail("Switch to Procurement to remove quotation drafts.");
      const quote = state.quotes.find(value => value.id === command.id && value.reviewStatus === "draft");
      if (!quote) return fail("Only an unfinalized quotation draft can be removed.");
      if (state.pendingAwards.some(value => value.quoteId === quote.id) || state.pos.some(value => value.quoteId === quote.id)) return fail("Remove linked awards before deleting this draft.");
      state.quotes = state.quotes.filter(value => value.id !== quote.id);
      log(quote.mrfId, "Quotation draft removed");
      return done("Quotation draft removed.");
    }
    case "finalizeQuote": {
      if (!permit("Procurement")) return fail("Switch to Procurement to finalize quotations.");
      const quote = state.quotes.find(value => value.id === command.id && value.reviewStatus === "draft");
      if (!quote) return fail("Quotation draft not found.");
      const issues = quoteReviewIssues(state, quote);
      if (issues.length) return fail(issues[0]);
      const supplierName = quote.supplierDetails?.name.trim() || state.suppliers.find(value => value.id === quote.supplierId)?.name || "";
      const supplier = state.suppliers.find(value => value.name.trim().toLowerCase() === supplierName.toLowerCase());
      const supplierId = supplier?.id || id("supplier");
      if (quote.supersedesId) {
        const previousQuote = state.quotes.find(value => value.id === quote.supersedesId);
        if (!previousQuote || previousQuote.supplierId !== supplierId || hasFinalizedSuccessor(state, previousQuote.id)) return fail("This revision must replace the current quotation from the same supplier.");
      } else if (latestFinalizedQuotes(state, quote.mrfId).some(value => value.supplierId === supplierId)) return fail("This supplier already has a finalized quotation. Create a revision instead.");
      const supplierLocation = quote.supplierDetails?.address.trim() || "";
      const supplierContact = [quote.supplierDetails?.contactName, quote.supplierDetails?.email, quote.supplierDetails?.phone].filter(Boolean).join(" · ");
      if (!supplier) state.suppliers.push({ id: supplierId, name: supplierName, location: supplierLocation, contact: supplierContact, accreditation: "" });
      else { if (!supplier.location) supplier.location = supplierLocation; if (!supplier.contact) supplier.contact = supplierContact; }
      quote.supplierId = supplierId;
      quote.reviewStatus = "finalized";
      quote.reviewedAt = at;
      quote.lines = quote.lines?.map(line => ({ ...line, matchConfirmed: line.requestItemId ? true : false }));
      log(quote.id, "Supplier quotation finalized");
      return done("Quotation finalized for comparison and awards.", quote.id);
    }
    case "stageAward": {
      if (!permit("Procurement")) return fail("Switch to Procurement to allocate materials.");
      const request = state.requests.find(value => value.id === command.requestId);
      const quote = state.quotes.find(value => value.id === command.quoteId && value.mrfId === command.requestId);
      const offer = quote?.lines?.find(value => value.id === command.quoteLineId);
      if (!request || request.status !== "approved" || !quote || !offer || !offer.requestItemId) return fail("Choose a matching offer for an approved MRF.");
      if (!Number.isFinite(command.quantity) || command.quantity < 0) return fail("Enter a valid award quantity.");
      const existing = state.pendingAwards.find(value => value.quoteLineId === offer.id && value.requestId === request.id);
      if (command.quantity === 0) { state.pendingAwards = state.pendingAwards.filter(value => value.id !== existing?.id); return done("Award removed."); }
      if (!isFinalizedQuote(quote) || hasFinalizedSuccessor(state, quote.id) || quote.currency && quote.currency !== "PHP") return fail("Use the current finalized PHP quotation.");
      const otherPending = state.pendingAwards.filter(value => value.requestId === request.id && value.id !== existing?.id);
      const usedRequest = state.pos.filter(value => value.mrfId === request.id && value.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, offer.requestItemId), 0) + otherPending.filter(value => value.itemId === offer.requestItemId).reduce((sum, value) => sum + value.quantity, 0);
      const usedOffer = state.pos.filter(value => value.quoteId === quote.id && value.status !== "rejected").reduce((sum, po) => sum + (po.lines || []).filter(value => value.quoteLineId === offer.id).reduce((total, value) => total + value.quantity, 0), 0);
      const requested = request.items.find(value => value.id === offer.requestItemId);
      if (!requested || command.quantity + usedRequest > requested.quantity + 0.000001) return fail("Awarded quantities exceed the MRF request.");
      if (command.quantity + usedOffer > offer.quantity * offer.conversionFactor + 0.000001) return fail("Awarded quantity exceeds the supplier's quoted quantity.");
      if (existing) state.pendingAwards = state.pendingAwards.filter(value => value.id !== existing.id);
      if (command.quantity > 0) state.pendingAwards.push({ id: existing?.id || id("award"), requestId: request.id, quoteId: quote.id, quoteLineId: offer.id, itemId: offer.requestItemId, quantity: command.quantity });
      return done(command.quantity > 0 ? "Award staged." : "Award removed.");
    }
    case "generateAwardPOs": {
      if (!permit("Procurement")) return fail("Switch to Procurement to prepare POs.");
      const pending = state.pendingAwards.filter(value => value.requestId === command.requestId);
      if (!pending.length) return fail("Stage at least one supplier award.");
      const groups = new Map<string, typeof pending>();
      for (const award of pending) {
        const quote = state.quotes.find(value => value.id === award.quoteId);
        if (!quote || !isFinalizedQuote(quote) || hasFinalizedSuccessor(state, quote.id) || quote.currency && quote.currency !== "PHP") return fail("A staged quotation changed. Review the allocations again.");
        const group = groups.get(quote.id) || [];
        group.push(award);
        groups.set(quote.id, group);
      }
      let firstId: string | undefined;
      for (const [quoteId, awards] of groups) {
        const quote = state.quotes.find(value => value.id === quoteId)!;
        if (state.pos.some(value => value.mrfId === command.requestId && value.status !== "rejected" && state.quotes.find(source => source.id === value.quoteId)?.supplierId === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO draft instead.");
        if (!reasonOK(command.reasons[quote.supplierId])) return fail("Explain each supplier choice in at least five characters.");
        const lines: POLine[] = awards.map(award => {
          const offer = quote.lines!.find(value => value.id === award.quoteLineId)!;
          const fullOffer = Math.abs(award.quantity - offer.quantity * offer.conversionFactor) < 0.000001;
          return { itemId: award.itemId, quoteLineId: offer.id, quantity: award.quantity, unitPrice: offer.unitPrice / offer.conversionFactor, discountType: offer.discountType || "none", discountValue: offer.discountType === "fixed" && !fullOffer ? 0 : offer.discountValue || 0, taxRate: offer.taxRate || 0, fixedDiscountConfirmed: offer.discountType !== "fixed" };
        });
        const error = awardError(state, command.requestId, quote, lines, 0, 0, 0);
        if (error) return fail(error);
        const adjustments = (quote.adjustments || [
          ...(quote.tax ? [{ id: id("adjustment"), label: "Tax", kind: "tax" as const, calculation: "fixed" as const, value: quote.tax }] : []),
          ...(quote.freight ? [{ id: id("adjustment"), label: "Freight", kind: "shipping" as const, calculation: "fixed" as const, value: quote.freight }] : []),
          ...(quote.discount ? [{ id: id("adjustment"), label: "Discount", kind: "discount" as const, calculation: "fixed" as const, value: quote.discount }] : []),
        ]).map(value => ({ ...value, included: true, confirmed: false }));
        const poId = id("po");
        state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: command.requestId, quoteId, lines, adjustments, status: "draft", priority: "Normal", notes: "", selectionReason: command.reasons[quote.supplierId].trim(), createdAt: at, updatedAt: at });
        firstId ||= poId;
        log(poId, "PO drafted from staged supplier award", command.reasons[quote.supplierId]);
      }
      state.pendingAwards = state.pendingAwards.filter(value => value.requestId !== command.requestId);
      return done(`${groups.size} supplier PO draft${groups.size === 1 ? "" : "s"} created.`, firstId);
    }
    case "saveReviewedQuote": {
      if (!permit("Procurement")) return fail("Switch to Procurement to review quotations.");
      const request = state.requests.find(r => r.id === command.requestId);
      if (!request || request.status !== "approved") return fail("Only an approved MRF can receive quotations.");
      if (!state.suppliers.some(s => s.id === command.supplierId)) return fail("Choose a valid supplier.");
      if (!command.ref.trim() || command.currency !== "PHP" || !Array.isArray(command.lines) || !command.lines.length || !command.documents.length) return fail("Add a PHP quotation with its source file and quoted lines.");
      if ([command.tax, command.freight, command.discount].some(value => !nonnegative(value)) || !nonnegative(command.leadDays)) return fail("Enter valid quotation charges and lead time.");
      if (command.lines.some(line => !line.description.trim() || !line.unit.trim() || !positive(line.quantity) || !positive(line.unitPrice) || !positive(line.conversionFactor) || (line.requestItemId && !request.items.some(item => item.id === line.requestItemId)))) return fail("Review each quoted line, quantity, price, and material match.");
      const prior = command.supersedesId ? state.quotes.find(q => q.id === command.supersedesId && q.mrfId === request.id && q.supplierId === command.supplierId) : undefined;
      if (command.supersedesId && !prior) return fail("The earlier quotation version was not found.");
      const current = state.quotes.filter(q => q.mrfId === request.id && q.supplierId === command.supplierId && !state.quotes.some(later => later.supersedesId === q.id));
      if (current.length && (!prior || !current.some(q => q.id === prior.id))) return fail("Choose the current supplier quotation as the revision being replaced.");
      const quoteId = id("quote");
      state.quotes.push({ id: quoteId, mrfId: request.id, supplierId: command.supplierId, ref: command.ref.trim(), prices: {}, available: command.available.trim(), leadDays: command.leadDays, terms: command.terms.trim(), documents: command.documents, lines: command.lines.map(line => ({ ...line, id: line.id || id("offer"), description: line.description.trim(), unit: line.unit.trim(), brand: line.brand.trim(), specification: line.specification.trim(), varianceReason: line.varianceReason.trim() })), version: (prior?.version || 0) + 1, supersedesId: prior?.id, currency: "PHP", tax: command.tax, freight: command.freight, discount: command.discount, validity: command.validity.trim(), extraction: command.extraction });
      log(request.id, "Supplier quotation reviewed");
      return done("Quotation saved for comparison.", quoteId);
    }
    case "createAwardPO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to prepare a PO.");
      const quote = state.quotes.find(q => q.id === command.quoteId);
      if (!quote) return fail("Choose a reviewed quotation.");
      const error = awardError(state, command.requestId, quote, command.lines, command.tax, command.freight, command.discount);
      if (error) return fail(error);
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.");
      const poId = id("po");
      state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: command.requestId, quoteId: quote.id, lines: command.lines, tax: command.tax, freight: command.freight, discount: command.discount, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
      log(poId, "PO drafted from awarded quotation", command.reason);
      return done("PO draft created.", poId);
    }
    case "createPO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to prepare a PO.");
      const request = state.requests.find(r => r.id === command.requestId);
      const quote = state.quotes.find(q => q.id === command.quoteId && q.mrfId === request?.id);
      if (!request || request.status !== "approved" || !quote) return fail("Choose a quote for an approved MRF.");
      if (state.pos.some(p => p.mrfId === request.id && p.status !== "rejected")) return fail("Use the material award flow to create another PO for this MRF.");
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.", "reason");
      const poId = id("po");
      state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: request.id, quoteId: quote.id, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
      log(poId, "PO drafted", command.reason);
      return done("PO draft created.", poId);
    }
    case "savePO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to edit a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["draft", "returned"].includes(po.status)) return fail("This PO is locked for editing.");
      const quote = state.quotes.find(q => q.id === command.quoteId && q.mrfId === po.mrfId);
      if (!quote) return fail("Choose a quote linked to this MRF.");
      if (state.pos.some(value => value.id !== po.id && value.mrfId === po.mrfId && value.status !== "rejected" && state.quotes.find(source => source.id === value.quoteId)?.supplierId === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO instead.");
      if (po.lines) {
        const lines = command.lines || po.lines;
        const tax = command.tax ?? po.tax ?? 0, freight = command.freight ?? po.freight ?? 0, discount = command.discount ?? po.discount ?? 0;
        const error = awardError(state, po.mrfId, quote, lines, tax, freight, discount, po.id);
        if (error) return fail(error);
        if (lines.some(line => !nonnegative(line.discountValue ?? 0) || !nonnegative(line.taxRate ?? 0) || line.discountType === "percentage" && (line.discountValue || 0) > 100 || line.discountType === "fixed" && (line.discountValue || 0) > line.quantity * line.unitPrice)) return fail("Review PO line discounts and tax rates.");
        po.lines = lines; po.tax = tax; po.freight = freight; po.discount = discount;
        if (command.adjustments) {
          if (command.adjustments.some(value => !value.label.trim() || !nonnegative(value.value) || value.calculation === "percentage" && value.value > 100)) return fail("Review each PO adjustment amount.");
          po.adjustments = command.adjustments;
        }
        if (!reasonOK(command.reason || po.selectionReason)) return fail("Explain the supplier choice in at least five characters.");
        po.selectionReason = (command.reason || po.selectionReason).trim();
      }
      if (command.finalize) {
        if (po.lines?.some(line => line.discountType === "fixed" && line.fixedDiscountConfirmed !== true)) return fail("Confirm each fixed line discount before Finance review.");
        if (po.adjustments?.some(value => !value.confirmed)) return fail("Confirm or exclude every PO adjustment before Finance review.");
        if (hasFinalizedSuccessor(state, quote.id) && !reasonOK(command.supersededReason)) return fail("A newer quotation exists. Switch to it or explain why this PO keeps the older revision.");
        if (poTotal(state, po) <= 0) return fail("PO total must be positive.");
      }
      po.supersededReason = hasFinalizedSuccessor(state, quote.id) ? command.supersededReason?.trim() : undefined;
      po.quoteId = command.quoteId; po.notes = command.notes.trim(); po.updatedAt = at;
      if (command.finalize) { po.status = "finalized"; po.reviewReason = undefined; log(po.id, "PO finalized for Finance", po.supersededReason); return done("PO finalized. Finance is next."); }
      log(po.id, "PO draft updated"); return done("PO draft saved.");
    }
    case "setPriority": {
      if (!permit("Finance")) return fail("Switch to Finance to set priority.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["finalized", "hold"].includes(po.status)) return fail("This PO is not in Finance review.");
      po.priority = command.priority; po.updatedAt = at; log(po.id, `Priority set to ${po.priority}`);
      return done("Priority updated.");
    }
    case "reviewPO": {
      if (!permit("Finance")) return fail("Switch to Finance to review a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["finalized", "hold"].includes(po.status)) return fail("This PO is not awaiting Finance review.");
      if (command.decision === "approve") {
        const request = requestForPO(state, po);
        if (!request) return fail("The linked MRF is missing.");
        if (poTotal(state, po) > budgetFor(state, request.siteId).available) return fail("This PO exceeds the available project budget.");
        po.status = "approved"; po.reviewReason = undefined; po.updatedAt = at; log(po.id, "Budget approved");
        return done("Budget approved. Procurement can serve the PO.");
      }
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      po.status = command.decision === "hold" ? "hold" : command.decision === "return" ? "returned" : "rejected";
      po.reviewReason = command.reason?.trim(); po.updatedAt = at; log(po.id, `Finance ${po.status}`, po.reviewReason);
      return done(`PO ${po.status}.`);
    }
    case "servePO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to serve a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || po.status !== "approved") return fail("Finance approval is required before serving.");
      po.status = "served"; po.updatedAt = at; log(po.id, "PO served");
      return done("PO served. Logistics is next.");
    }
    case "createBatch": {
      if (!permit("Logistics")) return fail("Switch to Logistics to schedule a delivery.");
      const po = state.pos.find(p => p.id === command.poId);
      if (!po || po.status !== "served") return fail("Only a served PO can receive a delivery batch.");
      const request = requestForPO(state, po);
      if (!request || !command.scheduledDate || !command.evidence.trim()) return fail("Enter a schedule and evidence reference.");
      const lines = poItems(state, po).map(item => ({ itemId: item.id, expected: command.expected[item.id] ?? 0, accepted: 0, issue: "" }));
      if (lines.some(line => !nonnegative(line.expected) || line.expected > schedulableFor(state, po, line.itemId)) || lines.every(line => line.expected === 0)) return fail("Expected quantities must fit the unscheduled PO balance.", "expected");
      const batchId = id("batch");
      state.batches.push({ id: batchId, ref: nextRef("DEL-2026", state.batches), poId: po.id, scheduledDate: command.scheduledDate, evidence: command.evidence.trim(), delayReason: command.delayReason.trim(), lines, status: "expected", createdAt: at, updatedAt: at });
      log(batchId, "Delivery batch scheduled", command.delayReason);
      return done("Expected batch logged. Site receiving is next.", batchId);
    }
    case "confirmBatch": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to confirm receiving.");
      const batch = state.batches.find(b => b.id === command.id);
      const po = state.pos.find(p => p.id === batch?.poId);
      if (!batch || batch.status !== "expected" || !po || po.status !== "served") return fail("This batch is not awaiting site confirmation.");
      for (const line of batch.lines) {
        const input = command.lines[line.itemId];
        if (!input || !nonnegative(input.accepted) || input.accepted > line.expected || input.accepted > outstandingFor(state, po, line.itemId)) return fail("Accepted quantity exceeds this batch or the open PO balance.");
        if (input.accepted < line.expected && !input.issue.trim()) return fail("Describe any shortage or damage before confirming.", "issue");
        line.accepted = input.accepted; line.issue = input.issue.trim();
      }
      batch.status = "confirmed"; batch.updatedAt = at; log(batch.id, "Received quantities confirmed");
      return done("Quantities confirmed. Review the posting preview.");
    }
    case "postBatch": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to post site stock.");
      const batch = state.batches.find(b => b.id === command.id);
      const po = state.pos.find(p => p.id === batch?.poId);
      const request = po && requestForPO(state, po);
      if (!batch || batch.status !== "confirmed" || !po || !request || state.movements.some(m => m.batchId === batch.id && m.kind === "receipt")) return fail("This batch cannot be posted again.");
      const changed = batch.lines.some(line => command.accepted[line.itemId] !== line.accepted);
      if (changed && !reasonOK(command.reason)) return fail("Explain changes to accepted quantities before posting.", "reason");
      for (const line of batch.lines) {
        const quantity = command.accepted[line.itemId];
        const ordered = orderedFor(state, po, line.itemId);
        if (!nonnegative(quantity) || quantity > line.expected || quantity > ordered - acceptedFor(state, po.id, line.itemId, batch.id)) return fail("Posting quantity exceeds the batch or PO balance.");
        line.accepted = quantity;
      }
      batch.status = "posted"; batch.updatedAt = at;
      for (const line of batch.lines) {
        if (line.accepted <= 0) continue;
        const item = request.items.find(i => i.id === line.itemId)!;
        state.movements.push({ id: id("movement"), siteId: request.siteId, itemName: item.name, unit: item.unit, quantity: line.accepted, kind: "receipt", reason: `Posted ${batch.ref}${command.reason.trim() ? ` · ${command.reason.trim()}` : ""}`, batchId: batch.id, actor, at });
      }
      log(batch.id, "Accepted stock posted", command.reason);
      return done("Accepted quantities posted to site stock.");
    }
    case "recordMovement": {
      if (command.kind === "usage" && !permit("Site Personnel")) return fail("Switch to Site Personnel to record usage.");
      if (command.kind === "adjustment" && !permit("Site Personnel", "Accounting / Auditing")) return fail("This role cannot correct stock.");
      if (!state.sites.some(s => s.id === command.siteId) || !inventoryFor(state, command.siteId).some(item => item.name.toLowerCase() === command.itemName.trim().toLowerCase() && item.unit.toLowerCase() === command.unit.trim().toLowerCase())) return fail("Choose an existing site material.");
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      if (!Number.isFinite(command.quantity) || command.quantity === 0 || (command.kind === "usage" && command.quantity < 0)) return fail("Enter a valid nonzero quantity.", "quantity");
      const signed = command.kind === "usage" ? -command.quantity : command.quantity;
      if (stockFor(state, command.siteId, command.itemName, command.unit) + signed < 0) return fail("This movement would create negative stock.", "quantity");
      const movementId = id("movement");
      state.movements.push({ id: movementId, siteId: command.siteId, itemName: command.itemName, unit: command.unit, quantity: signed, kind: command.kind, reason: command.reason.trim(), actor, at });
      log(movementId, `${command.kind} recorded`, command.reason);
      return done(`${command.kind === "usage" ? "Usage" : "Adjustment"} recorded.`, movementId);
    }
    case "saveDocuments": {
      if (!permit("Accounting / Auditing")) return fail("Switch to Accounting to review documents.");
      if (!state.pos.some(p => p.id === command.poId && ["approved", "served"].includes(p.status))) return fail("This PO is not ready for accounting review.");
      if (command.review === "Complete" && (!command.invoiceRef.trim() || !command.receiptRef.trim())) return fail("Invoice and receipt references are required to complete review.");
      if (command.review === "Discrepancy" && !reasonOK(command.note)) return fail("Describe the discrepancy.", "note");
      let record = state.accounting.find(a => a.poId === command.poId);
      if (!record) { record = { poId: command.poId, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "" }; state.accounting.push(record); }
      Object.assign(record, { invoiceRef: command.invoiceRef.trim(), receiptRef: command.receiptRef.trim(), review: command.review, note: command.note.trim() });
      log(command.poId, `Documents marked ${record.review}`, record.note);
      return done("Document review saved.");
    }
    case "recordPayment": {
      if (!permit("Accounting / Auditing")) return fail("Switch to Accounting to record a payment reference.");
      const po = state.pos.find(p => p.id === command.poId && ["approved", "served"].includes(p.status));
      if (!po) return fail("This PO is not ready for payment tracking.");
      if (!positive(command.amount) || command.amount > poTotal(state, po) - paidTotal(state, po.id)) return fail("Payment must be positive and within the unpaid PO amount.", "amount");
      if (!command.reference.trim() || !command.date) return fail("Enter a payment reference and date.");
      const paymentId = id("payment");
      state.payments.push({ id: paymentId, poId: po.id, amount: command.amount, method: command.method, reference: command.reference.trim(), date: command.date, actor });
      log(po.id, `Payment reference recorded · ${command.amount}`);
      return done("Payment reference recorded.", paymentId);
    }
    case "updateAssignment": {
      if (!permit("Administrator")) return fail("Switch to Administrator to edit assignments.");
      const site = state.sites.find(s => s.id === command.siteId);
      if (!site || !command.manager.trim()) return fail("Enter the Project Manager's name.");
      site.manager = command.manager.trim(); log(site.id, "Project Manager updated");
      return done("Project Manager saved.");
    }
    case "addSite": {
      if (!permit("Administrator")) return fail("Switch to Administrator to add a project.");
      const name = command.name.trim();
      if (!name || !command.location.trim() || !command.manager.trim()) return fail("Complete the project and Project Manager fields.");
      if (!nonnegative(command.budget)) return fail("Enter a valid budget of zero or more.", "budget");
      if (state.sites.some(site => site.name.toLowerCase() === name.toLowerCase())) return fail("Enter a unique project name.", "name");
      const siteId = id("site");
      state.sites.push({ id: siteId, name, location: command.location.trim(), budget: command.budget, manager: command.manager.trim(), personnel: "" });
      log(siteId, "Project added");
      return done("Project added. Site Personnel can now create an MRF.", siteId);
    }
    case "addSupplierFromQuote": {
      if (!permit("Procurement")) return fail("Switch to Procurement to confirm a quotation supplier.");
      const name = command.name.trim();
      if (!name || state.suppliers.some(supplier => supplier.name.toLowerCase() === name.toLowerCase())) return fail("Enter a new supplier name.");
      const supplierId = id("supplier");
      state.suppliers.push({ id: supplierId, name, location: "", contact: "", accreditation: "Pending" });
      log(supplierId, "Supplier added from quotation");
      return done("Supplier added from quotation.", supplierId);
    }
  }
}
