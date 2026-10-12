import { ROLES, type Activity, type AuditEntityType, type AuditEventType, type AuditIdentity, type DemoSnapshot, type HistoricalActor, type Quote } from "./types.ts";
import type { Command } from "./commands.ts";

export const copyIdentity = (identity?: AuditIdentity): AuditIdentity | undefined => identity ? { name: identity.name, email: identity.email, role: identity.role, ...(identity.userId ? { userId: identity.userId } : {}), ...(identity.sessionRevision ? { sessionRevision: identity.sessionRevision } : {}) } : undefined;
export const validIdentity = (identity: AuditIdentity) => typeof identity.name === "string" && !!identity.name.trim() && typeof identity.email === "string" && !!identity.email.trim() && (ROLES.includes(identity.role) || String(identity.role) === "Management");
export const actorName = (role: HistoricalActor, identity?: AuditIdentity) => identity && validIdentity(identity) && identity.role === role ? identity.name : "User not recorded";
export const actorText = (role: HistoricalActor, identity?: AuditIdentity) => `${actorName(role, identity)} · ${role}`;
export function auditTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time not recorded";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
export type AuditRecord = { id: string; type: AuditEntityType; ref: string; projectId?: string; requestId?: string; poId?: string; href?: string };
export function auditRecords(state: DemoSnapshot): Map<string, AuditRecord> {
  const records = new Map<string, AuditRecord>();
  const add = (record: AuditRecord) => records.set(record.id, record);
  for (const request of state.requests) add({ id: request.id, type: "request", ref: request.ref || "Unnumbered MRF", requestId: request.id, href: `/requests/${request.id}` });
  for (const quote of state.quotes) add({ id: quote.id, type: "quote", ref: quote.ref || `Quotation draft v${quote.version || 1}`, requestId: quote.mrfId, href: `/requests/${quote.mrfId}/quotes` });
  for (const po of state.pos) add({ id: po.id, type: "po", ref: po.ref, requestId: po.mrfId, poId: po.id, href: `/purchase-orders/${po.id}` });
  for (const po of state.pos) for (const proof of po.paymentProofs || []) add({ id: proof.id, type: "evidence", ref: proof.name, requestId: po.mrfId, poId: po.id, href: `/accounting/${po.id}` });
  for (const payment of state.paymentRequests) { const po = state.pos.find(value => value.id === payment.poId); add({ id: payment.id, type: "payment-request", ref: payment.ref, requestId: po?.mrfId, poId: po?.id, href: po ? `/finance/${po.id}` : undefined }); }
  for (const payment of state.payments) { const po = state.pos.find(value => value.id === payment.poId); add({ id: payment.id, type: "payment", ref: payment.reference, requestId: po?.mrfId, poId: po?.id, href: po ? `/finance/${po.id}` : undefined }); }
  for (const batch of state.batches) { const po = state.pos.find(value => value.id === batch.poId); add({ id: batch.id, type: "batch", ref: batch.ref, requestId: po?.mrfId, poId: po?.id, href: `/deliveries/${batch.id}` }); }
  for (const report of state.bidReports) add({ id: report.id, type: "comparison", ref: `Comparison v${report.version}`, requestId: report.requestId, href: `/requests/${report.requestId}/quotes` });
  for (const record of state.accounting) for (const document of record.documents || []) { const po = state.pos.find(value => value.id === record.poId); add({ id: document.id, type: "evidence", ref: document.name, requestId: po?.mrfId, poId: po?.id, href: po ? `/accounting/${po.id}` : undefined }); }
  for (const award of state.pendingAwards) add({ id: award.id, type: "allocation", ref: "Supplier allocation", requestId: award.requestId, href: `/requests/${award.requestId}/quotes` });
  for (const transfer of state.stockTransfers || []) add({ id: transfer.id, type: "allocation", ref: transfer.ref, requestId: transfer.requestId, href: "/stock-transfers/" + transfer.id });
  for (const delivery of state.transferDeliveries || []) { const transfer = state.stockTransfers?.find(value => value.id === delivery.transferId); add({ id: delivery.id, type: "batch", ref: delivery.ref, requestId: transfer?.requestId, href: transfer ? "/stock-transfers/" + transfer.id : undefined }); }
  for (const transfer of state.stockTransfers || []) for (const doc of transfer.documents || []) add({ id: doc.id, type: "evidence", ref: doc.name, requestId: transfer.requestId, href: "/stock-transfers/" + transfer.id });
  for (const movement of state.movements) { const batch = records.get(movement.batchId || movement.transferDeliveryId || ""); add({ id: movement.id, type: "movement", ref: movement.itemName, requestId: batch?.requestId, poId: batch?.poId, href: batch?.href }); }
  for (const project of state.sites) add({ id: project.id, type: "project", ref: project.name, href: `/projects/${project.id}` });
  for (const scope of state.scopes || []) add({ id: scope.id, type: "scope", ref: scope.name, href: `/projects/${scope.siteId}` });
  for (const supplier of state.suppliers) add({ id: supplier.id, type: "supplier", ref: supplier.name, href: "/suppliers" });
  for (const record of records.values()) {
    if (record.type === "project") record.projectId = record.id;
    else if (record.type === "scope") record.projectId = state.scopes?.find(scope => scope.id === record.id)?.siteId;
    else if (record.type === "movement") record.projectId = state.movements.find(movement => movement.id === record.id)?.siteId;
    else if (record.requestId) record.projectId = state.requests.find(request => request.id === record.requestId)?.siteId;
  }
  return records;
}
export function auditProjectId(state: DemoSnapshot, event: Activity, records = auditRecords(state)): string | undefined {
  if (event.projectId) return event.projectId;
  return records.get(event.entity)?.projectId || state.requests.find(request => request.id === event.requestId)?.siteId || state.requests.find(request => request.id === state.pos.find(po => po.id === event.poId)?.mrfId)?.siteId;
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const labels: Record<string, string> = { status: "Coordination status", plannedDate: "Planned payment date", paymentDueDate: "Agreed payment due date", ref: "Reference", sourceRef: "Source MRF number", siteId: "Project", requestDate: "Request date", requestedBy: "Requested by", approvedBy: "Approved by", purchaser: "Purchaser", financeOfficer: "Finance officer", specialInstructions: "Instructions", items: "Materials", documents: "Source documents", supplierId: "Supplier", supplierDetails: "Supplier details", available: "Availability", leadDays: "Lead time", terms: "Payment terms", currency: "Currency", tax: "Tax", freight: "Freight", discount: "Discount", validity: "Validity", quoteDate: "Quotation date", deliveryTerms: "Delivery terms", quoteNotes: "Notes", adjustments: "Charges and deductions", notes: "Notes", document: "Document details", financial: "VAT and EWT settings", lines: "Material lines", paymentMode: "Payment arrangement", amount: "Amount", note: "Note", priority: "Priority", quantity: "Quantity", review: "Document review", invoiceRef: "Invoice reference", receiptRef: "Receipt reference", scopeId: "Scope of work", name: "Scope name", budget: "Scope allocation", scopeDocument: "Scope document" };
function fieldsChanged(before: object | undefined, after: object | undefined, keys: string[]): string[] {
  const left = (before || {}) as Record<string, unknown>, right = (after || {}) as Record<string, unknown>;
  return keys.filter(key => !same(left[key], right[key])).map(key => labels[key] || key);
}
function quoteChanges(before: Quote | undefined, after: Quote | undefined): string[] {
  if (!before || !after) return [];
  const fields = fieldsChanged(before, after, ["ref", "supplierId", "supplierDetails", "available", "leadDays", "terms", "documents", "currency", "tax", "freight", "discount", "validity", "quoteDate", "deliveryTerms", "quoteNotes", "adjustments", "financial"]);
  const lineLabels = { description: "Description", quantity: "Quantity", unit: "Unit", unitPrice: "Unit price", brand: "Brand", specification: "Specification", requestItemId: "MRF match", conversionFactor: "Unit conversion", varianceReason: "Variance reason", discountType: "Discount type", discountValue: "Discount", taxRate: "Tax rate", printedTotal: "Printed total", discrepancyReason: "Discrepancy reason", matchConfirmed: "Match confirmation", leadTime: "Lead time", supplierItemCode: "Supplier item code" };
  if (!same(before?.lines?.map(line => line.id), after.lines?.map(line => line.id))) fields.push("Offered lines");
  for (const [index, line] of (after.lines || []).entries()) { const prior = before?.lines?.find(value => value.id === line.id); for (const key of Object.keys(lineLabels) as (keyof typeof lineLabels)[]) if (!same(prior?.[key], line[key])) fields.push(`Line ${index + 1}: ${lineLabels[key]}`); }
  return fields;
}
export function auditChanges(previous: DemoSnapshot, state: DemoSnapshot, command: Command): string[] {
  switch (command.type) {
    case "updateSite": {
      const before = previous.sites.find(site => site.id === command.siteId), after = state.sites.find(site => site.id === command.siteId);
      return ( ["name", "documentCode", "location", "budget"] as const).filter(key => before?.[key] !== after?.[key]).map(key => ({ name: "Project name", documentCode: "Project code", location: "Location", budget: "Allocated budget" })[key]);
    }
    case "setProjectDriveFolder": return previous.sites.find(site => site.id === command.siteId)?.driveFolderId !== state.sites.find(site => site.id === command.siteId)?.driveFolderId ? ["Google Drive folder"] : [];
    case "saveProjectScope": return fieldsChanged(previous.scopes?.find(value => value.id === command.id), state.scopes.find(value => value.id === command.id), ["name", "budget"]);
    case "saveQuoteDraft": return quoteChanges(previous.quotes.find(value => value.id === command.quote.id), state.quotes.find(value => value.id === command.quote.id));
    case "saveRequest": return fieldsChanged(previous.requests.find(value => value.id === command.id), state.requests.find(value => value.id === command.id), ["ref", "sourceRef", "siteId", "scopeId", "requestDate", "requestedBy", "approvedBy", "purchaser", "financeOfficer", "specialInstructions", "items", "documents", "scopeDocument"]);
    case "savePO": case "saveAccountingPO": return fieldsChanged(previous.pos.find(value => value.id === command.id), state.pos.find(value => value.id === command.id), ["supplierId", "notes", "document", "financial", "lines", "adjustments", "tax", "freight", "discount", "paymentMode", "paymentDueDate"]);
    case "savePaymentRequest": return fieldsChanged(previous.paymentRequests.find(value => value.id === command.id), state.paymentRequests.find(value => value.id === command.id), ["amount", "note"]);
    case "savePaymentCoordination": return fieldsChanged(previous.pos.find(value => value.id === command.poId)?.paymentCoordination, state.pos.find(value => value.id === command.poId)?.paymentCoordination, ["priority", "status", "plannedDate", "note"]);
    case "setPriority": return fieldsChanged(previous.paymentRequests.find(value => value.id === command.id), state.paymentRequests.find(value => value.id === command.id), ["priority"]);
    case "stageAward": case "replaceMaterialAwards": return ["Supplier allocation quantity"];
    case "saveDocuments": return fieldsChanged(previous.accounting.find(value => value.poId === command.poId), state.accounting.find(value => value.poId === command.poId), ["review", "invoiceRef", "receiptRef", "note"]);
    default: return [];
  }
}
export function auditKind(command: Command, previous: DemoSnapshot): AuditEventType {
  switch (command.type) {
    case "savePaymentCoordination": return "payment.coordination.changed";
    case "updateSite": return "project.updated";
    case "removeSite": return "project.removed";
    case "removeProjectScope": return "scope.removed";
    case "saveProjectScope": return "scope.saved";
    case "saveRequest": return "request.saved";
    case "reviewRequest": return "request.reviewed";
    case "reopenApprovedRequest": return "request.reopened";
    case "saveQuoteDraft": return previous.quotes.some(value => value.id === command.quote.id) ? "quote.draft.updated" : "quote.draft.created";
    case "deleteQuoteDraft": return "quote.draft.deleted";
    case "finalizeQuote": case "saveReviewedQuote": return "quote.finalized";
    case "stageAward": case "replaceMaterialAwards": return "allocation.changed";
    case "createAwardPO": case "createPO": case "generateAwardPOs": return "po.created";
    case "savePO": case "saveAccountingPO": return "po.saved";
    case "reviewPO": return "po.reviewed";
    case "releasePO": return "po.released";
    case "issuePO": return "po.issued";
    case "reopenPOReview": return "po.reopened";
    case "recordCreditPayment": case "verifyExternalPayment": return "payment.verified";
    case "voidCreditPayment": case "reopenPaymentVerification": return "payment.reopened";
    case "attachPaymentProofs": return "proof.attached";
    case "removePaymentProof": return "proof.removed";
    case "completePaymentProofArchive": return "archive.completed";
    case "failPaymentProofArchive": return "archive.failed";
    case "savePaymentRequest": return "payment-request.saved";
    case "reviewPaymentRequest": return "payment-request.reviewed";
    case "setPriority": return "payment.priority.changed";
    case "recordPayment": return "payment.recorded";
    case "createBatch": return "batch.scheduled";
    case "dispatchBatch": return "batch.dispatched";
    case "confirmBatch": return "batch.received";
    case "postBatch": return "batch.posted";
    case "recordMovement": return "stock.changed";
    case "captureDeliveryReceipt": case "classifyAccountingDocument": case "attachAccountingDocuments": return "evidence.attached";
    case "saveDocuments": return "documents.reviewed";
    case "createBidReport": return "comparison.captured";
    case "saveBidReportFile": return "comparison.generated";
    case "failBidGeneration": return "comparison.generation.failed";
    case "failRequestArchive": case "failQuoteArchive": case "failPOArchive": case "failBidArchive": case "failAccountingArchive": case "failDeliveryReceiptArchive": return "archive.failed";
    case "startOperation": return "operation.started";
    case "completeProjectFolder": case "failProjectFolder": case "addSite": case "setProjectDriveFolder": return "project.changed";
    case "addSupplierFromQuote": return "supplier.created";
    default: return "archive.completed";
  }
}
export function auditMetadata(previous: DemoSnapshot, state: DemoSnapshot, command: Command, entity: string, identity?: AuditIdentity): Partial<Activity> {
  const records = auditRecords(state), oldRecords = auditRecords(previous);
  const record = records.get(entity) || oldRecords.get(entity);
  const requestId = record?.requestId || ("requestId" in command ? command.requestId : command.type === "saveQuoteDraft" ? command.quote.mrfId : undefined);
  return { actorIdentity: copyIdentity(identity), eventType: auditKind(command, previous), projectId: record?.projectId || state.requests.find(request => request.id === requestId)?.siteId || previous.requests.find(request => request.id === requestId)?.siteId, requestId, poId: record?.poId, entityType: record?.type, entityRef: record?.ref, changedFields: auditChanges(previous, state, command) };
}
export function extraAudit(previous: DemoSnapshot, state: DemoSnapshot, command: Command): { entity: string; action: string; reason?: string } | undefined {
  switch (command.type) {
    case "saveQuoteDraft": if (auditChanges(previous, state, command).length || !previous.quotes.some(value => value.id === command.quote.id)) return { entity: command.quote.id, action: previous.quotes.some(value => value.id === command.quote.id) ? "Quotation draft updated" : "Quotation draft created" }; break;
    case "stageAward": { const before = previous.pendingAwards.find(value => value.requestId === command.requestId && value.quoteLineId === command.quoteLineId), after = state.pendingAwards.find(value => value.requestId === command.requestId && value.quoteLineId === command.quoteLineId); if (before?.quantity !== after?.quantity) return { entity: after?.id || before!.id, action: after ? "Supplier allocation saved" : "Supplier allocation removed" }; break; }
    case "setPriority": if (auditChanges(previous, state, command).length) return { entity: command.id, action: "Payment priority changed" }; break;
    case "saveBidReportFile": { const before = previous.bidReports.find(value => value.id === command.id), after = state.bidReports.find(value => value.id === command.id); if (!same(before, after)) return { entity: command.id, action: `Comparison ${command.format === "pdf" ? "PDF" : "Excel"} generated` }; break; }
  }
}
