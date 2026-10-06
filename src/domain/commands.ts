import { openPaymentRequest, releaseBlocker } from "./workflow.ts";
import { validAccountingDocument, MAX_ACCOUNTING_BATCH } from "./accounting-documents.ts";
import type { AccountingDocument } from "./types.ts";
import { validDriveFileLink } from "./drive-links.ts";
import { initializePoDocument } from "./po-document.ts";
import { resolveComparisonSelections } from "./comparison-report.ts";
import type { ComparisonSelections } from "./types.ts";
import type { PO, MRF } from "./types.ts";
import { poFinancialError } from "./pricing.ts";
import { newId, nextRef } from "./ids.ts";
import { bidReportReadiness, captureBidReport } from "./bid-reports.ts";
import { acceptedFor, budgetFor, inventoryFor, orderedFor, outstandingFor, paidTotal, poItems, poTotal, requestForPO, schedulableFor, stockFor } from "./selectors.ts";
import { hasFinalizedSuccessor, isFinalizedQuote, latestFinalizedQuotes, quoteReviewIssues } from "./procurement.ts";
import { poLineTotal } from "./pricing.ts";
import { procurementReady, supportingPdf } from "./request-archive.ts";
import { ROLES, type ArchivedQuoteFile, type DemoSnapshot, type DocumentRef, type DocumentStatus, type Item, type POAdjustment, type POLine, type Priority, type Quote, type Role } from "./types.ts";

export type Command =
  | { type: "attachAccountingDocuments"; poId: string; batchId: string; documents: Pick<AccountingDocument, "name" | "kind" | "mime" | "size" | "localFileId" | "sha256">[] }
  | { type: "completeAccountingArchive"; poId: string; documentId: string; fileId: string; url: string }
  | { type: "failAccountingArchive"; poId: string; documentId: string; error: string }
  | { type: "createBidReport"; requestId: string; comparisonSelections?: ComparisonSelections }
  | { type: "saveBidReportFile"; format?: "xlsx" | "pdf"; id: string; localFileId: string; sha256: string }
  | { type: "failBidGeneration"; format?: "xlsx" | "pdf"; id: string; error: string }
  | { type: "completeBidArchive"; format?: "xlsx" | "pdf"; id: string; fileId: string; url: string }
  | { type: "failBidArchive"; format?: "xlsx" | "pdf"; id: string; error: string }
  | { type: "setRole"; role: Role }
  | { type: "setSiteFilter"; siteId: string }
  | { type: "saveRequest"; aiAssisted?: boolean; aiReviewed?: boolean; specialInstructions?: string; signatoryTitles?: string[]; id?: string; intent: "draft" | "submit"; siteId: string; ref: string; requestDate: string; scopeDocument?: DocumentRef; requestedBy: string; approvedBy: string; purchaser: string; financeOfficer: string; items: Item[]; documents: DocumentRef[] }
  | { type: "reviewRequest"; id: string; decision: "approve" | "return" | "reject"; reason?: string }
  | { type: "reopenApprovedRequest"; id: string; reason: string }
  | { type: "completeRequestArchive"; id: string; formFileId: string; supportFileId: string; formUrl: string; supportUrl: string }
  | { type: "failRequestArchive"; id: string; error: string }
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
  | { type: "saveAccountingPO"; id: string; paymentMode: PO["paymentMode"]; financial: PO["financial"]; tax?: number; freight?: number; discount?: number; adjustments?: POAdjustment[] }
  | { type: "savePaymentRequest"; poId: string; id?: string; amount: number; note: string; submit: boolean }
  | { type: "reviewPaymentRequest"; id: string; decision: "approve" | "hold" | "return" | "reject"; reason?: string }
  | { type: "createBatch"; poId: string; scheduledDate: string; evidence: string; delayReason: string; expected: Record<string, number> }
  | { type: "confirmBatch"; id: string; lines: Record<string, { accepted: number; issue: string }> }
  | { type: "postBatch"; id: string; accepted: Record<string, number>; reason: string }
  | { type: "recordMovement"; siteId: string; itemName: string; unit: string; kind: "usage" | "adjustment"; quantity: number; reason: string }
  | { type: "saveDocuments"; poId: string; invoiceRef: string; receiptRef: string; review: DocumentStatus; note: string }
  | { type: "recordPayment"; paymentRequestId: string; method: "Cash" | "Bank" | "Check" | "Other"; reference: string; date: string }
  | { type: "addSite"; name: string; location: string; budget: number }
  | { type: "addSupplierFromQuote"; name: string };

