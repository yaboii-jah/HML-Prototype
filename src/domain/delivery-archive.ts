import type { Batch, DemoSnapshot, DeliveryReceiptVersion, Role } from "./types.ts";
import { isSiteBatch } from "./delivery-flow.ts";

export const receivedDelivery = (batch: Batch) => ["confirmed", "posted"].includes(batch.status);
export function canAttachDelivery(state: DemoSnapshot, poId: string, batchId: string | undefined, role: Role) {
  const po = state.pos.find(value => value.id === poId);
  if (!po || !["approved", "released"].includes(po.status)) return false;
  if (!batchId) return role === "Accounting / Auditing";
  const batch = state.batches.find(value => value.id === batchId && value.poId === poId);
  return !!batch && receivedDelivery(batch) && (role === "Accounting / Auditing" || role === (isSiteBatch(batch) ? "Site Personnel" : "Procurement"));
}
export function canArchiveAccounting(state: DemoSnapshot, poId: string, documentId: string, role: Role) {
  const document = state.accounting.find(value => value.poId === poId)?.documents?.find(value => value.id === documentId);
  if (!document) return false;
  if (["Accounting / Auditing", "Administrator"].includes(role)) return true;
  const batch = state.batches.find(value => value.id === document.batchId && value.poId === poId);
  return !!batch && role === (isSiteBatch(batch) ? "Site Personnel" : "Procurement");
}
export function deliveryReceiptVersion(state: DemoSnapshot, batch: Batch, id: string, at: string): DeliveryReceiptVersion {
  const po = state.pos.find(value => value.id === batch.poId)!;
  const request = state.requests.find(value => value.id === po.mrfId)!;
  const project = state.sites.find(value => value.id === request.siteId)!;
  const snapshot = (value: Batch) => { const copy = structuredClone(value); delete copy.receiptVersions; return copy; };
  const parent = state.batches.find(value => value.id === batch.parentBatchId);
  return { id, version: (batch.receiptVersions?.length || 0) + 1, createdAt: at, archive: { status: "pending" }, data: { kind: "delivery", batch: snapshot(batch), po: structuredClone(po), request: structuredClone(request), project: structuredClone(project), ...(parent ? { parentBatch: snapshot(parent) } : {}) } };
}
export function deliveryDocumentIssues(state: DemoSnapshot, poId: string): string[] {
  const documents = state.accounting.find(value => value.poId === poId)?.documents || [];
  const issues = state.batches.filter(batch => batch.poId === poId && receivedDelivery(batch)).flatMap(batch => {
    const current = batch.receiptVersions?.at(-1);
    const issues: string[] = [];
    if (!current || current.archive.status !== "complete" || !current.archive.fileId || !current.archive.url) issues.push(`${batch.ref}: archive the current generated receipt.`);
    if (!documents.some(document => document.batchId === batch.id && document.kind === "Signed delivery receipt" && document.receiptVersion === current?.version && document.archive.status === "complete" && document.archive.fileId && document.archive.url)) issues.push(`${batch.ref}: upload and archive a signed delivery receipt for the current quantities.`);
    return issues;
  });
  if (documents.some(document => document.archive.status !== "complete" || !document.archive.fileId || !document.archive.url)) issues.push("Archive all uploaded accounting documents before completing review.");
  return issues;
}
