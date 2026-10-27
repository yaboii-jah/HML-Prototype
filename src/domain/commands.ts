import { applyUsageEntry, type RecordUsageEntry } from "./usage-entries.ts";
import { archiveReady, validArchiveFileLink } from "./archive-destination.ts";
import { applyTransferCommand, isTransferCommand, requestSourcing, sourceStockAvailable, transferQuantityFor, transfersForRequest, type TransferCommand } from "./stock-transfers.ts";
import { applyStockSourcingCommand, invalidateStockReviews, isStockSourcingCommand, suitabilityQuantityFor, type StockSourcingCommand } from "./stock-suitability.ts";
import { siteActionProject } from "./site-access.ts";
import { coordinationEligible, coordinationBalance, coordinationError, saveCoordination, resetCoordination } from "./payment-coordination.ts";
import { projectRemovalReason } from "./project-removal.ts";
import type { PaymentCoordination } from "./types.ts";
import { philippineDate, validPaymentDate } from "./credit-terms.ts";
import { canAttachDelivery, canArchiveAccounting, deliveryReceiptVersion, deliveryDocumentIssues, receivedDelivery } from "./delivery-archive.ts";
import { archivedProof, canAttachPaymentProof, isExternalCredit, isExternalPayment, proofAssigned, requiresPMReview } from "./full-disbursement.ts";
import type { PaymentProof, Payment } from "./types.ts";
import { DELIVERY_LEGS, batchQuantityLimit, deliveryLocations, isSiteBatch, legFor, warehouseAvailableFor } from "./delivery-flow.ts";
import type { DeliveryLeg, DeliveryLocation } from "./types.ts";
import { openPaymentRequest, releaseBlocker } from "./workflow.ts";
import { auditMetadata, copyIdentity, extraAudit, validIdentity } from "./audit.ts";
import { projectMinimumBudget, projectScopes, scopeBudgetFor, scopeRemovalReason, scopeValidationError } from "./scope-budgets.ts";
import { operationEntity, operationError, operationRetry } from "./operations.ts";
import type { AuditIdentity, OperationTarget } from "./types.ts";
import { validAccountingDocument, MAX_ACCOUNTING_BATCH } from "./accounting-documents.ts";
import type { AccountingDocument } from "./types.ts";
import { initializePoDocument } from "./po-document.ts";
import { resolveComparisonSelections } from "./comparison-report.ts";
import type { ComparisonSelections } from "./types.ts";
import type { PO, MRF } from "./types.ts";
import { calculatedPoFinancial, defaultQuotationFinancial, poFinancialError, roundMoney } from "./pricing.ts";
import { directPoError } from "./po-review.ts";
import { newId } from "./ids.ts";
import { archiveFileName, freezeUploadNames, hasNewFiles, issueDocumentReference, lockProjectCode, nextDocumentReference, normalizeProjectCode, prefixedReference, projectCodeLocked, projectCodeRequired, projectCodeValidation } from "./document-numbering.ts";
import { normalizedBidReportReadiness, captureBidReport, bidLines } from "./bid-reports.ts";
import { comparableMaterialAmount } from "./comparative-pricing.ts";
import { budgetFor, inventoryFor, orderedFor, paidTotal, poItems, poSupplierId, poTotal, requestForPO, schedulableFor, stockFor } from "./selectors.ts";
import { hasFinalizedSuccessor, isFinalizedQuote, latestFinalizedQuotes, quotationCurrency, quoteReviewIssues } from "./procurement.ts";
import { poLineTotal } from "./pricing.ts";
import { procurementReady, supportingPdf } from "./request-archive.ts";
import { ROLES, type ArchivedQuoteFile, type DemoSnapshot, type DocumentRef, type DocumentStatus, type Item, type POAdjustment, type POLine, type Priority, type Quote, type Role } from "./types.ts";

export type Command = RecordUsageEntry | StockSourcingCommand | TransferCommand
  | { type: "savePaymentCoordination"; poId: string; revision: number; priority: PaymentCoordination["priority"]; status: PaymentCoordination["status"]; plannedDate: string; note: string }
  | { type: "recordCreditPayment"; poId: string; paymentId: string; amount: number; method: Payment["method"]; reference: string; date: string; proofIds: string[] }
  | { type: "voidCreditPayment"; poId: string; paymentId: string; reason: string }
  | { type: "issuePO"; id: string }
  | { type: "reopenPOReview"; id: string; reason: string }
  | { type: "attachPaymentProofs"; poId: string; documents: Pick<PaymentProof, "name" | "mime" | "size" | "localFileId" | "sha256">[] }
  | { type: "removePaymentProof"; poId: string; documentId: string }
  | { type: "completePaymentProofArchive"; poId: string; documentId: string; fileId: string; url: string }
  | { type: "failPaymentProofArchive"; poId: string; documentId: string; error: string }
  | { type: "verifyExternalPayment"; poId: string; method: Payment["method"]; reference: string; date: string }
  | { type: "reopenPaymentVerification"; poId: string; reason: string }

  | { type: "replaceMaterialAwards"; requestId: string; itemId: string; awards: { quoteId: string; quoteLineId: string; quantity: number }[] }
  | { type: "replaceMaterialAwardBatch"; requestId: string; materials: { itemId: string; awards: { quoteId: string; quoteLineId: string; quantity: number }[] }[] }
  | { type: "removeSite"; siteId: string }
  | { type: "updateSite"; documentCode?: string; siteId: string; name: string; location: string; budget: number }
  | { type: "removeProjectScope"; siteId: string; id: string }
  | { type: "saveProjectScope"; id?: string; siteId: string; name: string; budget: number }
  | { type: "startOperation"; target: OperationTarget }
  | { type: "attachAccountingDocuments"; poId: string; batchId?: string; documents: Pick<AccountingDocument, "name" | "kind" | "mime" | "size" | "localFileId" | "sha256">[] }
  | { type: "completeAccountingArchive"; poId: string; documentId: string; fileId: string; url: string }
  | { type: "failAccountingArchive"; poId: string; documentId: string; error: string }
  | { type: "createBidReport"; requestId: string; comparisonSelections?: ComparisonSelections }
  | { type: "saveBidReportFile"; format?: "xlsx" | "pdf"; id: string; localFileId: string; sha256: string }
  | { type: "failBidGeneration"; format?: "xlsx" | "pdf"; id: string; error: string }
  | { type: "completeBidArchive"; format?: "xlsx" | "pdf"; id: string; fileId: string; url: string }
  | { type: "failBidArchive"; format?: "xlsx" | "pdf"; id: string; error: string }
  | { type: "setRole"; role: Role }
  | { type: "setSiteFilter"; siteId: string }
  | { type: "saveRequest"; sourceRef?: string; aiAssisted?: boolean; aiReviewed?: boolean; specialInstructions?: string; signatoryTitles?: string[]; id?: string; intent: "draft" | "submit"; siteId: string; scopeId?: string; ref: string; requestDate: string; scopeDocument?: DocumentRef; requestedBy: string; approvedBy: string; purchaser: string; financeOfficer: string; items: Item[]; documents: DocumentRef[] }
  | { type: "reviewRequest"; id: string; decision: "approve" | "return" | "reject"; reason?: string }
  | { type: "reopenApprovedRequest"; id: string; reason: string }
  | { type: "completeRequestArchive"; id: string; formFileId: string; supportFileId: string; formUrl: string; supportUrl: string }
  | { type: "failRequestArchive"; id: string; error: string }
  | { type: "completeProjectFolder"; siteId: string; folderId: string }
  | { type: "failProjectFolder"; siteId: string; error: string }
  | { type: "setProjectDriveFolder"; siteId: string; folderId: string }
  | { type: "addQuote"; requestId: string; supplierId: string; ref: string; prices: Record<string, number>; available: string; leadDays: number; terms: string; document?: string }
  | { type: "saveReviewedQuote"; requestId: string; supplierId: string; ref: string; available: string; leadDays: number; terms: string; documents: DocumentRef[]; lines: Quote["lines"]; currency: string; tax: number; freight: number; discount: number; validity: string; extraction: "gemini" | "manual"; supersedesId?: string }
  | { type: "saveQuoteDraft"; quote: Quote }
  | { type: "deleteQuoteDraft"; id: string }
  | { type: "finalizeQuote"; id: string }
  | { type: "completeQuoteArchive"; id: string; files: ArchivedQuoteFile[] }
  | { type: "failQuoteArchive"; id: string; error: string }
  | { type: "stageAward"; requestId: string; quoteId: string; quoteLineId: string; quantity: number }
  | { type: "generateAwardPOs"; requestId: string; reasons: Record<string, string> }
  | { type: "createAwardPO"; requestId: string; quoteId: string; lines: POLine[]; tax: number; freight: number; discount: number; reason: string; notes: string }
  | { type: "createPO"; requestId: string; quoteId: string; reason: string; notes: string }
  | { type: "savePO"; document?: PO["document"]; financial?: PO["financial"]; id: string; quoteId: string; notes: string; finalize: boolean; lines?: POLine[]; tax?: number; freight?: number; discount?: number; adjustments?: POAdjustment[]; reason?: string; supersededReason?: string }
  | { type: "setPriority"; id: string; priority: Priority }
  | { type: "reviewPO"; id: string; decision: "approve" | "hold" | "return" | "reject"; reason?: string }
  | { type: "completePOArchive"; id: string; fileId: string; url: string }
  | { type: "failPOArchive"; id: string; error: string }
  | { type: "releasePO"; id: string }
  | { type: "saveAccountingPO"; paymentDueDate?: string; id: string; paymentMode: PO["paymentMode"]; financial: PO["financial"]; document?: PO["document"]; supplierId?: string; lines?: POLine[]; notes?: string; tax?: number; freight?: number; discount?: number; adjustments?: POAdjustment[] }
  | { type: "savePaymentRequest"; poId: string; id?: string; amount: number; note: string; submit: boolean }
  | { type: "reviewPaymentRequest"; id: string; decision: "approve" | "hold" | "return" | "reject"; reason?: string }
  | { type: "dispatchBatch"; id: string }
  | { type: "createBatch"; leg?: DeliveryLeg; parentBatchId?: string; destination?: DeliveryLocation; poId: string; scheduledDate: string; evidence: string; delayReason: string; expected: Record<string, number> }
  | { type: "confirmBatch"; id: string; lines: Record<string, { accepted: number; issue: string }> }
  | { type: "postBatch"; id: string; accepted: Record<string, number>; reason: string }
  | { type: "recordMovement"; siteId: string; itemName: string; unit: string; kind: "usage" | "adjustment"; quantity: number; reason: string }
  | { type: "captureDeliveryReceipt"; id: string }
  | { type: "completeDeliveryReceiptArchive"; batchId: string; receiptId: string; fileId: string; url: string }
  | { type: "failDeliveryReceiptArchive"; batchId: string; receiptId: string; error: string }
  | { type: "classifyAccountingDocument"; poId: string; documentId: string; kind: AccountingDocument["kind"]; batchId?: string }
  | { type: "saveDocuments"; poId: string; invoiceRef: string; receiptRef: string; review: DocumentStatus; note: string }
  | { type: "recordPayment"; paymentRequestId: string; method: "Cash" | "Bank" | "Check" | "Other"; reference: string; date: string }
  | { type: "addSite"; documentCode?: string; name: string; location: string; budget: number }
  | { type: "addSupplierFromQuote"; name: string };

