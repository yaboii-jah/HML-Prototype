import { deliveryEvidenceStatus, deliveryDocumentIssues, receivedDelivery } from "./delivery-archive.ts";
import { isSiteBatch, legFor, warehouseAvailableFor } from "./delivery-flow.ts";
import { archivedProof, isExternalPayment, proofAssigned, requiresPMReview } from "./full-disbursement.ts";
import { creditOverdue } from "./credit-terms.ts";
import { coordinationBalance, coordinationEligible, coordinationWarning } from "./payment-coordination.ts";
import { procurementReady } from "./request-archive.ts";
import { paidTotal, poItems, poTotal, schedulableFor } from "./selectors.ts";
import { reviewIsCurrent } from "./stock-suitability.ts";
import { requestSourcing, transferDocumentGaps, transferUnscheduled } from "./stock-transfers.ts";
import { openPaymentRequest, releaseBlocker } from "./workflow.ts";
import type { DemoSnapshot, Role } from "./types.ts";

export type WorkflowAction = Readonly<{
  id: string; requestId: string; recordId: string; siteId: string; department: Role;
  label: string; detail: string; href: string; state: "ready" | "blocked"; blocker?: string; since: string; attention: boolean;
}>;

/** Current work is projected from authoritative business records, never stored as another status. */
export function workflowActions(state: DemoSnapshot, requestId?: string): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  for (const request of state.requests.filter(r => !requestId || r.id === requestId)) {
    if (request.status === "rejected") continue;
    const add = (code: string, department: Role, record: { id: string; ref?: string; updatedAt?: string; createdAt?: string }, label: string, href: string, detail = "", blocker = "", siteId = request.siteId, attention = false) => actions.push({ id: `${code}/${record.id}`, requestId: request.id, recordId: record.id, siteId, department, label: `${label}${record.ref ? `: ${record.ref}` : ""}`, detail, href, state: blocker ? "blocked" : "ready", blocker: blocker || undefined, since: record.updatedAt || record.createdAt || request.updatedAt, attention: attention || !!blocker });
    const requestHref = `/requests/${request.id}`;
    const reviewRole = requiresPMReview(request) ? "Project Manager" : "Procurement";
    if (request.status === "draft" || request.status === "returned" || request.correction?.status === "requested") add("revise-request", "Site Personnel", request, request.status === "draft" ? "Complete request" : "Revise request", requestHref, request.correction?.reason || request.reason || "Complete and submit the material request", "", request.siteId, request.status !== "draft");
    if (request.status === "submitted" || request.correction?.status === "submitted") add("review-request", reviewRole, request, "Review request", requestHref, "Review the submitted materials and supporting document");
    const readyForSourcing = Boolean(procurementReady(request));
    const requestBlocker = readyForSourcing ? "" : request.correction ? "Complete the requested MRF correction and review." : request.status !== "approved" ? "Awaiting MRF approval." : "Archive the approved MRF.";
    if (request.status === "approved" && request.archive?.status === "pending") add("archive-request", reviewRole, request, "Archive approved MRF", requestHref, request.archive.error || "Complete the approved request archive", "", request.siteId, !!request.archive.error);
    if (request.status === "approved" && request.items.some(i => requestSourcing(state, request, i).unassigned > 0)) add("source-request", "Procurement", request, "Source materials", `${requestHref}/quotes`, "Compare available site stock and supplier quotations", requestBlocker);
    for (const po of state.pos.filter(p => p.mrfId === request.id && p.status !== "rejected")) {
      const poHref = `/purchase-orders/${po.id}`, accountingHref = `/accounting/${po.id}`;
      if (["draft", "returned"].includes(po.status)) { add("prepare-po", "Procurement", po, "Prepare PO", poHref, po.reviewReason || "Review and submit the purchase order", requestBlocker, request.siteId, po.status === "returned"); continue; }
      if (["submitted", "hold"].includes(po.status)) { add("review-po", "Accounting / Auditing", po, "Review PO and budget", accountingHref, po.reviewReason || "Review supplier, materials and payment arrangement", requestBlocker, request.siteId, po.status === "hold"); continue; }
      if (po.archive?.status === "pending") add("archive-po", "Accounting / Auditing", po, "Archive approved PO", accountingHref, po.archive.error || "Complete the approved purchase order archive", "", request.siteId, !!po.archive.error);
      if (isExternalPayment(po)) {
        if (!po.issuance) add("issue-po", "Procurement", po, "Issue PO to supplier", poHref, "Confirm supplier issuance after the approved archive is ready", requestBlocker || (po.archive?.status !== "complete" ? "Archive the approved PO first." : ""));
        if (coordinationEligible(po) && coordinationBalance(state, po) > 0) {
          add("coordinate-payment", "Finance", po, "Coordinate payment", `/finance/${po.id}`, coordinationWarning(state, po) || po.paymentCoordination?.status || "Payment is processed outside the app", "", request.siteId, creditOverdue(state, po));
          const proofs = (po.paymentProofs || []).filter(p => archivedProof(p) && !proofAssigned(po, p.id));
          add("verify-payment", "Accounting / Auditing", po, proofs.length ? "Verify external payment" : "Attach payment proof", accountingHref, proofs.length ? "Verify the actual supplier payment against archived evidence" : "Upload and archive proof before payment verification", "", request.siteId, creditOverdue(state, po));
        }
      } else if (paidTotal(state, po.id) + .000001 < poTotal(state, po)) {
        const payment = openPaymentRequest(state, po.id);
        if (!payment || ["draft", "returned"].includes(payment.status)) add("prepare-payment", "Accounting / Auditing", payment || po, "Prepare payment request", accountingHref, payment?.reason || "Prepare the remaining supplier payment", "", request.siteId, payment?.status === "returned");
        else add(payment.status === "approved" ? "disburse-payment" : "review-payment", "Finance", payment, payment.status === "approved" ? "Disburse payment" : "Review payment request", `/finance/${po.id}`, payment.reason || "Review and process the supplier payment", "", request.siteId, payment.status === "hold");
      }
      if (po.status === "approved") add("clear-delivery", "Accounting / Auditing", po, "Confirm delivery clearance", accountingHref, "Release this PO for Logistics", releaseBlocker(state, po));
      if (po.status === "released" && poItems(state, po).some(i => schedulableFor(state, po, i.id) > 0)) add("schedule-delivery", "Logistics", po, "Schedule delivery", `/deliveries/new?poId=${po.id}`, "Supplier quantities are available to schedule", requestBlocker);
      const batches = state.batches.filter(b => b.poId === po.id);
      for (const batch of batches) {
        const href = `/deliveries/${batch.id}`;
        if (batch.status === "expected" && batch.leg) add("dispatch-batch", "Logistics", batch, "Dispatch", href, "Confirm dispatch for this delivery trip", requestBlocker || (po.status !== "released" ? "Awaiting Accounting delivery clearance." : ""));
        if (batch.status === "dispatched" || !batch.leg && batch.status === "expected") add("receive-batch", isSiteBatch(batch) ? "Site Personnel" : "Procurement", batch, isSiteBatch(batch) ? "Receive" : "Receive at warehouse", href, "Confirm quantities and explain shortages or damage");
        if (isSiteBatch(batch) && batch.status === "confirmed") add("post-batch", "Site Personnel", batch, "Post accepted stock", href, "Post accepted quantities to site inventory");
        if (legFor(batch) === "supplier-warehouse" && batch.status === "confirmed" && batch.lines.some(l => warehouseAvailableFor(state, batch.id, l.itemId) > 0)) add("forward-batch", "Logistics", batch, "Forward", href, "Schedule warehouse-held stock onward to the site", requestBlocker);
        if (receivedDelivery(batch)) {
          const evidence = deliveryEvidenceStatus(state, batch);
          if (!evidence.generatedArchived || !evidence.signedArchived) add("receipt-evidence", isSiteBatch(batch) ? "Site Personnel" : "Procurement", batch, !evidence.signedArchived ? evidence.signedFailed ? "Retry signed receipt archive" : evidence.signedPending ? "Finish signed receipt archive" : "Upload signed receipt" : "Archive generated receipt", `${href}#delivery-documents`, !evidence.generatedArchived && !evidence.signedArchived ? "Generated and signed receipt archives are required" : "Complete the current receipt version", "", request.siteId, evidence.signedFailed);
        }
      }
      if (state.accounting.find(r => r.poId === po.id)?.review !== "Complete" && (batches.some(receivedDelivery) || (state.accounting.find(r => r.poId === po.id)?.documents || []).length > 0)) {
        const gaps = deliveryDocumentIssues(state, po.id);
        add("review-documents", "Accounting / Auditing", po, "Review supporting documents", accountingHref, "Complete the invoice and receipt review", gaps.join(" "));
      }
    }
    for (const transfer of (state.stockTransfers || []).filter(t => t.requestId === request.id)) {
      const href = `/stock-transfers/${transfer.id}`, trips = (state.transferDeliveries || []).filter(d => d.transferId === transfer.id);
      if (transfer.status === "pending") add("release-stock", "Site Personnel", transfer, "Confirm stock release", href, `To ${transfer.destination.name}`, requestBlocker, transfer.sourceSiteId);
      if (transfer.status === "approved" && transfer.lines.some(l => transferUnscheduled(state, transfer, l.id) > 0)) add("schedule-transfer", "Logistics", transfer, "Schedule transfer", href, `${transfer.origin.name} → ${transfer.destination.name}`, requestBlocker);
      const gaps = transferDocumentGaps(state, transfer);
      for (const trip of trips) {
        if (trip.status === "expected") add("dispatch-transfer", "Logistics", trip, "Dispatch", href, "Dispatch this stock transfer trip", requestBlocker);
        if (["dispatched", "confirmed"].includes(trip.status)) add(trip.status === "confirmed" ? "post-transfer" : "receive-transfer", "Site Personnel", trip, trip.status === "confirmed" ? "Post transferred stock" : "Receive transferred stock", href, `From ${transfer.origin.name}`, "", transfer.destinationSiteId);
        if (["confirmed", "posted"].includes(trip.status) && gaps.some(g => g.startsWith(trip.ref))) add("transfer-evidence", "Site Personnel", trip, "Complete transfer receipts", href, gaps.filter(g => g.startsWith(trip.ref)).join(" "), "", transfer.destinationSiteId);
      }
      if (trips.some(d => ["confirmed", "posted"].includes(d.status)) && transfer.documentReview?.status !== "Complete") add("review-transfer", "Accounting / Auditing", transfer, "Review transfer documents", href, "Complete the transfer document review", gaps.join(" "));
    }
    for (const review of (state.stockSuitabilityReviews || []).filter(r => r.requestId === request.id && reviewIsCurrent(state, r))) {
      if (review.status === "pending") add("review-stock", "Site Personnel", review, `Review alternative stock: ${review.requestedName}`, `${requestHref}#stock-suitability`, review.explanation, requestBlocker, review.destinationSiteId);
      if (review.status === "approved") add("request-stock", "Procurement", review, `Request approved stock release: ${review.requestedName}`, `${requestHref}#stock-suitability`, "Recheck current source availability", requestBlocker);
    }
  }
  return actions;
}

export function canActOnWorkflowAction(action: WorkflowAction, role: Role | null | undefined, siteIds: readonly string[]): boolean {
  return action.state === "ready" && action.department === role && (role !== "Site Personnel" || siteIds.includes(action.siteId));
}
