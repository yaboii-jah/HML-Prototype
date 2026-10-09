import { canAttachDelivery, canArchiveAccounting, receivedDelivery } from "./delivery-archive.ts";
import { isSiteBatch } from "./delivery-flow.ts";
import { canAttachPaymentProof, proofAssigned, requiresPMReview } from "./full-disbursement.ts";
import type { Command } from "./commands.ts";
import type { DemoSnapshot, OperationTarget, Role } from "./types.ts";

export function operationEntity(target: OperationTarget): string {
  return (target.kind === "evidence" || target.kind === "payment-proof") ? target.documentId : target.kind === "attachment" ? target.batchId || target.poId : target.kind === "delivery-receipt" ? target.receiptId : target.id;
}
// Bind to the document/version being processed, not just a reusable record ID.
export function operationFingerprint(state: DemoSnapshot, target: OperationTarget): string {
  const project = (requestId?: string) => { const request = state.requests.find(value => value.id === requestId); return [request?.ref, request?.siteId, state.sites.find(value => value.id === request?.siteId)?.driveFolderId]; };
  switch (target.kind) {
    case "payment-proof": { const po = state.pos.find(value => value.id === target.poId), proof = po?.paymentProofs?.find(value => value.id === target.documentId); return JSON.stringify([po?.id,po?.issuance,proof?.id,proof?.sha256,proof?.size,proof?.localFileId,state.sites.find(site => site.id === state.requests.find(request => request.id === po?.mrfId)?.siteId)?.driveFolderId]); }
    case "project": { const value = state.sites.find(site => site.id === target.id); return JSON.stringify([value?.id, value?.name, value?.driveFolderId]); }
    case "request": { const value = state.requests.find(record => record.id === target.id); return JSON.stringify([value?.ref, value?.siteId, value?.requestDate, value?.requestedBy, value?.approvedBy, value?.purchaser, value?.financeOfficer, value?.items, value?.documents, value?.specialInstructions, value?.archive?.approvedAt, Math.max(0, (value?.archive?.versions.length || 0) - (value?.archive?.status === "complete" ? 1 : 0)), project(value?.id)]); }
    case "quote": { const value = state.quotes.find(record => record.id === target.id); return JSON.stringify([value?.mrfId, value?.version, value?.ref, value?.documents, project(value?.mrfId)]); }
    case "po": { const value = state.pos.find(record => record.id === target.id); return JSON.stringify([value?.mrfId, value?.quoteId, value?.ref, value?.lines, value?.document, value?.financial, value?.adjustments, value?.tax, value?.freight, value?.discount, value?.notes, value?.paymentMode, value?.reviewedAt, value?.approvalHistory?.length, project(value?.mrfId)]); }
    case "report": { const value = state.bidReports.find(record => record.id === target.id); return JSON.stringify([value?.requestId, value?.version, value?.data, value?.comparisonSelections]); }
    case "evidence": { const value = state.accounting.find(record => record.poId === target.poId)?.documents?.find(record => record.id === target.documentId); const po = state.pos.find(record => record.id === target.poId); return JSON.stringify([value?.id, value?.batchId, value?.sha256, value?.size, value?.localFileId, project(po?.mrfId)]); }
    case "delivery-receipt": { const batch = state.batches.find(value => value.id === target.batchId); const receipt = batch?.receiptVersions?.find(value => value.id === target.receiptId); return JSON.stringify([receipt?.id, receipt?.data, project(receipt?.data.request.id)]); }
    case "attachment": { const po = state.pos.find(record => record.id === target.poId); return JSON.stringify([target.batchId, po?.id, po?.mrfId]); }
  }
}
export function operationError(state: DemoSnapshot, target: OperationTarget, role: Role): string {
  const permitted = (...roles: Role[]) => roles.includes(role);
  switch (target.kind) {
    case "payment-proof": { const po = state.pos.find(value => value.id === target.poId); return permitted("Accounting / Auditing", "Administrator") && po && canAttachPaymentProof(po) && !proofAssigned(po,target.documentId) && po.paymentProofs?.some(value => value.id === target.documentId && value.archive.status === "pending") ? "" : "This proof has no pending archive."; }
    case "project": return permitted("Administrator", "Project Manager") && state.sites.some(site => site.id === target.id && !site.driveFolderId) ? "" : "This project already has a folder or cannot be configured.";
    case "request": { const record = state.requests.find(value => value.id === target.id); return (permitted("Procurement", "Administrator") || permitted("Project Manager") && requiresPMReview(state.requests.find(r => r.id === target.id))) && record?.status === "approved" && !record.correction && record.archive?.status === "pending" ? "" : "This MRF is not available for archiving."; }
    case "quote": { const record = state.quotes.find(value => value.id === target.id); return permitted("Procurement", "Administrator") && record?.reviewStatus === "finalized" && record.archive?.status === "pending" ? "" : "This quotation is not available for archiving."; }
    case "po": { const record = state.pos.find(value => value.id === target.id); return permitted("Accounting / Auditing", "Administrator") && record?.status === "approved" && record.archive?.status === "pending" ? "" : "This PO is not available for archiving."; }
    case "report": { const record = state.bidReports.find(value => value.id === target.id); const artifacts = target.format === "pdf" ? [record?.pdf] : target.format === "xlsx" ? [record] : [record, record?.pdf]; return permitted("Procurement") && record && artifacts.some(value => value && (!value.sha256 || value.archive.status === "pending")) ? "" : "This comparison has no pending generation or archive work."; }
    case "evidence": { const record = state.accounting.find(value => value.poId === target.poId)?.documents?.find(value => value.id === target.documentId); return canArchiveAccounting(state, target.poId, target.documentId, role) && record?.archive.status === "pending" ? "" : "This evidence is not available for archiving."; }
    case "delivery-receipt": { const batch = state.batches.find(value => value.id === target.batchId); return batch && receivedDelivery(batch) && permitted("Accounting / Auditing", "Administrator", isSiteBatch(batch) ? "Site Personnel" : "Procurement") && batch.receiptVersions?.some(value => value.id === target.receiptId && value.archive.status === "pending") ? "" : "This receipt has no pending archive for this department."; }
    case "attachment": return canAttachDelivery(state, target.poId, target.batchId, role) ? "" : "This delivery is not available for evidence attachment.";
  }
}
export function operationRetry(state: DemoSnapshot, target: OperationTarget): boolean {
  switch (target.kind) {
    case "payment-proof": return !!state.pos.find(value => value.id === target.poId)?.paymentProofs?.find(value => value.id === target.documentId)?.archive.error;
    case "project": return !!state.sites.find(site => site.id === target.id)?.driveFolderSetup?.error;
    case "request": return !!state.requests.find(value => value.id === target.id)?.archive?.error;
    case "quote": return !!state.quotes.find(value => value.id === target.id)?.archive?.error;
    case "po": return !!state.pos.find(value => value.id === target.id)?.archive?.error;
    case "report": { const report = state.bidReports.find(value => value.id === target.id); const artifact = target.format === "pdf" ? report?.pdf : report; return !!(artifact?.archive.error || artifact?.generationError); }
    case "evidence": return !!state.accounting.find(value => value.poId === target.poId)?.documents?.find(value => value.id === target.documentId)?.archive.error;
    case "delivery-receipt": return !!state.batches.find(value => value.id === target.batchId)?.receiptVersions?.find(value => value.id === target.receiptId)?.archive.error;
    case "attachment": return false;
  }
}
export function operationAllows(target: OperationTarget, command: Command): boolean {
  switch (target.kind) {
    case "payment-proof": return (command.type === "completePaymentProofArchive" || command.type === "failPaymentProofArchive") && command.poId === target.poId && command.documentId === target.documentId;
    case "project": return (command.type === "completeProjectFolder" || command.type === "failProjectFolder") && command.siteId === target.id;
    case "request": return ["completeRequestArchive", "failRequestArchive"].includes(command.type) && "id" in command && command.id === target.id;
    case "quote": return ["completeQuoteArchive", "failQuoteArchive"].includes(command.type) && "id" in command && command.id === target.id;
    case "po": return ["completePOArchive", "failPOArchive"].includes(command.type) && "id" in command && command.id === target.id;
    case "report": return ["saveBidReportFile", "failBidGeneration", "completeBidArchive", "failBidArchive"].includes(command.type) && "id" in command && command.id === target.id && (!target.format || "format" in command && (command.format || "xlsx") === target.format);
    case "evidence": return (command.type === "completeAccountingArchive" || command.type === "failAccountingArchive") && command.poId === target.poId && command.documentId === target.documentId;
    case "delivery-receipt": return (command.type === "completeDeliveryReceiptArchive" || command.type === "failDeliveryReceiptArchive") && command.batchId === target.batchId && command.receiptId === target.receiptId;
    case "attachment": return command.type === "attachAccountingDocuments" && command.poId === target.poId && command.batchId === target.batchId;
  }
}