export type CommandContext = { now: () => string; id: (prefix: string) => string; actor?: AuditIdentity; siteIds?: readonly string[] };
export type CommandResult = { ok: true; snapshot: DemoSnapshot; recordId?: string; message: string; persisted?: boolean } | { ok: false; message: string; field?: string; rowErrors?: Record<string, string> };
const defaultContext: CommandContext = { now: () => new Date().toISOString(), id: newId };
const fail = (message: string, field?: string): CommandResult => ({ ok: false, message, field });
const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const reasonOK = (s?: string) => (s?.trim().length ?? 0) >= 5;
const close = (left: number, right: number) => Math.abs(left - right) < 0.000001;
const validRequestDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function awardError(state: DemoSnapshot, requestId: string, quote: Quote, lines: POLine[], tax: number, freight: number, discount: number, excludingPoId?: string, convertingAwards: readonly string[] = []) {
  const request = state.requests.find(r => r.id === requestId);
  if (!procurementReady(request) || quote.mrfId !== requestId || !quote.lines?.length) return "Choose a reviewed quotation for an approved MRF.";
  if (!isFinalizedQuote(quote) || quote.currency && quote.currency !== "PHP") return "Only finalized PHP quotations can be awarded.";
  if (quote.archive && quote.archive.status !== "complete") return "Archive this supplier quotation to Google Drive before awarding it.";
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
  for (const award of state.pendingAwards.filter(value => value.requestId === requestId && !convertingAwards.includes(value.id))) {
    awarded.set(award.itemId, (awarded.get(award.itemId) || 0) + award.quantity);
    if (award.quoteId === quote.id) usedOffers.set(award.quoteLineId, (usedOffers.get(award.quoteLineId) || 0) + award.quantity);
  }
  if (request.items.some(item => (awarded.get(item.id) || 0) + transferQuantityFor(state, requestId, item.id) + suitabilityQuantityFor(state, requestId, item.id) > item.quantity + 0.000001)) return "Awarded quantities exceed the MRF request or overlap stock requests and suitability reviews.";
  if (quote.lines.some(offer => (usedOffers.get(offer.id) || 0) > offer.quantity * offer.conversionFactor + 0.000001)) return "Awarded quantity exceeds the supplier's quoted quantity.";
  const subtotal = lines.reduce((sum, line) => sum + poLineTotal(line), 0);
  if (discount > subtotal + tax + freight) return "Discount exceeds the PO amount.";
  return "";
}