export type CommandContext = { now: () => string; id: (prefix: string) => string };
export type CommandResult = { ok: true; snapshot: DemoSnapshot; recordId?: string; message: string } | { ok: false; message: string; field?: string };
const defaultContext: CommandContext = { now: () => new Date().toISOString(), id: newId };
const fail = (message: string, field?: string): CommandResult => ({ ok: false, message, field });
const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const reasonOK = (s?: string) => (s?.trim().length ?? 0) >= 5;
const close = (left: number, right: number) => Math.abs(left - right) < 0.000001;
const validRequestDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function awardError(state: DemoSnapshot, requestId: string, quote: Quote, lines: POLine[], tax: number, freight: number, discount: number, excludingPoId?: string) {
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
  const initializePo = (po: PO, request: MRF, quote: Quote) => { initializePoDocument(po, request, quote, state.sites.find(value => value.id === request.siteId)!, at); po.document!.vendorName ||= state.suppliers.find(value => value.id === quote.supplierId)?.name || ""; };

  switch (command.type) {
    case "createBidReport": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to generate a bid comparison.");
      const error = bidReportReadiness(state, command.requestId);
      if (error) return fail(error);
      const data = captureBidReport(state, command.requestId, true);
      let comparisonSelections: ComparisonSelections;
      try { comparisonSelections = resolveComparisonSelections(data, command.comparisonSelections); }
      catch (cause) { return fail(cause instanceof Error ? cause.message : "Review the comparison alternatives."); }
      const version = Math.max(0, ...state.bidReports.filter(report => report.requestId === command.requestId).map(report => report.version)) + 1;
      const reportId = id("bid");
      const ref = data.request.ref.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "MRF";
      state.bidReports.push({ id: reportId, requestId: command.requestId, version, comparisonRevision: 3, comparisonSelections, generatedAt: at, fileName: `${ref}-bid-comparison-v${version}.xlsx`, data, pdf: { fileName: `${ref}-bid-comparison-v${version}.pdf`, archive: { status: "pending" } }, archive: { status: "pending" } });
      log(command.requestId, `Bid comparison v${version} captured`);
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
      if (command.type === "failBidGeneration") { if (!artifact.sha256) artifact.generationError = command.error; return done("Workbook generation needs retry."); }
      if (artifact.archive.status === "complete") return done("Bid comparison already archived.");
      if (command.type === "completeBidArchive") {
        if (!artifact.sha256 || !command.fileId || !validDriveFileLink(command.url, command.fileId)) return fail("The workbook archive is invalid.");
        artifact.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(report.requestId, `Bid comparison v${report.version} archived`);
        return done("Bid comparison archived to Google Drive.");
      }
      artifact.archive.error = command.error;
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
      const ref = (command.ref || "").trim();
      const requestDate = (command.requestDate || "").trim();
      if (command.intent === "submit") {
        if (!ref) return fail("Enter the M.R.F No. before submitting.", "ref");
        if (state.requests.some(request => request.id !== original?.id && request.ref.trim().toLocaleLowerCase() === ref.toLocaleLowerCase())) return fail("This M.R.F No. is already in use.", "ref");
        if (!validRequestDate(requestDate)) return fail("Enter a valid Request Date before submitting.", "requestDate");
        if (![command.requestedBy, command.approvedBy, command.purchaser, command.financeOfficer].every(x => x.trim())) return fail("Complete the request's general information before submitting.");
        if (!command.items.length || command.items.some(i => !i.name.trim() || !i.unit.trim() || !positive(i.quantity) || !i.neededDate.trim() || !i.location.trim())) return fail("Each material needs a name, unit, positive quantity, date needed, and delivery location.", "items");
        if (command.documents.filter(document => document.type === "Supporting PDF" && !!document.fileId).length !== 1) return fail("Attach one combined supporting PDF before submitting.", "documents");
        if (aiAssisted && command.aiReviewed !== true) return fail("Review the extracted request details and materials before submitting.", "aiReview");
      }
      const aiReview = aiAssisted ? { aiAssisted: true, aiReviewedAt: command.intent === "submit" ? at : undefined, aiReviewedBy: command.intent === "submit" ? actor : undefined } : {};
      const items = command.items.map(i => ({ ...i, name: i.name.trim(), unit: i.unit.trim(), id: i.id || id("item"), neededDate: i.neededDate.trim(), purpose: i.purpose.trim(), location: i.location.trim(), remarks: i.remarks.trim() }));
      const fields = { specialInstructions: command.specialInstructions?.trim() || "", signatoryTitles: command.signatoryTitles?.slice(0, 4).map(value => value.trim()) || [], ref, requestDate, siteId: command.siteId, category: original?.category || "", scope: original?.scope || "", scopeDocument: command.scopeDocument, requestedBy: command.requestedBy.trim(), approvedBy: command.approvedBy.trim(), purchaser: command.purchaser.trim(), financeOfficer: command.financeOfficer.trim(), items, documents: command.documents.filter(d => d.name.trim()), status: command.intent === "submit" ? "submitted" as const : "draft" as const, reason: undefined, updatedAt: at };
      if (original) {
        if (correcting) {
          if (original.correction?.scope === "documents" && (ref !== original.ref || requestDate !== original.requestDate || command.siteId !== original.siteId || JSON.stringify(items) !== JSON.stringify(original.items) || fields.requestedBy !== original.requestedBy || fields.approvedBy !== original.approvedBy || fields.purchaser !== original.purchaser || fields.financeOfficer !== original.financeOfficer || fields.specialInstructions !== (original.specialInstructions || "") || JSON.stringify(fields.signatoryTitles) !== JSON.stringify(original.signatoryTitles || []))) return fail("Only the supporting PDF can change after procurement has started.");
          original.documents = fields.documents;
          if (original.correction?.scope === "full") Object.assign(original, { ...fields, status: "approved" });
          if (command.intent === "submit") original.correction = { ...original.correction!, status: "submitted" };
          original.updatedAt = at;
        } else Object.assign(original, fields);
        Object.assign(original, aiReview);
        log(original.id, command.intent === "submit" ? "MRF revised and resubmitted" : "MRF draft saved");
        return done(command.intent === "submit" ? "MRF submitted to Procurement." : "MRF draft saved.", original.id);
      }
      const requestId = id("mrf");
      state.requests.push({ id: requestId, createdAt: at, ...fields, ...aiReview });
      log(requestId, command.intent === "submit" ? "MRF submitted" : "MRF draft saved");
      return done(command.intent === "submit" ? "MRF submitted to Procurement." : "MRF draft saved.", requestId);
    }
    case "reviewRequest": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to review an MRF.");
      const request = state.requests.find(r => r.id === command.id);
      if (!request || request.status !== "submitted" && !(request.status === "approved" && request.correction?.status === "submitted")) return fail("This MRF is no longer awaiting Procurement review.");
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      if (command.decision === "approve" && !state.sites.find(site => site.id === request.siteId)?.driveFolderId) return fail("Map this project's Google Drive folder before approval.");
      if (command.decision === "approve" && !supportingPdf(request)) return fail("A combined supporting PDF is required before approval.");
      if (request.correction) {
        if (command.decision === "reject") return fail("Return the correction to Site Personnel instead.");
        if (command.decision === "return") request.correction = { ...request.correction, status: "requested", reason: command.reason!.trim() };
        else { request.correction = undefined; request.archive = { status: "pending", approvedAt: at, versions: request.archive?.versions || [] }; }
        request.updatedAt = at;
        log(request.id, command.decision === "approve" ? "MRF correction approved; Drive archive pending" : "MRF correction returned", command.reason);
        return done(command.decision === "approve" ? "MRF correction approved. Archiving to Drive." : "MRF correction returned.");
      }
      request.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : "rejected";
      if (command.decision === "approve") request.archive = { status: "pending", approvedAt: at, versions: [] };
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
      const hasPurchasing = state.quotes.some(value => value.mrfId === request.id) || state.pos.some(value => value.mrfId === request.id);
      request.correction = { status: "requested", scope: hasPurchasing ? "documents" : "full", reason: command.reason.trim() };
      request.updatedAt = at;
      log(request.id, "MRF reopened for correction", command.reason);
      return done("Site Personnel can revise this MRF.");
    }
    case "completeRequestArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to complete an MRF archive.");
      const request = state.requests.find(value => value.id === command.id);
      if (!request || request.status !== "approved" || request.archive?.status !== "pending" || request.correction) return fail("This MRF is not awaiting a Drive archive.");
      if (![command.formFileId, command.supportFileId, command.formUrl, command.supportUrl].every(Boolean)) return fail("The Drive archive is incomplete.");
      request.archive.versions.push({ version: request.archive.versions.length + 1, formFileId: command.formFileId, supportFileId: command.supportFileId, formUrl: command.formUrl, supportUrl: command.supportUrl, archivedAt: at });
      request.archive.status = "complete";
      request.archive.error = undefined;
      request.updatedAt = at;
      log(request.id, "MRF archived to Google Drive");
      return done("MRF archived to Google Drive. Procurement can continue.");
    }
    case "failRequestArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to update an MRF archive.");
      const request = state.requests.find(value => value.id === command.id);
      if (!request || request.archive?.status !== "pending") return fail("This MRF is not awaiting a Drive archive.");
      request.archive.error = command.error.slice(0, 300);
      request.updatedAt = at;
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
      const draft: Quote = { ...incoming, reviewStatus: "draft", prices: {}, version: existing?.version || (previousQuote?.version || 0) + 1, documents: incoming.documents, archive: undefined, reviewedAt: undefined };
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
      log(quote.mrfId, "Quotation draft removed");
      return done("Quotation draft removed.");
    }
    case "finalizeQuote": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to finalize quotations.");
      const quote = state.quotes.find(value => value.id === command.id && value.reviewStatus === "draft");
      if (!quote) return fail("Quotation draft not found.");
      if (!procurementReady(state.requests.find(value => value.id === quote.mrfId))) return fail("Procurement is paused until the MRF archive is ready.");
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
      quote.archive = { status: "pending", files: [] };
      quote.lines = quote.lines?.map(line => ({ ...line, matchConfirmed: line.requestItemId ? true : false }));
      log(quote.id, "Supplier quotation finalized");
      return done("Quotation finalized for comparison and awards.", quote.id);
    }
    case "completeQuoteArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to archive a quotation.");
      const quote = state.quotes.find(value => value.id === command.id);
      if (!quote || quote.reviewStatus !== "finalized" || quote.archive?.status !== "pending") return fail("This quotation is not awaiting a Drive archive.");
      if (quote.documents.length !== command.files.length || quote.documents.some(document => !command.files.some(file => file.localFileId === document.fileId && file.driveFileId && file.url))) return fail("The quotation archive is incomplete.");
      quote.archive = { status: "complete", files: command.files };
      log(quote.id, "Supplier quotation archived to Google Drive");
      return done("Supplier quotation archived to Google Drive.");
    }
    case "failQuoteArchive": {
      if (!permit("Procurement", "Administrator")) return fail("Sign in as Procurement or Administrator to update a quotation archive.");
      const quote = state.quotes.find(value => value.id === command.id);
      if (!quote || quote.archive?.status !== "pending") return fail("This quotation is not awaiting a Drive archive.");
      quote.archive.error = command.error.slice(0, 300);
      return done("Quotation archive pending. Retry the upload.");
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
      if (!requested || command.quantity + usedRequest > requested.quantity + 0.000001) return fail("Awarded quantities exceed the MRF request.");
      if (command.quantity + usedOffer > offer.quantity * offer.conversionFactor + 0.000001) return fail("Awarded quantity exceeds the supplier's quoted quantity.");
      if (existing) state.pendingAwards = state.pendingAwards.filter(value => value.id !== existing.id);
      if (command.quantity > 0) state.pendingAwards.push({ id: existing?.id || id("award"), requestId: request.id, quoteId: quote.id, quoteLineId: offer.id, itemId: offer.requestItemId, quantity: command.quantity });
      return done(command.quantity > 0 ? "Award staged." : "Award removed.");
    }
    case "generateAwardPOs": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to prepare POs.");
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
        if (state.pos.some(value => value.mrfId === command.requestId && value.status !== "rejected" && state.quotes.find(source => source.id === value.quoteId)?.supplierId === quote.supplierId)) return fail("An active PO already exists for this supplier and MRF. Edit that PO draft instead.");
        const selectionReason = (command.reasons[quote.supplierId] || "").trim();
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
        state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: command.requestId, quoteId, lines, adjustments, status: "draft", priority: "Normal", notes: "", selectionReason, createdAt: at, updatedAt: at });
        initializePo(state.pos[state.pos.length - 1], state.requests.find(value => value.id === command.requestId)!, quote);
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
      state.quotes.push({ id: quoteId, mrfId: request.id, supplierId: command.supplierId, ref: command.ref.trim(), prices: {}, available: command.available.trim(), leadDays: command.leadDays, terms: command.terms.trim(), documents: command.documents, archive: { status: "pending", files: [] }, reviewStatus: "finalized", lines: command.lines.map(line => ({ ...line, id: line.id || id("offer"), description: line.description.trim(), unit: line.unit.trim(), brand: line.brand.trim(), specification: line.specification.trim(), varianceReason: line.varianceReason.trim() })), version: (prior?.version || 0) + 1, supersedesId: prior?.id, currency: "PHP", tax: command.tax, freight: command.freight, discount: command.discount, validity: command.validity.trim(), extraction: command.extraction });
      log(request.id, "Supplier quotation reviewed");
      return done("Quotation saved for comparison.", quoteId);
    }
    case "createAwardPO": {
      if (!permit("Procurement")) return fail("Sign in as Procurement to prepare a PO.");
      const quote = state.quotes.find(q => q.id === command.quoteId);
      if (!quote) return fail("Choose a reviewed quotation.");
      const error = awardError(state, command.requestId, quote, command.lines, command.tax, command.freight, command.discount);
      if (error) return fail(error);
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.");
      const poId = id("po");
      state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: command.requestId, quoteId: quote.id, lines: command.lines, tax: command.tax, freight: command.freight, discount: command.discount, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
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
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.", "reason");
      const poId = id("po");
      state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: request.id, quoteId: quote.id, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
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
        po.selectionReason = (command.reason ?? po.selectionReason).trim();
      }
      if (po.financial) {
        if (command.document) po.document = command.document;
        if (command.financial) po.financial = command.financial;
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
      po.quoteId = command.quoteId; po.notes = command.notes.trim(); po.updatedAt = at;
      if (command.finalize) { po.status = "submitted"; po.reviewReason = undefined; log(po.id, "PO submitted to Accounting", po.supersededReason); return done("PO submitted. Accounting review is next."); }
      log(po.id, "PO draft updated"); return done("PO draft saved.");
    }
    case "saveAccountingPO": {
      if (!permit("Accounting / Auditing")) return fail("Sign in as Accounting to review PO finances.");
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
      if (command.adjustments && command.adjustments.some(value => !value.label.trim() || !nonnegative(value.value) || value.calculation === "percentage" && value.value > 100)) return fail("Review each PO adjustment amount.");
      po.financial = command.financial; po.paymentMode = command.paymentMode;
      if (command.adjustments) po.adjustments = command.adjustments;
      for (const key of ["tax", "freight", "discount"] as const) if (command[key] !== undefined) { if (!nonnegative(command[key]!)) return fail("PO charges must be nonnegative."); po[key] = command[key]; }
      const error = poFinancialError(po);
      if (error || poTotal(state, po) <= 0) return fail(error || "PO total must be positive.");
      po.updatedAt = at; log(po.id, "Accounting financial review saved"); return done("PO financial review saved.");
    }
    case "setPriority": {
      if (!permit("Finance")) return fail("Sign in as Finance to set payment priority.");
      const payment = state.paymentRequests.find(value => value.id === command.id);
      if (!payment || !["submitted", "hold", "approved"].includes(payment.status)) return fail("This payment request is not in Finance review.");
      payment.priority = command.priority; payment.updatedAt = at; return done("Payment priority updated.");
    }
    case "reviewPO": {
      if (!permit("Accounting / Auditing")) return fail("Sign in as Accounting to review a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || !["submitted", "hold"].includes(po.status)) return fail("This PO is not awaiting Accounting review.");
      if (command.decision === "approve") {
        const request = requestForPO(state, po);
        if (!request || !procurementReady(request)) return fail("The linked MRF archive must be ready.");
        if (!["upfront", "credit"].includes(po.paymentMode || "")) return fail("Confirm upfront payment or credit terms before approval.");
        const error = poFinancialError(po, true);
        if (error) return fail(error);
        if (!po.financial || !po.document) return fail("Complete the PO financial and document review.");
        if (po.adjustments?.some(value => !value.confirmed)) return fail("Confirm or exclude every PO adjustment.");
        if (poTotal(state, po) <= 0 || poTotal(state, po) > budgetFor(state, request.siteId).available) return fail("This PO exceeds the available project budget or has an invalid total.");
        po.status = "approved"; po.reviewReason = undefined; po.updatedAt = at; po.reviewedAt = at; po.reviewedBy = actor; po.archive = { status: "pending" };
        log(po.id, "PO approved by Accounting; budget committed"); return done("PO approved. Archive its PDF before release to Logistics.");
      }
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      po.status = command.decision === "hold" ? "hold" : command.decision === "return" ? "returned" : "rejected";
      po.reviewReason = command.reason!.trim(); po.updatedAt = at;
      log(po.id, `Accounting ${po.status}`, po.reviewReason); return done(`PO ${po.status}.`);
    }
    case "savePaymentRequest": {
      if (!permit("Accounting / Auditing")) return fail("Sign in as Accounting to prepare a payment request.");
      const po = state.pos.find(value => value.id === command.poId && ["approved", "released"].includes(value.status));
      if (!po) return fail("Accounting must approve the PO before requesting payment.");
      const existing = command.id ? state.paymentRequests.find(value => value.id === command.id && value.poId === po.id) : undefined;
      if ((command.id && !existing) || (existing && !["draft", "returned"].includes(existing.status))) return fail("This payment request is locked for editing.");
      const open = openPaymentRequest(state, po.id);
      if (open && open.id !== existing?.id) return fail("Complete the open payment request before creating another.");
      if (!positive(command.amount) || !close(command.amount, Math.round(command.amount * 100) / 100) || command.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("Request a positive amount within the unpaid PO balance.", "amount");
      const payment = existing || { id: id("payment-request"), ref: nextRef("PAY-2026", state.paymentRequests), poId: po.id, amount: command.amount, note: "", status: "draft" as const, priority: po.priority, createdAt: at, updatedAt: at, createdBy: actor };
      Object.assign(payment, { amount: command.amount, note: command.note.trim(), status: command.submit ? "submitted" : "draft", reason: undefined, updatedAt: at, reviewedAt: undefined, reviewedBy: undefined });
      if (!existing) state.paymentRequests.push(payment);
      log(po.id, command.submit ? "Payment request submitted to Finance" : "Payment request draft saved", payment.ref); return done(command.submit ? "Payment request sent to Finance." : "Payment request draft saved.", payment.id);
    }
    case "reviewPaymentRequest": {
      if (!permit("Finance")) return fail("Sign in as Finance to review payment requests.");
      const payment = state.paymentRequests.find(value => value.id === command.id && ["submitted", "hold"].includes(value.status));
      if (!payment) return fail("This payment request is not awaiting Finance review.");
      const po = state.pos.find(value => value.id === payment.poId && ["approved", "released"].includes(value.status));
      if (!po || payment.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("This payment request exceeds the current unpaid balance.");
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      payment.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : command.decision === "hold" ? "hold" : "rejected";
      payment.reason = command.decision === "approve" ? undefined : command.reason!.trim(); payment.updatedAt = at; payment.reviewedAt = at; payment.reviewedBy = actor;
      log(po.id, `Finance payment request ${payment.status}`, payment.reason); return done(`Payment request ${payment.status}.`);
    }
    case "completePOArchive": {
      if (!permit("Accounting / Auditing", "Administrator")) return fail("Sign in as Accounting or Administrator to archive a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || po.status !== "approved" || po.archive?.status !== "pending" || !command.fileId || !command.url) return fail("This PO is not awaiting a Drive archive.");
      po.archive = { status: "complete", fileId: command.fileId, url: command.url };
      log(po.id, "Purchase order archived to Google Drive");
      return done("Purchase order archived to Google Drive.");
    }
    case "failPOArchive": {
      if (!permit("Accounting / Auditing", "Administrator")) return fail("Sign in as Accounting or Administrator to update a PO archive.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po || po.archive?.status !== "pending") return fail("This PO is not awaiting a Drive archive.");
      po.archive.error = command.error.slice(0, 300);
      return done("PO archive pending. Retry the upload.");
    }
    case "releasePO": {
      if (!permit("Accounting / Auditing")) return fail("Sign in as Accounting to release a PO.");
      const po = state.pos.find(value => value.id === command.id);
      if (!po) return fail("Purchase order not found.");
      const error = releaseBlocker(state, po);
      if (error) return fail(error);
      po.status = "released"; po.updatedAt = at; po.releasedAt = at; po.releasedBy = actor;
      log(po.id, "PO released to Logistics"); return done("PO released. Logistics can schedule delivery.");
    }
    case "createBatch": {
      if (!permit("Logistics")) return fail("Sign in as Logistics to schedule a delivery.");
      const po = state.pos.find(p => p.id === command.poId);
      if (!po || po.status !== "released") return fail("Only a released PO can receive a delivery batch.");
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
      if (!permit("Site Personnel")) return fail("Sign in as Site Personnel to confirm receiving.");
      const batch = state.batches.find(b => b.id === command.id);
      const po = state.pos.find(p => p.id === batch?.poId);
      if (!batch || batch.status !== "expected" || !po || po.status !== "released") return fail("This batch is not awaiting site confirmation.");
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
      if (!permit("Site Personnel")) return fail("Sign in as Site Personnel to post site stock.");
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
      if (command.kind === "usage" && !permit("Site Personnel")) return fail("Sign in as Site Personnel to record usage.");
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
    case "attachAccountingDocuments": {
      if (!permit("Site Personnel")) return fail("Sign in as Site Personnel to upload delivery documents.");
      const batch = state.batches.find(value => value.id === command.batchId && value.poId === command.poId && ["confirmed", "posted"].includes(value.status));
      const po = state.pos.find(value => value.id === command.poId && value.status === "released");
      if (!batch || !po) return fail("Confirm this delivered batch before uploading accounting documents.");
      let record = state.accounting.find(value => value.poId === command.poId);
      const existing = (record?.documents || []).filter(value => value.batchId === batch.id);
      if (!command.documents.length || command.documents.some(value => !validAccountingDocument(value)) || existing.length + command.documents.length > 12 || [...existing, ...command.documents].reduce((total, value) => total + value.size, 0) > MAX_ACCOUNTING_BATCH) return fail("Use up to 12 PDF or image files, at most 20 MB each and 45 MB per batch.");
      const fileIds = [...(record?.documents || []).map(value => value.localFileId), ...command.documents.map(value => value.localFileId)];
      if (new Set(fileIds).size !== fileIds.length) return fail("This document is already attached.");
      if (!record) { record = { poId: po.id, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "", documents: [] }; state.accounting.push(record); }
      record.documents = [...(record.documents || []), ...command.documents.map(value => ({ ...value, id: id("account-doc"), batchId: batch.id, uploadedAt: at, uploadedBy: actor, archive: { status: "pending" as const } }))];
      if (record.review === "Complete") record.review = "Under Review";
      log(po.id, `Accounting evidence attached for ${batch.ref}`);
      return done("Accounting documents saved. Archiving to Google Drive…");
    }
    case "completeAccountingArchive":
    case "failAccountingArchive": {
      if (!permit("Site Personnel", "Accounting / Auditing", "Administrator")) return fail("Sign in as Site Personnel, Accounting or Administrator to archive accounting documents.");
      const document = state.accounting.find(value => value.poId === command.poId)?.documents?.find(value => value.id === command.documentId);
      if (!document) return fail("Accounting document not found.");
      if (document.archive.status === "complete") return done("Accounting document already archived.");
      if (command.type === "completeAccountingArchive") {
        if (!validDriveFileLink(command.url, command.fileId)) return fail("The accounting document archive is invalid.");
        document.archive = { status: "complete", fileId: command.fileId, url: command.url };
        log(command.poId, "Accounting document archived");
        return done("Accounting document archived to Google Drive.");
      }
      document.archive.error = command.error;
      return done("Accounting document saved; Drive archive needs retry.");
    }
    case "saveDocuments": {
      if (!permit("Accounting / Auditing")) return fail("Sign in as Accounting to review documents.");
      if (!state.pos.some(p => p.id === command.poId && ["approved", "released"].includes(p.status))) return fail("This PO is not ready for accounting review.");
      if (command.review === "Complete" && (!command.invoiceRef.trim() || !command.receiptRef.trim())) return fail("Invoice and receipt references are required to complete review.");
      if (command.review === "Discrepancy" && !reasonOK(command.note)) return fail("Describe the discrepancy.", "note");
      let record = state.accounting.find(a => a.poId === command.poId);
      if (!record) { record = { poId: command.poId, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "" }; state.accounting.push(record); }
      Object.assign(record, { invoiceRef: command.invoiceRef.trim(), receiptRef: command.receiptRef.trim(), review: command.review, note: command.note.trim() });
      log(command.poId, `Documents marked ${record.review}`, record.note);
      return done("Document review saved.");
    }
    case "recordPayment": {
      if (!permit("Finance")) return fail("Sign in as Finance to record disbursement.");
      const payment = state.paymentRequests.find(value => value.id === command.paymentRequestId && value.status === "approved");
      if (!payment || state.payments.some(value => value.paymentRequestId === payment.id)) return fail("An approved, undisbursed payment request is required.");
      const po = state.pos.find(value => value.id === payment.poId && ["approved", "released"].includes(value.status));
      if (!po || !positive(payment.amount) || payment.amount > poTotal(state, po) - paidTotal(state, po.id) + 0.000001) return fail("Disbursement exceeds the unpaid PO balance.");
      if (!["Bank", "Cash", "Check", "Other"].includes(command.method) || !command.reference.trim() || !validRequestDate(command.date)) return fail("Enter a valid payment method, reference and date.");
      const paymentId = id("payment");
      state.payments.push({ id: paymentId, poId: po.id, paymentRequestId: payment.id, amount: payment.amount, method: command.method, reference: command.reference.trim(), date: command.date, actor });
      payment.status = "disbursed"; payment.disbursedAt = at; payment.updatedAt = at;
      log(po.id, `Finance disbursement recorded: ${payment.amount}`, command.reference); return done("Disbursement recorded. Accounting can review release eligibility.", paymentId);
    }
    case "setProjectDriveFolder": {
      if (!permit("Administrator")) return fail("Sign in as Administrator to map a project folder.");
      const site = state.sites.find(value => value.id === command.siteId);
      if (!site || !command.folderId.trim()) return fail("Choose a valid project folder.");
      site.driveFolderId = command.folderId.trim();
      log(site.id, "Google Drive project folder mapped");
      return done("Project Drive folder saved.");
    }
    case "addSite": {
      if (!permit("Administrator")) return fail("Sign in as Administrator to add a project.");
      const name = command.name.trim();
      if (!name || !command.location.trim()) return fail("Complete the project name and location.");
      if (!nonnegative(command.budget)) return fail("Enter a valid budget of zero or more.", "budget");
      if (state.sites.some(site => site.name.toLowerCase() === name.toLowerCase())) return fail("Enter a unique project name.", "name");
      const siteId = id("site");
      state.sites.push({ id: siteId, name, location: command.location.trim(), budget: command.budget, personnel: "" });
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