export function applyCommand(previous: DemoSnapshot, command: Command, ctx: CommandContext = defaultContext): CommandResult {
  const state = structuredClone(previous);
  state.scopes ||= [];
  if (ctx.actor && (!validIdentity(ctx.actor) || !ROLES.includes(ctx.actor.role))) return fail("The acting account is invalid.");
  const actor = ctx.actor?.role || state.role;
  const identity = copyIdentity(ctx.actor);
  if (actor === "Site Personnel" && ctx.siteIds !== undefined) {
    const siteId = siteActionProject(state, command);
    if (siteId && !ctx.siteIds.includes(siteId)) return fail("Ask an Administrator to assign your account to this project before performing site actions.");
  }
  if (command.type === "recordUsageEntry") return applyUsageEntry(state, command, ctx);
  if (isStockSourcingCommand(command)) return applyStockSourcingCommand(state, command, ctx);
  if (isTransferCommand(command)) return applyTransferCommand(state, command, ctx);
  const reopenDocumentReview = (poId: string, reason: string) => {
    const record = state.accounting.find(value => value.poId === poId);
    if (record?.review !== "Complete") return;
    (record.reviewHistory ||= []).push({ review: record.review, invoiceRef: record.invoiceRef, receiptRef: record.receiptRef, note: record.note, at: record.reviewedAt || at, by: record.reviewedBy, reason });
    record.review = "Under Review"; record.reviewedAt = at; record.reviewedBy = copyIdentity(identity);
  };
  const at = ctx.now();
  const id = ctx.id;
  let logged = false;
  const log = (entity: string, action: string, reason?: string) => { logged = true; state.activity.unshift({ id: id("act"), entity, action, reason: reason?.trim() || undefined, actor, at, ...auditMetadata(previous, state, command, entity, identity) }); };
  const done = (message: string, recordId?: string): CommandResult => { if (!logged) { const event = extraAudit(previous, state, command); if (event) log(event.entity, event.action, event.reason); } return { ok: true, snapshot: state, recordId, message }; };
  const permit = (...roles: Role[]) => roles.includes(actor);
  const initializePo = (po: PO, request: MRF, quote: Quote) => { initializePoDocument(po, request, quote, state.sites.find(value => value.id === request.siteId)!, at); po.document!.vendorName ||= state.suppliers.find(value => value.id === quote.supplierId)?.name || ""; };

  switch (command.type) {
    case "removeSite": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to delete a project.");
      const reason = projectRemovalReason(state, command.siteId, Date.parse(at));
      if (reason) return fail(reason);
      const site = state.sites.find(value => value.id === command.siteId)!;
      state.scopes = state.scopes.filter(value => value.siteId !== site.id);
      state.sites = state.sites.filter(value => value.id !== site.id);
      if (state.siteFilter === site.id) state.siteFilter = "all";
      log(site.id, "Unused project deleted", site.driveFolderId ? `Drive folder retained: ${site.driveFolderId}` : undefined);
      return done("Project deleted. Existing Drive folders are retained.");
    }
    case "replaceMaterialAwardBatch": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to allocate materials.");
      if (!command.materials.length || new Set(command.materials.map(value => value.itemId)).size !== command.materials.length) return fail("Choose unique materials to apply.");
      let next = state;
      for (const material of command.materials) {
        const result = applyCommand(next, { type: "replaceMaterialAwards", requestId: command.requestId, ...material }, ctx);
        if (!result.ok) return result;
        next = result.snapshot;
      }
      return { ok: true, snapshot: next, message: `Allocations applied for ${command.materials.length} materials.` };
    }
    case "savePaymentCoordination": {
      if (!permit("Finance") || !identity) return fail("Sign in as Finance to coordinate payments.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !coordinationEligible(po) || !coordinationBalance(state, po)) return fail("Only issued, unpaid external-payment POs can be coordinated.");
      if (command.revision !== (po.paymentCoordination?.revision || 0)) return fail("This coordination plan changed. Reload it before saving.");
      const value = { priority: command.priority, status: command.status, plannedDate: command.plannedDate.trim(), note: command.note.trim() };
      const error = coordinationError(value);
      if (error) return fail(error);
      const prior = po.paymentCoordination;
      if (prior && prior.priority === value.priority && prior.status === value.status && prior.plannedDate === value.plannedDate && prior.note === value.note) return done("Coordination unchanged.");
      saveCoordination(po, value, at, identity, "Finance updated payment coordination");
      po.updatedAt = at;
      log(po.id, `Payment coordination: ${value.status}`, value.note);
      return done("Payment coordination saved. Accounting verifies payment separately.");
    }
    case "updateSite": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to edit a project.");
      const site = state.sites.find(value => value.id === command.siteId);
      if (!site) return fail("Project not found.");
      const name = command.name.trim(), location = command.location.trim(), budget = roundMoney(command.budget);
      if (!name || !location) return fail("Complete the project name and location.");
      if (!nonnegative(command.budget) || !Number.isFinite(budget)) return fail("Enter a valid budget of zero or more.", "budget");
      if (state.sites.some(value => value.id !== site.id && value.name.trim().toLowerCase() === name.toLowerCase())) return fail("Enter a unique project name.", "name");
      if (budget < projectMinimumBudget(state, site.id)) return fail("Project budget cannot be below its scope allocations or committed and spent funds.", "budget");
      const documentCode = command.documentCode === undefined ? site.documentCode : normalizeProjectCode(command.documentCode);
      if (command.documentCode !== undefined) { const error = projectCodeValidation(state, documentCode!, site.id); if (error) return fail(error, "documentCode"); }
      if (documentCode !== site.documentCode && projectCodeLocked(site)) return fail("The project code is locked because it has already been used.", "documentCode");
      if (site.name === name && site.location === location && site.budget === budget && site.documentCode === documentCode) return done("Project details unchanged.", site.id);
      Object.assign(site, { name, location, budget, documentCode });
      log(site.id, "Project details updated");
      return done("Project details saved.", site.id);
    }
    case "removeProjectScope": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to remove a scope.");
      const scope = state.scopes.find(value => value.id === command.id && value.siteId === command.siteId);
      if (!scope) return fail("Scope not found in this project.");
      const blocked = scopeRemovalReason(state, scope.id);
      if (blocked) return fail(blocked);
      state.scopes = state.scopes.filter(value => value.id !== scope.id);
      log(scope.id, "Unused scope of work removed");
      return done("Scope removed. Its allocation is now unallocated within this project.", scope.id);
    }
    case "saveProjectScope": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to maintain scope budgets.");
      const project = state.sites.find(value => value.id === command.siteId);
      if (!project) return fail("Project not found.");
      const existing = command.id ? state.scopes.find(scope => scope.id === command.id) : undefined;
      if (command.id && (!existing || existing.siteId !== command.siteId)) return fail("Scope not found in this project.");
      const name = command.name.trim(), budget = roundMoney(command.budget);
      if (!name) return fail("Enter a scope name.", "name");
      if (!nonnegative(command.budget) || !Number.isFinite(budget)) return fail("Enter a valid scope budget of zero or more.", "budget");
      if (projectScopes(state, project.id).some(scope => scope.id !== existing?.id && scope.name.trim().toLowerCase() === name.toLowerCase())) return fail("This project already has a scope with that name.", "name");
      const otherAllocated = projectScopes(state, project.id).filter(scope => scope.id !== existing?.id).reduce((sum, scope) => sum + scope.budget, 0);
      if (roundMoney(otherAllocated + budget) > roundMoney(project.budget)) return fail("Scope allocations cannot exceed the project budget.", "budget");
      const used = existing ? scopeBudgetFor(state, existing.id) : undefined;
      if (used && budget < roundMoney(used.committed + used.spent)) return fail("Scope budget cannot be below its committed and spent amount.", "budget");
      if (existing?.name === name && existing.budget === budget) return done("Scope allocation unchanged.", existing.id);
      const scopeId = existing?.id || id("scope");
      if (existing) Object.assign(existing, { name, budget });
      else state.scopes.push({ id: scopeId, siteId: project.id, name, budget });
      log(scopeId, existing ? "Scope allocation updated" : "Scope of work created");
      return done("Scope allocation saved.", scopeId);
    }
    case "startOperation": {
      const error = operationError(state, command.target, actor);
      if (error) return fail(error);
      const retry = operationRetry(state, command.target);
      const label = command.target.kind === "project" ? "Project folder creation" : command.target.kind === "report" ? "Comparison processing" : command.target.kind === "attachment" ? "Evidence attachment" : "Drive archive";
      log(operationEntity(command.target), `${label} ${retry ? "retried" : "started"}`);
      state.activity[0].eventType = retry ? "operation.retried" : "operation.started";
      return done(`${label} started.`);
    }
    case "createBidReport": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to generate a bid comparison.");
      const error = normalizedBidReportReadiness(state, command.requestId);
      if (error) return fail(error);
      const request = state.requests.find(value => value.id === command.requestId)!;
      const codeError = projectCodeRequired(state, request.siteId);
      if (codeError) return fail(codeError);
      const project = state.sites.find(value => value.id === request.siteId)!;
      lockProjectCode(project, at);
      const data = captureBidReport(state, command.requestId, true);
      let comparisonSelections: ComparisonSelections;
      try { comparisonSelections = resolveComparisonSelections(data, command.comparisonSelections, true); }
      catch (cause) { return fail(cause instanceof Error ? cause.message : "Review the comparison alternatives."); }
      for (const offer of data.offers.filter(value => value.source !== "PO source")) for (const item of data.request.items) {
        const line = bidLines(data, offer.quote).find(value => value.id === comparisonSelections[offer.quote.id]?.[item.id]);
        if (line && comparableMaterialAmount(offer.quote, line, item) === undefined) return fail(`Review the material price, quantity and conversion for ${offer.supplierName}: ${item.name}.`);
      }
      const version = Math.max(0, ...state.bidReports.filter(report => report.requestId === command.requestId).map(report => report.version)) + 1;
      const reportId = id("bid");
      const ref = prefixedReference(project.documentCode!, data.request.ref);
      state.bidReports.push({ id: reportId, requestId: command.requestId, version, comparisonRevision: 5, comparisonSelections, generatedAt: at, fileName: archiveFileName(ref, "bid-comparison", "v" + version, ".xlsx"), data, pdf: { fileName: archiveFileName(ref, "bid-comparison", "v" + version, ".pdf"), archive: { status: "pending" } }, archive: { status: "pending" } });
      log(reportId, `Bid comparison v${version} captured`);
      return done("Bid comparison captured. Generating Excel and PDF…", reportId);
    }
    case "saveBidReportFile":
    case "failBidGeneration":
    case "completeBidArchive":
    case "failBidArchive": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to update a bid comparison archive.");
      const report = state.bidReports.find(value => value.id === command.id);
      if (!report) return fail("Bid comparison not found.");
      const artifact = command.format === "pdf" ? report.pdf : report;
      if (!artifact) return fail("This legacy report has no saved PDF artifact. Generate a new version.");
      if (command.type === "saveBidReportFile") {
        if (!command.localFileId || !/^[a-f0-9]{64}$/.test(command.sha256)) return fail("The generated workbook is invalid.");
        if (artifact.sha256 && artifact.sha256 !== command.sha256) return fail("A saved report version cannot be replaced.");
        artifact.localFileId = command.localFileId; artifact.sha256 = command.sha256; delete artifact.generationError;
        return done(command.format === "pdf" ? "Comparison PDF ready." : "Excel workbook ready.");
      }
      if (command.type === "failBidGeneration") { if (!artifact.sha256) { artifact.generationError = command.error; log(report.id, "Comparison generation failed", command.error); } return done("Workbook generation needs retry."); }
      if (artifact.archive.status === "complete") return done("Bid comparison already archived.");
      if (command.type === "completeBidArchive") {
        if (!artifact.sha256 || !command.fileId || !validArchiveFileLink(state, command.url, command.fileId)) return fail("The workbook archive is invalid.");
        artifact.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(report.id, `Bid comparison v${report.version} archived`);
        return done("Bid comparison archived.");
      }
      artifact.archive.error = command.error;
      log(report.id, "Comparison archive failed", command.error);
      return done("The report file is available; Drive archive needs retry.");
    }
    case "setRole":
      if (!ROLES.includes(command.role)) return fail("Unknown role.");
      state.role = command.role;
      return done(`Switched to ${command.role}`);
    case "setSiteFilter":
      if (command.siteId !== "all" && !state.sites.some(s => s.id === command.siteId)) return fail("Site not found.");
      state.siteFilter = command.siteId;
      return done("Site context updated.");
    case "saveRequest": {
      if (!permit("Site Personnel")) return fail("Sign in as Site Personnel to edit an MRF.");
      if (!state.sites.some(s => s.id === command.siteId)) return fail("Choose a valid site.", "siteId");
      const original = command.id ? state.requests.find(r => r.id === command.id) : undefined;
      if (command.id && !original) return fail("MRF not found.");
      const correcting = original?.status === "approved" && original.correction?.status === "requested";
      if (original && !["draft", "returned"].includes(original.status) && !correcting) return fail("Only draft, returned, or reopened MRFs can be edited.");
      const aiAssisted = original?.aiAssisted === true || command.aiAssisted === true;
      if (!original) { const error = projectCodeRequired(state, command.siteId); if (error) return fail(error, "siteId"); }
      if (original?.numbering && original.siteId !== command.siteId) return fail("A numbered MRF cannot move to another project.", "siteId");
      const assigned = original ? undefined : nextDocumentReference(state, command.siteId, "MRF");
      const ref = original?.numbering ? original.ref : assigned?.ref || (command.ref || "").trim();
      const requestDate = (command.requestDate || "").trim();
      const scopeId = command.scopeId?.trim() || undefined;
      if (scopeId && scopeValidationError(state, command.siteId, scopeId, false)) return fail("Choose a scope of work belonging to this project.", "scopeId");
      if (command.intent === "submit") {
        if (original?.correction?.scope !== "documents") { const error = scopeValidationError(state, command.siteId, scopeId); if (error) return fail(error, "scopeId"); }
        if (!ref) return fail("Enter the M.R.F No. before submitting.", "ref");
        if (state.requests.some(request => request.id !== original?.id && request.ref.trim().toLocaleLowerCase() === ref.toLocaleLowerCase())) return fail("This M.R.F No. is already in use.", "ref");
        if (!validRequestDate(requestDate)) return fail("Enter a valid Request Date before submitting.", "requestDate");
        if (![command.requestedBy, command.approvedBy, command.purchaser, command.financeOfficer].every(x => x.trim())) return fail("Complete the request's general information before submitting.");
        if (!command.items.length || command.items.some(i => !i.name.trim() || !i.unit.trim() || !positive(i.quantity) || !i.neededDate.trim() || !i.location.trim())) return fail("Each material needs a name, unit, positive quantity, date needed, and delivery location.", "items");
        if (command.documents.filter(document => document.type === "Supporting PDF" && !!document.fileId).length !== 1) return fail("Attach one combined supporting PDF before submitting.", "documents");
        if (aiAssisted && command.aiReviewed !== true) return fail("Review the extracted request details and materials before submitting.", "aiReview");
      }
      const aiReview = aiAssisted ? { aiAssisted: true, aiReviewedAt: command.intent === "submit" ? at : undefined, aiReviewedBy: command.intent === "submit" ? actor : undefined, aiReviewedByIdentity: command.intent === "submit" ? copyIdentity(identity) : undefined } : {};
      const items = command.items.map(i => ({ ...i, name: i.name.trim(), unit: i.unit.trim(), id: i.id || id("item"), neededDate: i.neededDate.trim(), purpose: i.purpose.trim(), location: i.location.trim(), remarks: i.remarks.trim() }));
      const newFiles = hasNewFiles(command.documents, original?.documents);
      if (newFiles) { const error = projectCodeRequired(state, command.siteId); if (error) return fail(error, "siteId"); }
      const documents = freezeUploadNames(state, command.siteId, ref, command.documents, original?.documents || [], at);
      const archiveRef = newFiles ? prefixedReference(state.sites.find(site => site.id === command.siteId)!.documentCode!, ref) : original?.archiveRef;
      const fields = { sourceRef: command.sourceRef === undefined ? original?.sourceRef || "" : command.sourceRef.trim(), archiveRef, specialInstructions: command.specialInstructions?.trim() || "", signatoryTitles: command.signatoryTitles?.slice(0, 4).map(value => value.trim()) || [], ref, requestDate, siteId: command.siteId, scopeId, category: original?.category || "", scope: original?.scope || "", scopeDocument: command.scopeDocument, requestedBy: command.requestedBy.trim(), approvedBy: command.approvedBy.trim(), purchaser: command.purchaser.trim(), financeOfficer: command.financeOfficer.trim(), items, documents: documents.filter(d => d.name.trim()), status: command.intent === "submit" ? "submitted" as const : "draft" as const, reason: undefined, updatedAt: at };
      if (original) {
        if (correcting) {
          if (original.correction?.scope === "documents" && (scopeId !== original.scopeId || ref !== original.ref || requestDate !== original.requestDate || command.siteId !== original.siteId || JSON.stringify(items) !== JSON.stringify(original.items) || fields.requestedBy !== original.requestedBy || fields.approvedBy !== original.approvedBy || fields.purchaser !== original.purchaser || fields.financeOfficer !== original.financeOfficer || fields.specialInstructions !== (original.specialInstructions || "") || JSON.stringify(fields.signatoryTitles) !== JSON.stringify(original.signatoryTitles || []))) return fail("Only the supporting PDF can change after procurement has started.");
          original.documents = fields.documents;
          original.archiveRef = fields.archiveRef;
          if (original.correction?.scope === "full") Object.assign(original, { ...fields, status: "approved" });
          if (command.intent === "submit") original.correction = { ...original.correction!, status: "submitted" };
          original.updatedAt = at;
        } else Object.assign(original, fields);
        Object.assign(original, aiReview);
        invalidateStockReviews(state, original.id, at);
        log(original.id, command.intent === "submit" ? "MRF revised and resubmitted" : "MRF draft saved");
        return done(command.intent === "submit" ? `MRF submitted to ${requiresPMReview(original) ? "Project Manager" : "Procurement"}.` : "MRF draft saved.", original.id);
      }
      const requestId = id("mrf");
      state.requests.push({ id: requestId, ...issueDocumentReference(state, command.siteId, "MRF", at), workflow: "pm-external-v1", createdAt: at, ...fields, ...aiReview });
      log(requestId, command.intent === "submit" ? "MRF submitted" : "MRF draft saved");
      return done(command.intent === "submit" ? "MRF submitted to Project Manager." : "MRF draft saved.", requestId);
    }
    case "reviewRequest": {
      const request = state.requests.find(r => r.id === command.id);
      const reviewer = requiresPMReview(request) ? "Project Manager" : "Procurement";
      if (!permit(reviewer)) return fail(`Sign in as ${reviewer} to review this MRF.`);
      if (!request || request.status !== "submitted" && !(request.status === "approved" && request.correction?.status === "submitted")) return fail(`This MRF is no longer awaiting ${reviewer} review.`);
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      if (command.decision === "approve" && request.correction?.scope !== "documents") { const error = scopeValidationError(state, request.siteId, request.scopeId); if (error) return fail(error, "scopeId"); }
      if (command.decision === "approve" && !archiveReady(state.sites.find(site => site.id === request.siteId))) return fail("Map this project's Google Drive folder before approval.");
      if (command.decision === "approve" && !supportingPdf(request)) return fail("A combined supporting PDF is required before approval.");
      if (request.correction) {
        if (command.decision === "reject") return fail("Return the correction to Site Personnel instead.");
        if (command.decision === "return") request.correction = { ...request.correction, status: "requested", reason: command.reason!.trim() };
        else { request.correction = undefined; request.archive = { status: "pending", approvedAt: at, fileRef: request.archiveRef || request.ref, versions: request.archive?.versions || [] }; }
        request.updatedAt = at;
        log(request.id, command.decision === "approve" ? "MRF correction approved; Drive archive pending" : "MRF correction returned", command.reason);
        return done(command.decision === "approve" ? "MRF correction approved. Archiving to Drive." : "MRF correction returned.");
      }
      request.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : "rejected";
      if (command.decision === "approve") request.archive = { status: "pending", approvedAt: at, fileRef: request.archiveRef || request.ref, versions: [] };
      request.reason = command.decision === "approve" ? undefined : command.reason?.trim();
      request.updatedAt = at;
      log(request.id, `MRF ${request.status}`, request.reason);
      return done(command.decision === "approve" ? "MRF approved. Google Drive archiving is next." : `MRF ${request.status}.`);
    }
    case "reopenApprovedRequest": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to reopen an MRF.");
      const request = state.requests.find(value => value.id === command.id);
      if (!request || request.status !== "approved" || request.correction || request.archive?.status !== "complete") return fail("Only an archived approved MRF can be reopened.");
      if (!reasonOK(command.reason)) return fail("Explain the correction in at least five characters.");
      const hasPurchasing = state.quotes.some(value => value.mrfId === request.id) || state.pos.some(value => value.mrfId === request.id) || transfersForRequest(state, request.id).length > 0;
      request.correction = { status: "requested", scope: hasPurchasing ? "documents" : "full", reason: command.reason.trim() };
      request.updatedAt = at;
      log(request.id, "MRF reopened for correction", command.reason);
      return done("Site Personnel can revise this MRF.");
    }
    case "completeRequestArchive": {
      if (!permit("Procurement", "Administrator") && !(permit("Project Manager") && requiresPMReview(state.requests.find(r => r.id === command.id)))) return fail("Sign in with the MRF reviewing department or Administrator to complete its archive.");
      const request = state.requests.find(value => value.id === command.id);
      if (request?.archive?.status === "complete" && request.archive.versions.at(-1)?.formFileId === command.formFileId && request.archive.versions.at(-1)?.supportFileId === command.supportFileId) return done("MRF already archived.");
      if (!request || request.status !== "approved" || request.archive?.status !== "pending" || request.correction) return fail("This MRF is not awaiting a Drive archive.");
      if (![command.formFileId, command.supportFileId, command.formUrl, command.supportUrl].every(Boolean)) return fail("The Drive archive is incomplete.");
      request.archive.versions.push({ version: request.archive.versions.length + 1, formFileId: command.formFileId, supportFileId: command.supportFileId, formUrl: command.formUrl, supportUrl: command.supportUrl, archivedAt: at });
      request.archive.status = "complete";
      request.archive.error = undefined;
      request.updatedAt = at;
      log(request.id, "MRF archived");
      return done("MRF archived. Procurement can continue.");
    }
    case "failRequestArchive": {
      if (!permit("Procurement", "Administrator") && !(permit("Project Manager") && requiresPMReview(state.requests.find(r => r.id === command.id)))) return fail("Sign in with the MRF reviewing department or Administrator to update its archive.");
      const request = state.requests.find(value => value.id === command.id);
      if (!request || request.archive?.status !== "pending") return fail("This MRF is not awaiting a Drive archive.");
      request.archive.error = command.error.slice(0, 300);
      request.updatedAt = at;
      log(request.id, "Drive archive failed", command.error);
      return done("Drive archive pending. Retry from this request.");
    }
    case "addQuote": {
      return fail("Use the quotation review workflow and attach the supplier's original document.");
    }
    case "saveQuoteDraft": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to review quotations.");
      const incoming = command.quote;
      const request = state.requests.find(value => value.id === incoming.mrfId);
      if (!procurementReady(request)) return fail("This MRF must be approved, archived, and free of pending corrections before Procurement can continue.");
      if (!incoming.id || !Array.isArray(incoming.lines) || !Array.isArray(incoming.adjustments)) return fail("The quotation draft is incomplete.");
      const existing = state.quotes.find(value => value.id === incoming.id);
      if (existing && existing.reviewStatus !== "draft") return fail("Finalized quotations cannot be changed. Create a revision.");
      if (existing && (existing.mrfId !== incoming.mrfId || existing.supersedesId !== incoming.supersedesId)) return fail("The quotation's source request or revision cannot change.");
      const previousQuote = incoming.supersedesId ? state.quotes.find(value => value.id === incoming.supersedesId && value.mrfId === incoming.mrfId && isFinalizedQuote(value)) : undefined;
      if (incoming.supersedesId && !previousQuote) return fail("Choose a finalized quotation to revise.");
      if (!existing && state.quotes.some(value => value.id === incoming.id)) return fail("Quotation ID already exists.");
      if (!existing && incoming.supersedesId && state.quotes.some(value => value.supersedesId === incoming.supersedesId && value.reviewStatus === "draft")) return fail("A draft revision already exists for this quotation.");
      if (hasNewFiles(incoming.documents, existing?.documents)) { const error = projectCodeRequired(state, request!.siteId); if (error) return fail(error); }
      const documents = freezeUploadNames(state, request!.siteId, request!.ref, incoming.documents, existing?.documents || [], at, incoming.id);
      const draft: Quote = { ...incoming, currency: quotationCurrency(incoming.currency), financial: incoming.financial || (existing ? existing.financial : defaultQuotationFinancial()), reviewStatus: "draft", prices: {}, version: existing?.version || (previousQuote?.version || 0) + 1, documents, archive: undefined, reviewedAt: undefined };
      if (existing) Object.assign(existing, draft);
      else state.quotes.push(draft);
      return done(existing ? "Quotation draft saved." : "Quotation draft created.", draft.id);
    }
    case "deleteQuoteDraft": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to remove quotation drafts.");
      const quote = state.quotes.find(value => value.id === command.id && value.reviewStatus === "draft");
      if (!quote) return fail("Only an unfinalized quotation draft can be removed.");
      if (!procurementReady(state.requests.find(value => value.id === quote.mrfId))) return fail("Procurement is paused until the MRF archive is ready.");
      if (state.pendingAwards.some(value => value.quoteId === quote.id) || state.pos.some(value => value.quoteId === quote.id)) return fail("Remove linked awards before deleting this draft.");
      state.quotes = state.quotes.filter(value => value.id !== quote.id);
      log(quote.id, "Quotation draft removed");
      return done("Quotation draft removed.");
    }
    case "finalizeQuote": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to finalize quotations.");
      const quote = state.quotes.find(value => value.id === command.id && value.reviewStatus === "draft");
      if (!quote) return fail("Quotation draft not found.");
      if (!procurementReady(state.requests.find(value => value.id === quote.mrfId))) return fail("Procurement is paused until the MRF archive is ready.");
      const issues = quoteReviewIssues(state, quote);
      if (issues.length) return fail(issues[0]);
      quote.currency = quotationCurrency(quote.currency);
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
      quote.archive = { status: "pending", files: [] };
      quote.lines = quote.lines?.map(line => ({ ...line, matchConfirmed: line.requestItemId ? true : false }));
      log(quote.id, "Supplier quotation finalized");
      return done("Quotation finalized for comparison and awards.", quote.id);
    }
    case "completeQuoteArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to archive a quotation.");
      const quote = state.quotes.find(value => value.id === command.id);
      if (quote?.archive?.status === "complete" && JSON.stringify(quote.archive.files) === JSON.stringify(command.files)) return done("Quotation already archived.");
      if (!quote || quote.reviewStatus !== "finalized" || quote.archive?.status !== "pending") return fail("This quotation is not awaiting a Drive archive.");
      if (quote.documents.length !== command.files.length || quote.documents.some(document => !command.files.some(file => file.localFileId === document.fileId && file.driveFileId && file.url))) return fail("The quotation archive is incomplete.");
      quote.archive = { status: "complete", files: command.files };
      log(quote.id, "Supplier quotation archived");
      return done("Supplier quotation archived.");
    }
    case "failQuoteArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to update a quotation archive.");
      const quote = state.quotes.find(value => value.id === command.id);
      if (!quote || quote.archive?.status !== "pending") return fail("This quotation is not awaiting a Drive archive.");
      quote.archive.error = command.error.slice(0, 300);
      log(quote.id, "Drive archive failed", command.error);
      return done("Quotation archive pending. Retry the upload.");
    }
    case "replaceMaterialAwards": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to allocate materials.");
      const request = state.requests.find(value => value.id === command.requestId);
      const item = request?.items.find(value => value.id === command.itemId);
      if (!procurementReady(request) || !item) return fail("Choose a material from an archived approved MRF.");
      const prior = state.pendingAwards.filter(value => value.requestId === request.id && value.itemId === item.id);
      const candidates: typeof prior = [];
      const seen = new Set<string>();
      for (const award of command.awards) {
        if (seen.has(award.quoteLineId) || !positive(award.quantity)) return fail("Enter unique offers with positive award quantities.");
        seen.add(award.quoteLineId);
        const quote = state.quotes.find(value => value.id === award.quoteId && value.mrfId === request.id);
        const offer = quote?.lines?.find(value => value.id === award.quoteLineId && value.requestItemId === item.id);
        if (!quote || !offer || !isFinalizedQuote(quote) || hasFinalizedSuccessor(state, quote.id) || quote.currency && quote.currency !== "PHP") return fail("Use the current finalized PHP quotation.");
        if (quote.archive && quote.archive.status !== "complete") return fail("Archive this supplier quotation to Google Drive before awarding it.");
        if (!positive(offer.conversionFactor) || !positive(offer.unitPrice) || !positive(offer.quantity)) return fail("Use a valid reviewed supplier offer.");
        if (state.pos.some(po => po.mrfId === request.id && po.status !== "rejected" && poSupplierId(state, po) === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO draft instead.");
        const used = state.pos.filter(po => po.quoteId === quote.id && po.status !== "rejected").reduce((sum, po) => sum + (po.lines || []).filter(line => line.quoteLineId === offer.id).reduce((total, line) => total + line.quantity, 0), 0);
        if (award.quantity + used > offer.quantity * offer.conversionFactor + 0.000001) return fail("Awarded quantity exceeds the supplier's quoted quantity.");
        candidates.push({ id: prior.find(value => value.quoteLineId === offer.id)?.id || id("award"), requestId: request.id, itemId: item.id, quoteId: quote.id, quoteLineId: offer.id, quantity: award.quantity });
      }
      const sourcing = requestSourcing(state, request, item);
      const ordered = sourcing.ordered + sourcing.transfers + sourcing.suitability;
      if (ordered + candidates.reduce((sum, value) => sum + value.quantity, 0) > item.quantity + 0.000001) return fail("Awarded quantities exceed the MRF request.");
      state.pendingAwards = [...state.pendingAwards.filter(value => value.requestId !== request.id || value.itemId !== item.id), ...candidates];
      for (const award of [...prior, ...candidates.filter(value => !prior.some(old => old.id === value.id))]) {
        const before = prior.find(value => value.id === award.id), after = candidates.find(value => value.id === award.id);
        if (before?.quantity !== after?.quantity || before?.quoteId !== after?.quoteId) log(award.id, after ? "Supplier allocation saved" : "Supplier allocation removed");
      }
      return done("Material allocations applied.", item.id);
    }
    case "stageAward": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to allocate materials.");
      const request = state.requests.find(value => value.id === command.requestId);
      const quote = state.quotes.find(value => value.id === command.quoteId && value.mrfId === command.requestId);
      const offer = quote?.lines?.find(value => value.id === command.quoteLineId);
      if (!procurementReady(request) || !quote || !offer || !offer.requestItemId) return fail("Choose a matching offer for an archived approved MRF.");
      if (!Number.isFinite(command.quantity) || command.quantity < 0) return fail("Enter a valid award quantity.");
      const existing = state.pendingAwards.find(value => value.quoteLineId === offer.id && value.requestId === request.id);
      if (command.quantity === 0) { state.pendingAwards = state.pendingAwards.filter(value => value.id !== existing?.id); return done("Award removed."); }
      if (!isFinalizedQuote(quote) || hasFinalizedSuccessor(state, quote.id) || quote.currency && quote.currency !== "PHP") return fail("Use the current finalized PHP quotation.");
      if (quote.archive && quote.archive.status !== "complete") return fail("Archive this supplier quotation to Google Drive before awarding it.");
      const otherPending = state.pendingAwards.filter(value => value.requestId === request.id && value.id !== existing?.id);
      const usedRequest = state.pos.filter(value => value.mrfId === request.id && value.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, offer.requestItemId), 0) + otherPending.filter(value => value.itemId === offer.requestItemId).reduce((sum, value) => sum + value.quantity, 0);
      const usedOffer = state.pos.filter(value => value.quoteId === quote.id && value.status !== "rejected").reduce((sum, po) => sum + (po.lines || []).filter(value => value.quoteLineId === offer.id).reduce((total, value) => total + value.quantity, 0), 0);
      const requested = request.items.find(value => value.id === offer.requestItemId);
      if (!requested || command.quantity + usedRequest + transferQuantityFor(state, request.id, requested.id) + suitabilityQuantityFor(state, request.id, requested.id) > requested.quantity + 0.000001) return fail("Awarded quantities exceed the MRF request or overlap stock requests and suitability reviews.");
      if (command.quantity + usedOffer > offer.quantity * offer.conversionFactor + 0.000001) return fail("Awarded quantity exceeds the supplier's quoted quantity.");
      if (existing) state.pendingAwards = state.pendingAwards.filter(value => value.id !== existing.id);
      if (command.quantity > 0) state.pendingAwards.push({ id: existing?.id || id("award"), requestId: request.id, quoteId: quote.id, quoteLineId: offer.id, itemId: offer.requestItemId, quantity: command.quantity });
      return done(command.quantity > 0 ? "Award staged." : "Award removed.");
    }
    case "generateAwardPOs": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to prepare POs.");
      const codeError = projectCodeRequired(state, state.requests.find(value => value.id === command.requestId)?.siteId || "");
      if (codeError) return fail(codeError);
      if (!procurementReady(state.requests.find(value => value.id === command.requestId))) return fail("Procurement is paused until the MRF archive is ready.");
      const pending = state.pendingAwards.filter(value => value.requestId === command.requestId);
      if (!pending.length) return fail("Stage at least one supplier award.");
      const groups = new Map<string, typeof pending>();
      for (const award of pending) {
        const quote = state.quotes.find(value => value.id === award.quoteId);
        if (!quote || !isFinalizedQuote(quote) || hasFinalizedSuccessor(state, quote.id) || quote.currency && quote.currency !== "PHP") return fail("A staged quotation changed. Review the allocations again.");
        if (quote.archive && quote.archive.status !== "complete") return fail("Archive the supplier quotation before generating a PO.");
        const group = groups.get(quote.id) || [];
        group.push(award);
        groups.set(quote.id, group);
      }
      let firstId: string | undefined;
      for (const [quoteId, awards] of groups) {
        const quote = state.quotes.find(value => value.id === quoteId)!;
        if (state.pos.some(value => value.mrfId === command.requestId && value.status !== "rejected" && poSupplierId(state, value) === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO draft instead.");
        const selectionReason = (command.reasons[quote.supplierId] || "").trim();
        const lines: POLine[] = awards.map(award => {
          const offer = quote.lines!.find(value => value.id === award.quoteLineId)!;
          const fullOffer = Math.abs(award.quantity - offer.quantity * offer.conversionFactor) < 0.000001;
          return { itemId: award.itemId, quoteLineId: offer.id, quantity: award.quantity, unitPrice: offer.unitPrice / offer.conversionFactor, discountType: offer.discountType || "none", discountValue: offer.discountType === "fixed" && !fullOffer ? 0 : offer.discountValue || 0, taxRate: offer.taxRate || 0, fixedDiscountConfirmed: offer.discountType !== "fixed" };
        });
        const error = awardError(state, command.requestId, quote, lines, 0, 0, 0, undefined, awards.map(value => value.id));
        if (error) return fail(error);
        const adjustments = (quote.adjustments || [
          ...(quote.tax ? [{ id: id("adjustment"), label: "Tax", kind: "tax" as const, calculation: "fixed" as const, value: quote.tax }] : []),
          ...(quote.freight ? [{ id: id("adjustment"), label: "Freight", kind: "shipping" as const, calculation: "fixed" as const, value: quote.freight }] : []),
          ...(quote.discount ? [{ id: id("adjustment"), label: "Discount", kind: "discount" as const, calculation: "fixed" as const, value: quote.discount }] : []),
        ]).map(value => ({ ...value, included: true, confirmed: false }));
        const poId = id("po");
        state.pos.push({ id: poId, ...issueDocumentReference(state, state.requests.find(value => value.id === command.requestId)!.siteId, "PO", at), mrfId: command.requestId, quoteId, lines, adjustments, status: "draft", priority: "Normal", notes: "", selectionReason, createdAt: at, updatedAt: at });
        initializePo(state.pos[state.pos.length - 1], state.requests.find(value => value.id === command.requestId)!, quote);
        state.pendingAwards = state.pendingAwards.filter(value => !awards.some(award => award.id === value.id));
        firstId ||= poId;
        log(poId, "PO drafted from staged supplier award", selectionReason || undefined);
      }
      state.pendingAwards = state.pendingAwards.filter(value => value.requestId !== command.requestId);
      return done(`${groups.size} supplier PO draft${groups.size === 1 ? "" : "s"} created.`, firstId);
    }
    case "saveReviewedQuote": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to review quotations.");
      const request = state.requests.find(r => r.id === command.requestId);
      if (!procurementReady(request)) return fail("This MRF must be approved and archived before Procurement can continue.");
      if (!state.suppliers.some(s => s.id === command.supplierId)) return fail("Choose a valid supplier.");
      if (!command.ref.trim() || command.currency !== "PHP" || !Array.isArray(command.lines) || !command.lines.length || !command.documents.length || command.documents.some(document => !document.fileId || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.type))) return fail("Add a PHP quotation with its supplier source file and quoted lines.");
      if ([command.tax, command.freight, command.discount].some(value => !nonnegative(value)) || !nonnegative(command.leadDays)) return fail("Enter valid quotation charges and lead time.");
      if (command.lines.some(line => !line.description.trim() || !line.unit.trim() || !positive(line.quantity) || !positive(line.unitPrice) || !positive(line.conversionFactor) || (line.requestItemId && !request.items.some(item => item.id === line.requestItemId)))) return fail("Review each quoted line, quantity, price, and material match.");
      const prior = command.supersedesId ? state.quotes.find(q => q.id === command.supersedesId && q.mrfId === request.id && q.supplierId === command.supplierId) : undefined;
      if (command.supersedesId && !prior) return fail("The earlier quotation version was not found.");
      const current = state.quotes.filter(q => q.mrfId === request.id && q.supplierId === command.supplierId && !state.quotes.some(later => later.supersedesId === q.id));
      if (current.length && (!prior || !current.some(q => q.id === prior.id))) return fail("Choose the current supplier quotation as the revision being replaced.");
      const quoteId = id("quote");
      const codeError = projectCodeRequired(state, request.siteId);
      if (codeError) return fail(codeError);
      const documents = freezeUploadNames(state, request.siteId, request.ref, command.documents, [], at, quoteId);
      state.quotes.push({ id: quoteId, mrfId: request.id, supplierId: command.supplierId, ref: command.ref.trim(), prices: {}, available: command.available.trim(), leadDays: command.leadDays, terms: command.terms.trim(), documents, archive: { status: "pending", files: [] }, reviewStatus: "finalized", lines: command.lines.map(line => ({ ...line, id: line.id || id("offer"), description: line.description.trim(), unit: line.unit.trim(), brand: line.brand.trim(), specification: line.specification.trim(), varianceReason: line.varianceReason.trim() })), version: (prior?.version || 0) + 1, supersedesId: prior?.id, currency: "PHP", tax: command.tax, freight: command.freight, discount: command.discount, validity: command.validity.trim(), extraction: command.extraction });
      log(quoteId, "Supplier quotation reviewed");
      return done("Quotation saved for comparison.", quoteId);
    }
    case "createAwardPO": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to prepare a PO.");
      const quote = state.quotes.find(q => q.id === command.quoteId);
      if (!quote) return fail("Choose a reviewed quotation.");
      const error = awardError(state, command.requestId, quote, command.lines, command.tax, command.freight, command.discount);
      if (error) return fail(error);
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.");
      const codeError = projectCodeRequired(state, state.requests.find(value => value.id === command.requestId)!.siteId);
      if (codeError) return fail(codeError);
      const poId = id("po");
      state.pos.push({ id: poId, ...issueDocumentReference(state, state.requests.find(value => value.id === command.requestId)!.siteId, "PO", at), mrfId: command.requestId, quoteId: quote.id, lines: command.lines, tax: command.tax, freight: command.freight, discount: command.discount, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
      initializePo(state.pos[state.pos.length - 1], state.requests.find(value => value.id === command.requestId)!, quote!);
      log(poId, "PO drafted from awarded quotation", command.reason);
      return done("PO draft created.", poId);
    }
    case "createPO": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to prepare a PO.");
      const request = state.requests.find(r => r.id === command.requestId);
      const quote = state.quotes.find(q => q.id === command.quoteId && q.mrfId === request?.id);
      if (!procurementReady(request) || !quote) return fail("Choose a quote for an archived approved MRF.");
      if (!isFinalizedQuote(quote) || quote.currency && quote.currency !== "PHP") return fail("Only finalized PHP quotations can be awarded.");
      if (quote.archive && quote.archive.status !== "complete") return fail("Archive the supplier quotation before creating a PO.");
      if (state.pos.some(p => p.mrfId === request.id && p.status !== "rejected")) return fail("Use the material award flow to create another PO for this MRF.");
      if (state.pendingAwards.some(value => value.requestId === request.id)) return fail("Use Compare & award to create POs from saved supplier awards.");
      if (request.items.some(item => suitabilityQuantityFor(state, request.id, item.id) > 0) || transfersForRequest(state, request.id).some(value => value.status === "pending" || value.status === "approved")) return fail("Use Compare & award to purchase only the quantities remaining after stock transfers.");
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.", "reason");
      const codeError = projectCodeRequired(state, state.requests.find(value => value.id === command.requestId)!.siteId);
      if (codeError) return fail(codeError);
      const poId = id("po");
      state.pos.push({ id: poId, ...issueDocumentReference(state, state.requests.find(value => value.id === command.requestId)!.siteId, "PO", at), mrfId: request.id, quoteId: quote.id, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
      initializePo(state.pos[state.pos.length - 1], request, quote);
      log(poId, "PO drafted", command.reason);
      return done("PO draft created.", poId);
    }
    case "savePO": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to edit a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["draft", "returned"].includes(po.status)) return fail("This PO is locked for editing.");
      if (!procurementReady(state.requests.find(value => value.id === po.mrfId))) return fail("Procurement is paused until the MRF archive is ready.");
      const quote = state.quotes.find(q => q.id === command.quoteId && q.mrfId === po.mrfId);
      if (!quote) return fail("Choose a quote linked to this MRF.");
      if (state.pos.some(value => value.id !== po.id && value.mrfId === po.mrfId && value.status !== "rejected" && poSupplierId(state, value) === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO instead.");
      if (po.lines) {
        const lines = command.lines || po.lines;
        const tax = command.tax ?? po.tax ?? 0, freight = command.freight ?? po.freight ?? 0, discount = command.discount ?? po.discount ?? 0;
        const error = (po.accountingEdited || !!po.approvalHistory?.length) && command.quoteId === po.quoteId ? directPoError(state, po, lines, poSupplierId(state, po) || "") : awardError(state, po.mrfId, quote, lines, tax, freight, discount, po.id);
        if (error) return fail(error);
        if (lines.some(line => !nonnegative(line.discountValue ?? 0) || !nonnegative(line.taxRate ?? 0) || line.discountType === "percentage" && (line.discountValue || 0) > 100 || line.discountType === "fixed" && (line.discountValue || 0) > line.quantity * line.unitPrice)) return fail("Review PO line discounts and tax rates.");
        po.lines = lines; po.tax = tax; po.freight = freight; po.discount = discount;
        if (command.adjustments) {
          if (command.adjustments.some(value => !value.label.trim() || !nonnegative(value.value) || value.calculation === "percentage" && value.value > 100)) return fail("Review each PO adjustment amount.");
          po.adjustments = command.adjustments;
        }
        po.selectionReason = (command.reason ?? po.selectionReason).trim();
      }
      if (po.financial) {
        if (command.document) po.document = command.document;
        if (command.financial) {
          const manualValues = (financial: NonNullable<PO["financial"]>) => [financial.ewtMode, financial.ewtGoodsManual !== false, financial.ewtServicesManual !== false, financial.ewtGoodsManual !== false ? financial.ewtGoods : null, financial.ewtServicesManual !== false ? financial.ewtServices : null];
          if (command.financial.ewtMode === "manual" && JSON.stringify(manualValues(command.financial)) !== JSON.stringify(manualValues(po.financial))) return fail("Only Accounting can override EWT.");
          if (!command.financial.ewtMode && (command.financial.ewtGoods !== po.financial.ewtGoods || command.financial.ewtServices !== po.financial.ewtServices)) return fail("Only Accounting can override EWT.");
          if (!command.financial.ewtMode && po.financial.ewtMode) return fail("Choose calculated EWT for this purchase order.");
          po.financial = command.financial;
        }
        const rawFinancialError = poFinancialError(po);
        if (rawFinancialError) return fail(rawFinancialError);
        po.financial = calculatedPoFinancial(po);
        const financialError = poFinancialError(po, false);
        if (financialError) return fail(financialError);
      }
      if (command.finalize) {
        if (po.lines?.some(line => line.discountType === "fixed" && line.fixedDiscountConfirmed !== true)) return fail("Confirm each fixed line discount before Accounting review.");
        if (po.adjustments?.some(value => !value.confirmed)) return fail("Confirm or exclude every PO adjustment before Accounting review.");
        if (hasFinalizedSuccessor(state, quote.id) && !reasonOK(command.supersededReason)) return fail("A newer quotation exists. Switch to it or explain why this PO keeps the older revision.");
        if (poTotal(state, po) <= 0) return fail("PO total must be positive.");
      }
      po.supersededReason = hasFinalizedSuccessor(state, quote.id) ? command.supersededReason?.trim() : undefined;
      if (command.quoteId !== po.quoteId) { po.supplierId = undefined; po.accountingEdited = undefined; }
      po.quoteId = command.quoteId; po.notes = command.notes.trim(); po.updatedAt = at;
      if (command.finalize) { po.status = "submitted"; po.reviewReason = undefined; log(po.id, "PO submitted to Accounting", po.supersededReason); return done("PO submitted. Accounting review is next."); }
      log(po.id, "PO draft updated"); return done("PO draft saved.");
    }
    case "saveAccountingPO": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to review PO finances.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || !["submitted", "hold"].includes(po.status)) return fail("This PO is locked for financial review.");
      const request = requestForPO(state, po), quote = state.quotes.find(value => value.id === po.quoteId);
      if (!request || !quote) return fail("The linked purchasing records are missing.");
      if (!po.document || !po.financial) {
        const document = po.document, financial = po.financial;
        initializePo(po, request, quote);
        if (document) po.document = document;
        if (financial) po.financial = financial;
      }
      if (!["upfront", "credit"].includes(command.paymentMode || "")) return fail("Select upfront payment or credit terms.");
      if (!command.financial) return fail("Review VAT and withholding.");
      if (command.lines || command.supplierId) {
        const lines = command.lines || po.lines || [];
        const supplierId = command.supplierId || poSupplierId(state, po) || "";
        const lineError = directPoError(state, po, lines, supplierId);
        if (lineError) return fail(lineError);
        po.lines = lines; po.supplierId = supplierId; po.accountingEdited = true;
      }
      if (command.document) po.document = command.document;
      if (command.notes !== undefined) po.notes = command.notes.trim();
      if (command.adjustments && command.adjustments.some(value => !value.label.trim() || !nonnegative(value.value) || value.calculation === "percentage" && value.value > 100)) return fail("Review each PO adjustment amount.");
      if (command.paymentDueDate && !validPaymentDate(command.paymentDueDate)) return fail("Enter a valid payment due date.");
      po.paymentDueDate = command.paymentMode === "credit" ? command.paymentDueDate || po.paymentDueDate : undefined;
      if (command.paymentMode !== "credit") po.externalCredit = undefined;
      po.financial = command.financial; po.paymentMode = command.paymentMode;
      if (command.adjustments) po.adjustments = command.adjustments;
      for (const key of ["tax", "freight", "discount"] as const) if (command[key] !== undefined) { if (!nonnegative(command[key]!)) return fail("PO charges must be nonnegative."); po[key] = command[key]; }
      const rawFinancialError = poFinancialError(po);
      if (rawFinancialError) return fail(rawFinancialError);
      po.financial = calculatedPoFinancial(po);
      const error = poFinancialError(po);
      if (error || poTotal(state, po) <= 0) return fail(error || "PO total must be positive.");
      po.updatedAt = at; log(po.id, "Accounting PO review saved"); return done("PO review saved.");
    }
    case "setPriority": {
      if (!permit("Finance")) return fail("Sign in as Finance to set payment priority.");
      const payment = state.paymentRequests.find(value => value.id === command.id);
      if (payment && isExternalPayment(state.pos.find(po => po.id === payment.poId)!)) return fail("This PO uses external payment verification by Accounting.");
      if (!payment || !["submitted", "hold", "approved"].includes(payment.status)) return fail("This payment request is not in Finance review.");
      payment.priority = command.priority; payment.updatedAt = at; return done("Payment priority updated.");
    }
    case "reviewPO": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to review a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || !["submitted", "hold"].includes(po.status)) return fail("This PO is not awaiting Accounting review.");
      if (command.decision === "approve") {
        const request = requestForPO(state, po);
        if (!request || !procurementReady(request)) return fail("The linked MRF archive must be ready.");
        if (po.accountingEdited || po.approvalHistory?.length) {
          const directError = directPoError(state, po, po.lines || [], poSupplierId(state, po) || "");
          if (directError) return fail(directError);
        }
        if (po.lines?.some(line => line.discountType === "fixed" && line.fixedDiscountConfirmed !== true)) return fail("Confirm each fixed line discount before approval.");
        if (!["upfront", "credit"].includes(po.paymentMode || "")) return fail("Confirm upfront payment or credit terms before approval.");
        const error = poFinancialError(po, true);
        if (error) return fail(error);
        if (!po.financial || !po.document) return fail("Complete the PO financial and document review.");
        if (po.adjustments?.some(value => !value.confirmed)) return fail("Confirm or exclude every PO adjustment.");
        const scopeError = scopeValidationError(state, request.siteId, request.scopeId);
        if (scopeError) return fail(scopeError, "scopeId");
        if (poTotal(state, po) > scopeBudgetFor(state, request.scopeId!).available) return fail("This PO exceeds the available scope budget.");
        if (poTotal(state, po) <= 0 || poTotal(state, po) > budgetFor(state, request.siteId).available) return fail("This PO exceeds the available project budget or has an invalid total.");
        if (po.workflow === "pm-external-v1" && po.paymentMode === "credit") {
          if (!po.paymentDueDate || !validPaymentDate(po.paymentDueDate)) return fail("Enter the agreed payment due date before approving credit terms.", "paymentDueDate");
          po.externalCredit = true;
        }
        const project = state.sites.find(value => value.id === request.siteId)!;
        if (project.documentCode) { po.archiveRef = prefixedReference(project.documentCode, po.ref); lockProjectCode(project, at); }
        po.status = "approved"; po.reviewReason = undefined; po.updatedAt = at; po.reviewedAt = at; po.reviewedBy = actor; po.reviewedByIdentity = copyIdentity(identity); po.archive = { status: "pending" };
        log(po.id, "PO approved by Accounting; budget committed"); return done("PO approved. Archive its PDF before release to Logistics.");
      }
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      po.status = command.decision === "hold" ? "hold" : command.decision === "return" ? "returned" : "rejected";
      po.reviewReason = command.reason!.trim(); po.updatedAt = at;
      log(po.id, `Accounting ${po.status}`, po.reviewReason); return done(`PO ${po.status}.`);
    }
    case "issuePO": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to issue the PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || !isExternalPayment(po) || po.status !== "approved" || po.issuance) return fail("This PO is not available for supplier issuance.");
      if (!procurementReady(requestForPO(state, po)) || po.archive?.status !== "complete" || !po.archive.url) return fail("Complete the current MRF and approved PO archives before issuance.");
      if (!identity) return fail("A named Procurement account is required.");
      po.issuance = { at, by: identity }; po.updatedAt = at;
      log(po.id, "PO issued to supplier; marked Served"); return done("PO Served. Accounting can verify external payment.");
    }
    case "reopenPOReview": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to revise this PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || !isExternalPayment(po) || po.status !== "approved" || po.issuance || !reasonOK(command.reason)) return fail("Only an unissued approved PO can return for recheck, with a reason.");
      po.approvalHistory = [...(po.approvalHistory || []), { at: po.reviewedAt, by: po.reviewedByIdentity, archive: po.archive, reason: command.reason.trim() }];
      po.status = "returned"; po.reviewReason = command.reason.trim(); po.reviewedAt = undefined; po.reviewedBy = undefined; po.reviewedByIdentity = undefined; po.archive = undefined; po.updatedAt = at;
      if (po.financial) po.financial.reviewed = false;
      log(po.id, "PO reopened for Accounting recheck", command.reason); return done("Revise the PO and resubmit it to Accounting.");
    }
    case "attachPaymentProofs": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to attach payment proof.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !canAttachPaymentProof(po)) return fail("Attach proof after supplier issuance and before payment verification.");
      const documents = po.paymentProofs || [];
      const pending = isExternalCredit(po) ? documents.filter(proof => !proofAssigned(po, proof.id)) : documents;
      if (!command.documents.length || command.documents.length + pending.length > 12 || command.documents.some(value => !validAccountingDocument({ ...value, kind: "Payment receipt" })) || [...pending, ...command.documents].reduce((n, value) => n + value.size, 0) > MAX_ACCOUNTING_BATCH) return fail("Use up to 12 PDF/image proof files, 20 MB each and 45 MB total.");
      if (new Set([...documents, ...command.documents].map(value => value.localFileId)).size !== documents.length + command.documents.length) return fail("This proof file is already attached.");
      if (isExternalCredit(po) && (command.documents.some(value => documents.some(proof => proof.sha256 === value.sha256)) || new Set(command.documents.map(value => value.sha256)).size !== command.documents.length)) return fail("This proof content is already attached. Use a distinct proof for each payment.");
      const project = state.sites.find(value => value.id === state.requests.find(request => request.id === po.mrfId)!.siteId)!;
      const codeError = projectCodeRequired(state, project.id); if (codeError) return fail(codeError);
      lockProjectCode(project, at);
      po.paymentProofs = [...documents, ...command.documents.map(value => { const proofId = id("proof"); return ({ ...value, id: proofId, archiveName: archiveFileName(prefixedReference(project.documentCode!, po.ref), value.name, proofId), uploadedAt: at, uploadedBy: actor, uploadedByIdentity: identity, archive: { status: "pending" as const } }); })];
      log(po.id, "Payment proof attached"); return done("Proof attached. Archive it before verification.");
    }
    case "removePaymentProof": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to remove proof.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !canAttachPaymentProof(po) || proofAssigned(po, command.documentId) || !po.paymentProofs?.some(value => value.id === command.documentId)) return fail("Reopen verification before changing its proof; cleared payments are locked.");
      po.paymentProofs = po.paymentProofs.filter(value => value.id !== command.documentId);
      log(po.id, "Payment proof removed"); return done("Proof removed. Archived copies and verification history are retained.");
    }
    case "completePaymentProofArchive":
    case "failPaymentProofArchive": {
      if (!permit("Accounting", "Administrator")) return fail("Sign in as Accounting to archive proof.");
      const po = state.pos.find(value => value.id === command.poId), proof = po?.paymentProofs?.find(value => value.id === command.documentId);
      if (command.type === "completePaymentProofArchive" && proof?.archive.status === "complete" && proof.archive.fileId === command.fileId && proof.archive.url === command.url) return done("Payment proof already archived.");
      if (!po || !isExternalPayment(po) || !proof || proof.archive.status !== "pending") return fail("This proof has no pending archive.");
      if (command.type === "completePaymentProofArchive") {
        if (!validArchiveFileLink(state, command.url, command.fileId)) return fail("The proof archive link is invalid.");
        proof.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(po.id, "Payment proof archived"); return done("Payment proof archived.");
      }
      proof.archive.error = command.error.slice(0, 300); log(po.id, "Payment proof archive failed", command.error); return done("Proof archive needs retry.");
    }
    case "recordCreditPayment": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to verify credit payments.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !isExternalCredit(po) || !canAttachPaymentProof(po) || !identity) return fail("Supplier issuance is required before credit payment verification.");
      if (!procurementReady(requestForPO(state, po)) || po.archive?.status !== "complete") return fail("Complete current purchasing archives before verification.");
      if (!command.paymentId?.trim() || po.creditPayments?.some(value => value.id === command.paymentId)) return fail("This payment has already been recorded or has an invalid ID.");
      if (!positive(command.amount) || !close(command.amount, roundMoney(command.amount)) || command.amount > roundMoney(poTotal(state, po) - paidTotal(state, po.id))) return fail("Enter a positive payment within the unpaid balance, with up to two decimal places.", "amount");
      if (!["Bank", "Cash", "Check", "Other"].includes(command.method) || !command.reference.trim() || !validPaymentDate(command.date) || command.date > philippineDate(new Date(at))) return fail("Enter a valid method, reference and actual payment date.");
      if (po.creditPayments?.some(value => !value.voided && value.reference.toLowerCase() === command.reference.trim().toLowerCase())) return fail("This payment reference is already recorded for the PO.");
      const proofs = command.proofIds.map(proofId => po.paymentProofs?.find(proof => proof.id === proofId));
      if (!proofs.length || new Set(command.proofIds).size !== proofs.length || proofs.some(proof => !proof || !archivedProof(proof) || proofAssigned(po, proof.id))) return fail("Select unused archived proof for this payment.");
      po.creditPayments = [...(po.creditPayments || []), { id: command.paymentId, amount: roundMoney(command.amount), method: command.method, reference: command.reference.trim(), date: command.date, verifiedAt: at, verifiedBy: identity, proofs: structuredClone(proofs.filter((proof): proof is PaymentProof => !!proof)) }];
      resetCoordination(po, at, identity, coordinationBalance(state, po) > 0 ? "Accounting verified a credit payment; remaining balance requires a new plan" : "Accounting verified full credit payment", coordinationBalance(state, po) === 0);
      po.updatedAt = at; log(po.id, `External credit payment verified: ${command.amount}`, command.reference);
      return done("Payment verified. Delivery status is unchanged.", command.paymentId);
    }
    case "voidCreditPayment": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to correct credit payments.");
      const po = state.pos.find(value => value.id === command.poId), payment = po?.creditPayments?.find(value => value.id === command.paymentId);
      if (!po || !isExternalCredit(po) || !["approved", "released"].includes(po.status) || !payment || payment.voided || !identity || !reasonOK(command.reason)) return fail("Choose a recorded payment and enter a correction reason of at least five characters.");
      payment.voided = { at, by: identity, reason: command.reason.trim() }; po.updatedAt = at;
      resetCoordination(po, at, identity, "Accounting voided a payment; Finance follow-up reopened");
      log(po.id, `External credit payment voided: ${payment.amount}`, command.reason);
      return done("Payment voided; history retained and balance restored. Delivery status is unchanged.");
    }
    case "verifyExternalPayment": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to verify full payment.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !isExternalPayment(po) || isExternalCredit(po) || po.status !== "approved" || !po.issuance || po.externalPayment || !identity) return fail("This PO is not awaiting external payment verification.");
      if (!procurementReady(requestForPO(state, po)) || po.archive?.status !== "complete") return fail("Complete current purchasing archives before verification.");
      const proofs = po.paymentProofs?.filter(archivedProof) || [];
      if (!proofs.length) return fail("Attach and archive payment proof before confirming full payment.");
      if (!["Cash", "Bank", "Check", "Other"].includes(command.method) || !command.reference.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(command.date) || Number.isNaN(Date.parse(command.date)) || new Date(command.date).toISOString().slice(0,10) !== command.date) return fail("Enter a valid payment method, reference and date.");
      const amount = poTotal(state, po);
      if (!(amount > 0)) return fail("The PO must have a positive net payable amount.");
      po.externalPayment = { amount, method: command.method, reference: command.reference.trim(), date: command.date, verifiedAt: at, verifiedBy: identity, proofs: structuredClone(proofs) }; po.updatedAt = at;
      resetCoordination(po, at, identity, "Accounting verified full payment; coordination settled", true);
      log(po.id, "Full external payment verified by Accounting"); return done("Full payment verified. Confirm delivery clearance separately.");
    }
    case "reopenPaymentVerification": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to reopen verification.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || !isExternalPayment(po) || isExternalCredit(po) || po.status !== "approved" || !po.externalPayment || !identity || !reasonOK(command.reason)) return fail("Only verified payments before delivery clearance can reopen, with a reason.");
      po.verificationHistory = [...(po.verificationHistory || []), { ...structuredClone(po.externalPayment), reopenedAt: at, reopenedBy: identity, reason: command.reason.trim() }];
      po.externalPayment = undefined; po.updatedAt = at;
      resetCoordination(po, at, identity, "Accounting reopened verification; Finance follow-up reopened");
      log(po.id, "External payment verification reopened", command.reason); return done("Correct the proof or payment details, then verify full payment again.");
    }
    case "savePaymentRequest": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to prepare a payment request.");
      const po = state.pos.find(value => value.id === command.poId && ["approved", "released"].includes(value.status));
      if (!po) return fail("Accounting must approve the PO before requesting payment.");
      if (isExternalPayment(po)) return fail("This PO uses external payment verification by Accounting.");
      const existing = command.id ? state.paymentRequests.find(value => value.id === command.id && value.poId === po.id) : undefined;
      if ((command.id && !existing) || (existing && !["draft", "returned"].includes(existing.status))) return fail("This payment request is locked for editing.");
      const open = openPaymentRequest(state, po.id);
      if (open && open.id !== existing?.id) return fail("Complete the open payment request before creating another.");
      if (!positive(command.amount) || !close(command.amount, Math.round(command.amount * 100) / 100) || command.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("Request a positive amount within the unpaid PO balance.", "amount");
      if (!existing) { const error = projectCodeRequired(state, state.requests.find(value => value.id === po.mrfId)!.siteId); if (error) return fail(error); }
      const payment = existing || { id: id("payment-request"), ...issueDocumentReference(state, state.requests.find(value => value.id === po.mrfId)!.siteId, "PAY", at), poId: po.id, amount: command.amount, note: "", status: "draft" as const, priority: po.priority, createdAt: at, updatedAt: at, createdBy: actor, createdByIdentity: copyIdentity(identity) };
      Object.assign(payment, { amount: command.amount, note: command.note.trim(), status: command.submit ? "submitted" : "draft", reason: undefined, updatedAt: at, reviewedAt: undefined, reviewedBy: undefined });
      if (!existing) state.paymentRequests.push(payment);
      log(payment.id, command.submit ? "Payment request submitted to Finance" : "Payment request draft saved", payment.ref); return done(command.submit ? "Payment request sent to Finance." : "Payment request draft saved.", payment.id);
    }
    case "reviewPaymentRequest": {
      if (!permit("Finance")) return fail("Sign in as Finance to review payment requests.");
      const payment = state.paymentRequests.find(value => value.id === command.id && ["submitted", "hold"].includes(value.status));
      if (!payment) return fail("This payment request is not awaiting Finance review.");
      const po = state.pos.find(value => value.id === payment.poId && ["approved", "released"].includes(value.status));
      if (isExternalPayment(po)) return fail("This PO uses external payment verification by Accounting.");
      if (!po || payment.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("This payment request exceeds the current unpaid balance.");
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      payment.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : command.decision === "hold" ? "hold" : "rejected";
      payment.reason = command.decision === "approve" ? undefined : command.reason!.trim(); payment.updatedAt = at; payment.reviewedAt = at; payment.reviewedBy = actor; payment.reviewedByIdentity = copyIdentity(identity);
      log(payment.id, `Finance payment request ${payment.status}`, payment.reason); return done(`Payment request ${payment.status}.`);
    }
    case "completePOArchive": {
      if (!permit("Accounting", "Administrator")) return fail("Sign in as Accounting or Administrator to archive a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (po?.archive?.status === "complete" && po.archive.fileId === command.fileId && po.archive.url === command.url) return done("PO already archived.");
      if (!po || po.status !== "approved" || po.archive?.status !== "pending" || !command.fileId || !command.url) return fail("This PO is not awaiting a Drive archive.");
      po.archive = { status: "complete", fileId: command.fileId, url: command.url };
      log(po.id, "Purchase order archived");
      return done("Purchase order archived.");
    }
    case "failPOArchive": {
      if (!permit("Accounting", "Administrator")) return fail("Sign in as Accounting or Administrator to update a PO archive.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || po.archive?.status !== "pending") return fail("This PO is not awaiting a Drive archive.");
      po.archive.error = command.error.slice(0, 300);
      log(po.id, "Drive archive failed", command.error);
      return done("PO archive pending. Retry the upload.");
    }
    case "releasePO": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to release a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po) return fail("Purchase order not found.");
      const error = releaseBlocker(state, po);
      if (error) return fail(error);
      po.status = "released"; po.updatedAt = at; po.releasedAt = at; po.releasedBy = actor; po.releasedByIdentity = copyIdentity(identity);
      log(po.id, "PO released to Logistics"); return done("PO released. Logistics can schedule delivery.");
    }
    case "createBatch": {
      if (!permit("Logistics")) return fail("Sign in as Logistics to schedule a delivery.");
      const po = state.pos.find(value => value.id === command.poId);
      if (!po || po.status !== "released") return fail("Only a released PO can receive a delivery batch.");
      const request = requestForPO(state, po), leg = command.leg || "supplier-site";
      if (!request || !DELIVERY_LEGS.includes(leg)) return fail("Choose a supported delivery route.");
      if (!validRequestDate(command.scheduledDate) || !command.evidence.trim()) return fail("Enter a valid schedule and evidence reference.");
      const parent = state.batches.find(batch => batch.id === command.parentBatchId);
      if (leg === "warehouse-site" && (!parent || parent.poId !== po.id || legFor(parent) !== "supplier-warehouse" || parent.status !== "confirmed" || !parent.destination)) return fail("Choose a confirmed warehouse receipt for this PO.");
      if (leg !== "warehouse-site" && command.parentBatchId) return fail("Only onward warehouse deliveries can have a parent receipt.");
      const locations = deliveryLocations(state, po);
      const destination = command.destination || (leg === "supplier-warehouse" ? undefined : locations.destination);
      if (!destination || !destination.name?.trim() || !destination.address?.trim()) return fail("Enter the delivery destination name and address.", "destination");
      const lines = poItems(state, po).map(item => ({ itemId: item.id, expected: command.expected[item.id] ?? 0, accepted: 0, issue: "" })).filter(line => line.expected !== 0);
      const limit = (itemId: string) => leg === "warehouse-site" ? warehouseAvailableFor(state, parent!.id, itemId) : schedulableFor(state, po, itemId);
      if (!lines.length || lines.some(line => !nonnegative(line.expected) || line.expected > limit(line.itemId))) return fail("Expected quantities must fit the available supplier or warehouse balance.", "expected");
      const codeError = projectCodeRequired(state, state.requests.find(value => value.id === po.mrfId)!.siteId);
      if (codeError) return fail(codeError);
      const batchId = id("batch");
      state.batches.push({ id: batchId, ...issueDocumentReference(state, state.requests.find(value => value.id === po.mrfId)!.siteId, "DEL", at), poId: po.id, leg, parentBatchId: parent?.id, origin: structuredClone(leg === "warehouse-site" ? parent!.destination! : locations.origin), destination: { name: destination.name.trim(), address: destination.address.trim() }, scheduledDate: command.scheduledDate, evidence: command.evidence.trim(), delayReason: command.delayReason.trim(), lines, status: "expected", createdAt: at, updatedAt: at, createdByIdentity: copyIdentity(identity) });
      reopenDocumentReview(po.id, "New delivery scheduled");
      log(batchId, leg === "warehouse-site" ? "Warehouse onward delivery scheduled" : "Delivery batch scheduled", command.delayReason);
      return done("Delivery scheduled. Logistics records dispatch when it leaves.", batchId);
    }
    case "dispatchBatch": {
      if (!permit("Logistics")) return fail("Sign in as Logistics to dispatch a delivery.");
      const batch = state.batches.find(value => value.id === command.id), po = state.pos.find(value => value.id === batch?.poId);
      if (!batch || batch.status !== "expected" || !po || po.status !== "released") return fail("This batch is not awaiting dispatch.");
      if (batch.lines.some(line => line.expected > batchQuantityLimit(state, po, batch, line.itemId))) return fail("The delivery allocation is no longer available.");
      batch.status = "dispatched"; batch.dispatchedAt = at; batch.updatedAt = at; batch.dispatchedByIdentity = copyIdentity(identity);
      log(batch.id, "Delivery dispatched");
      return done("Delivery is in transit.");
    }
    case "confirmBatch": {
      const batch = state.batches.find(value => value.id === command.id), po = state.pos.find(value => value.id === batch?.poId);
      if (!batch || !po || po.status !== "released" || !(batch.status === "dispatched" || !batch.leg && batch.status === "expected")) return fail("Dispatch this batch before confirming receipt.");
      const warehouse = !isSiteBatch(batch);
      if (!permit(warehouse ? "Procurement" : "Site Personnel")) return fail(warehouse ? "Sign in as Procurement to confirm warehouse receiving." : "Sign in as Site Personnel to confirm receiving.");
      for (const line of batch.lines) {
        const input = command.lines[line.itemId];
        if (!input || !nonnegative(input.accepted) || input.accepted > batchQuantityLimit(state, po, batch, line.itemId)) return fail("Accepted quantity exceeds this batch or its available allocation.");
        if (input.accepted < line.expected && !input.issue.trim()) return fail("Describe any shortage or damage before confirming.", "issue");
        line.accepted = input.accepted; line.issue = input.issue.trim();
      }
      batch.status = "confirmed"; batch.receivedAt = at; batch.updatedAt = at; batch.receivedByIdentity = copyIdentity(identity);
      (batch.receiptVersions ||= []).push(deliveryReceiptVersion(state, batch, id("delivery-receipt"), at));
      reopenDocumentReview(po.id, "Delivery quantities confirmed");
      log(batch.id, warehouse ? "Company warehouse receipt confirmed" : "Site received quantities confirmed");
      return done(warehouse ? "Warehouse quantities confirmed. Logistics can schedule onward deliveries." : "Quantities confirmed. Review the posting preview.");
    }
    case "postBatch": {
      if (!permit("Site Personnel")) return fail("Sign in as Site Personnel to post site stock.");
      const batch = state.batches.find(value => value.id === command.id), po = state.pos.find(value => value.id === batch?.poId), request = po && requestForPO(state, po);
      if (!batch || !isSiteBatch(batch) || batch.status !== "confirmed" || !po || !request || state.movements.some(m => m.batchId === batch.id && m.kind === "receipt")) return fail("This batch cannot be posted again or is not a site receipt.");
      const changed = batch.lines.some(line => command.accepted[line.itemId] !== line.accepted);
      if (changed && !reasonOK(command.reason)) return fail("Explain changes to accepted quantities before posting.", "reason");
      for (const line of batch.lines) {
        const amount = command.accepted[line.itemId];
        if (!nonnegative(amount) || amount > batchQuantityLimit(state, po, batch, line.itemId)) return fail("Posting quantity exceeds the batch or its available allocation.");
        line.accepted = amount;
        if (amount < line.expected && !line.issue) line.issue = command.reason.trim();
      }
      batch.status = "posted"; batch.updatedAt = at; batch.postingReason = command.reason.trim() || undefined; batch.postedAt = at; batch.postedByIdentity = copyIdentity(identity);
      for (const line of batch.lines) {
        if (line.accepted <= 0) continue;
        const item = request.items.find(value => value.id === line.itemId)!;
        state.movements.push({ id: id("movement"), siteId: request.siteId, itemName: item.name, unit: item.unit, quantity: line.accepted, kind: "receipt", reason: `Posted ${batch.ref}${command.reason.trim() ? " - " + command.reason.trim() : ""}`, batchId: batch.id, actor, actorIdentity: copyIdentity(identity), at });
      }
      if (changed) { (batch.receiptVersions ||= []).push(deliveryReceiptVersion(state, batch, id("delivery-receipt"), at)); reopenDocumentReview(po.id, "Accepted delivery quantities corrected"); }
      log(batch.id, "Accepted stock posted", command.reason);
      return done("Accepted quantities posted to site stock.");
    }
    case "recordMovement": {
      if (!["usage", "adjustment"].includes(command.kind)) return fail("Use receiving or dispatch to record transfer movements.");
      if (command.kind === "usage" && !permit("Site Personnel")) return fail("Sign in as Site Personnel to record usage.");
      if (command.kind === "adjustment" && !permit("Site Personnel", "Accounting")) return fail("This role cannot correct stock.");
      if (!state.sites.some(s => s.id === command.siteId) || !inventoryFor(state, command.siteId).some(item => item.name.toLowerCase() === command.itemName.trim().toLowerCase() && item.unit.toLowerCase() === command.unit.trim().toLowerCase())) return fail("Choose an existing site material.");
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      if (!Number.isFinite(command.quantity) || command.quantity === 0 || (command.kind === "usage" && command.quantity < 0)) return fail("Enter a valid nonzero quantity.", "quantity");
      const signed = command.kind === "usage" ? -command.quantity : command.quantity;
      if (stockFor(state, command.siteId, command.itemName, command.unit) + signed < 0) return fail("This movement would create negative stock.", "quantity");
      if (signed < 0 && -signed > sourceStockAvailable(state, command.siteId, command.itemName, command.unit) + .000001) return fail("This stock is reserved for a transfer. Cancel or reduce the transfer before consuming it.", "quantity");
      const movementId = id("movement");
      state.movements.push({ id: movementId, siteId: command.siteId, itemName: command.itemName, unit: command.unit, quantity: signed, kind: command.kind, reason: command.reason.trim(), actor, actorIdentity: copyIdentity(identity), at });
      log(movementId, `${command.kind} recorded`, command.reason);
      return done(`${command.kind === "usage" ? "Usage" : "Adjustment"} recorded.`, movementId);
    }
    case "attachAccountingDocuments": {
      if (!canAttachDelivery(state, command.poId, command.batchId, actor)) return fail("Upload documents as Accounting, or as the receiving department for a confirmed delivery.");
      const batch = state.batches.find(value => value.id === command.batchId);
      const po = state.pos.find(value => value.id === command.poId)!;
      if (command.documents.some(value => value.kind === "Signed delivery receipt") && !batch) return fail("Link signed delivery receipts to a confirmed delivery batch.");
      let record = state.accounting.find(value => value.poId === command.poId);
      const existing = (record?.documents || []).filter(value => value.batchId === command.batchId);
      if (!command.documents.length || command.documents.some(value => !validAccountingDocument(value)) || existing.length + command.documents.length > 12 || [...existing, ...command.documents].reduce((total, value) => total + value.size, 0) > MAX_ACCOUNTING_BATCH) return fail("Use up to 12 PDF or image files, at most 20 MB each and 45 MB per batch.");
      const fileIds = [...(record?.documents || []).map(value => value.localFileId), ...command.documents.map(value => value.localFileId)];
      if (new Set(fileIds).size !== fileIds.length) return fail("This document is already attached.");
      const project = state.sites.find(value => value.id === state.requests.find(request => request.id === po.mrfId)!.siteId)!;
      const codeError = projectCodeRequired(state, project.id); if (codeError) return fail(codeError);
      lockProjectCode(project, at);
      if (!record) { record = { poId: po.id, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "", documents: [] }; state.accounting.push(record); }
      record.documents = [...(record.documents || []), ...command.documents.map(value => { const documentId = id("account-doc"); return ({ ...value, id: documentId, archiveName: archiveFileName(prefixedReference(project.documentCode!, batch?.ref || po.ref), value.name, documentId), batchId: command.batchId, receiptVersion: value.kind === "Signed delivery receipt" ? batch?.receiptVersions?.at(-1)?.version : undefined, uploadedAt: at, uploadedBy: actor, uploadedByIdentity: copyIdentity(identity), archive: { status: "pending" as const } }); })];
      reopenDocumentReview(po.id, "New evidence attached");
      log(batch?.id || po.id, `Accounting evidence attached for ${batch?.ref || po.ref}`);
      return done("Accounting documents saved. Archiving to Google Drive…");
    }
    case "completeAccountingArchive":
    case "failAccountingArchive": {
      if (!canArchiveAccounting(state, command.poId, command.documentId, actor)) return fail("Archive evidence as Accounting, Administrator, or its receiving department.");
      const document = state.accounting.find(value => value.poId === command.poId)?.documents?.find(value => value.id === command.documentId);
      if (!document) return fail("Accounting document not found.");
      if (document.archive.status === "complete") return done("Accounting document already archived.");
      if (command.type === "completeAccountingArchive") {
        if (!validArchiveFileLink(state, command.url, command.fileId)) return fail("The accounting document archive is invalid.");
        document.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(document.id, "Accounting document archived");
        return done("Accounting document archived.");
      }
      document.archive.error = command.error;
      log(document.id, "Evidence archive failed", command.error);
      return done("Accounting document saved; Drive archive needs retry.");
    }
    case "captureDeliveryReceipt": {
      const batch = state.batches.find(value => value.id === command.id);
      if (!batch || !receivedDelivery(batch) || !permit("Accounting", "Administrator", isSiteBatch(batch) ? "Site Personnel" : "Procurement")) return fail("This confirmed receipt cannot be archived by this department.");
      if (!batch.receiptVersions?.length) { batch.receiptVersions = [deliveryReceiptVersion(state, batch, id("delivery-receipt"), at)]; reopenDocumentReview(batch.poId, "Historical delivery receipt captured"); log(batch.id, "Generated delivery receipt captured"); }
      return done("Generated delivery receipt ready for archive.");
    }
    case "completeDeliveryReceiptArchive":
    case "failDeliveryReceiptArchive": {
      const batch = state.batches.find(value => value.id === command.batchId);
      const receipt = batch?.receiptVersions?.find(value => value.id === command.receiptId);
      if (!batch || !receipt || !permit("Accounting", "Administrator", isSiteBatch(batch) ? "Site Personnel" : "Procurement")) return fail("This receipt archive is not available to this department.");
      if (receipt.archive.status === "complete") return done("Delivery receipt already archived.");
      if (command.type === "completeDeliveryReceiptArchive") {
        if (!validArchiveFileLink(state, command.url, command.fileId)) return fail("Invalid delivery receipt Drive link.");
        receipt.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(batch.id, `Generated delivery receipt v${receipt.version} archived`);
      } else { receipt.archive.error = command.error; log(batch.id, "Delivery receipt archive failed", command.error); }
      return done("Delivery receipt archive status saved.");
    }
    case "classifyAccountingDocument": {
      if (!permit("Accounting")) return fail("Only Accounting can classify existing evidence.");
      const document = state.accounting.find(value => value.poId === command.poId)?.documents?.find(value => value.id === command.documentId);
      if (!document || command.batchId !== document.batchId || !validAccountingDocument({ ...document, kind: command.kind })) return fail("Choose a valid category without changing the document's delivery association.");
      const batch = state.batches.find(value => value.id === document.batchId);
      if (command.kind === "Signed delivery receipt" && (!batch || !receivedDelivery(batch) || !batch.receiptVersions?.length)) return fail("Archive the generated receipt before classifying signed delivery evidence.");
      reopenDocumentReview(command.poId, "Evidence classification changed");
      document.kind = command.kind; document.receiptVersion = command.kind === "Signed delivery receipt" ? batch?.receiptVersions?.at(-1)?.version : undefined;
      log(document.id, "Accounting evidence classified", command.kind);
      return done("Document category updated.");
    }
    case "saveDocuments": {
      if (!permit("Accounting")) return fail("Sign in as Accounting to review documents.");
      if (!state.pos.some(p => p.id === command.poId && ["approved", "released"].includes(p.status))) return fail("This PO is not ready for accounting review.");
      if (command.review === "Complete" && (!command.invoiceRef.trim() || !command.receiptRef.trim())) return fail("Invoice and receipt references are required to complete review.");
      if (command.review === "Complete") { const issues = deliveryDocumentIssues(state, command.poId); if (issues.length) return fail(issues[0]); }
      if (command.review === "Discrepancy" && !reasonOK(command.note)) return fail("Describe the discrepancy.", "note");
      let record = state.accounting.find(a => a.poId === command.poId);
      if (!record) { record = { poId: command.poId, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "" }; state.accounting.push(record); }
      if (record.reviewedAt) (record.reviewHistory ||= []).push({ review: record.review, invoiceRef: record.invoiceRef, receiptRef: record.receiptRef, note: record.note, at: record.reviewedAt, by: record.reviewedBy, reason: "Review updated" });
      record.reviewedAt = at; record.reviewedBy = copyIdentity(identity);
      Object.assign(record, { invoiceRef: command.invoiceRef.trim(), receiptRef: command.receiptRef.trim(), review: command.review, note: command.note.trim() });
      log(command.poId, `Documents marked ${record.review}`, record.note);
      return done("Document review saved.");
    }
    case "recordPayment": {
      if (!permit("Finance")) return fail("Sign in as Finance to record disbursement.");
      const payment = state.paymentRequests.find(value => value.id === command.paymentRequestId && value.status === "approved");
      if (payment && isExternalPayment(state.pos.find(po => po.id === payment.poId)!)) return fail("This PO uses external payment verification by Accounting.");
      if (!payment || state.payments.some(value => value.paymentRequestId === payment.id)) return fail("An approved, undisbursed payment request is required.");
      const po = state.pos.find(value => value.id === payment.poId && ["approved", "released"].includes(value.status));
      if (!po || !positive(payment.amount) || payment.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("Disbursement exceeds the unpaid PO balance.");
      if (!["Bank", "Cash", "Check", "Other"].includes(command.method) || !command.reference.trim() || !validRequestDate(command.date)) return fail("Enter a valid payment method, reference and date.");
      const paymentId = id("payment");
      state.payments.push({ id: paymentId, poId: po.id, paymentRequestId: payment.id, amount: payment.amount, method: command.method, reference: command.reference.trim(), date: command.date, actor, actorIdentity: copyIdentity(identity) });
      payment.status = "disbursed"; payment.disbursedAt = at; payment.updatedAt = at;
      log(paymentId, `Finance disbursement recorded: ${payment.amount}`, command.reference); return done("Disbursement recorded. Accounting can review release eligibility.", paymentId);
    }
    case "completeProjectFolder":
    case "failProjectFolder": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to configure a project folder.");
      const site = state.sites.find(value => value.id === command.siteId);
      if (!site || site.driveFolderId) return fail("This project already has a folder or is unavailable.");
      if (command.type === "completeProjectFolder") {
        if (!command.folderId.trim()) return fail("Choose a valid project folder.");
        site.driveFolderId = command.folderId.trim(); site.driveFolderSetup = { status: "ready" };
        log(site.id, "Google Drive project folder created");
        return done("Project folder ready.");
      }
      site.driveFolderSetup = { status: "pending", error: command.error.trim() || "Folder creation failed. Retry or link an existing folder." };
      log(site.id, "Google Drive project folder creation failed", site.driveFolderSetup.error);
      return done("Project saved. Folder setup pending.");
    }
    case "setProjectDriveFolder": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to map a project folder.");
      const site = state.sites.find(value => value.id === command.siteId);
      if (!site || !command.folderId.trim()) return fail("Choose a valid project folder.");
      if (site.driveFolderId === command.folderId.trim()) return done("This folder is already saved.", site.id);
      site.driveFolderId = command.folderId.trim();
      site.driveFolderSetup = { status: "ready" };
      log(site.id, "Google Drive project folder mapped");
      return done("Project Drive folder saved.");
    }
    case "addSite": {
      if (!permit("Administrator", "Project Manager")) return fail("Sign in as Administrator or Project Manager to add a project.");
      const name = command.name.trim();
      if (!name || !command.location.trim()) return fail("Complete the project name and location.");
      if (!nonnegative(command.budget)) return fail("Enter a valid budget of zero or more.", "budget");
      if (state.sites.some(site => site.name.toLowerCase() === name.toLowerCase())) return fail("Enter a unique project name.", "name");
      const documentCode = normalizeProjectCode(command.documentCode);
      const codeError = projectCodeValidation(state, documentCode);
      if (codeError) return fail(codeError, "documentCode");
      const siteId = id("site");
      state.sites.push({ id: siteId, documentCode, name, location: command.location.trim(), budget: command.budget, personnel: "", driveFolderSetup: { status: "pending" } });
      log(siteId, "Project added");
      return done("Project added. Site Personnel can now create an MRF.", siteId);
    }
    case "addSupplierFromQuote": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to confirm a quotation supplier.");
      const name = command.name.trim();
      if (!name || state.suppliers.some(supplier => supplier.name.toLowerCase() === name.toLowerCase())) return fail("Enter a new supplier name.");
      const supplierId = id("supplier");
      state.suppliers.push({ id: supplierId, name, location: "", contact: "", accreditation: "Pending" });
      log(supplierId, "Supplier added from quotation");
      return done("Supplier added from quotation.", supplierId);
    }
    default: return fail("Unknown command.");
  }
}
