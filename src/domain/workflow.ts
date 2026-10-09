import { archivedProof, isExternalCredit, isExternalPayment, externalPaymentLabel } from "./full-disbursement.ts";
import type { DemoSnapshot, PO, POStatus } from "./types.ts";
import { procurementReady } from "./request-archive.ts";
import { creditOverdue } from "./credit-terms.ts";
import { paidTotal, poTotal } from "./selectors.ts";
export const poStatusLabel = (status: POStatus) => ({ draft: "Draft", submitted: "Awaiting Accounting", hold: "Accounting hold", returned: "Returned to Procurement", rejected: "Rejected", approved: "Accounting approved", released: "Released to Logistics" })[status];
export const openPaymentRequest = (state: DemoSnapshot, poId: string) => state.paymentRequests.find(value => value.poId === poId && !["rejected", "disbursed"].includes(value.status));
export function accountingNextAction(state: DemoSnapshot, po: PO): string {
  if (["submitted", "hold"].includes(po.status)) return "Review PO and budget";
  if (po.status === "draft" || po.status === "returned") return "Awaiting Procurement";
  if (po.status === "rejected") return "Closed";
  if (po.archive?.status === "pending") return "Archive approved PO";
  if (isExternalCredit(po)) {
    if (!po.issuance) return "Awaiting supplier issuance";
    if (po.status === "approved") return "Confirm delivery clearance";
    if (paidTotal(state, po.id) < poTotal(state, po)) return creditOverdue(state, po) ? "Verify overdue credit payment" : "Verify external credit payment";
    return state.accounting.find(record => record.poId === po.id)?.review === "Complete" ? "Up to date" : "Review supporting documents";
  }
  if (isExternalPayment(po)) return po.status === "released" ? state.accounting.find(record => record.poId === po.id)?.review === "Complete" ? "Up to date" : "Review supporting documents" : externalPaymentLabel(po);
  const payment = openPaymentRequest(state, po.id);
  if (payment && ["draft", "returned"].includes(payment.status)) return "Prepare payment request";
  if (po.status === "approved" && !releaseBlocker(state, po)) return "Release to Logistics";
  if (paidTotal(state, po.id) + 0.000001 < poTotal(state, po)) {
    if (!payment) return "Prepare payment request";
    return payment.status === "approved" ? "Awaiting Finance disbursement" : "Awaiting Finance review";
  }
  return state.accounting.find(record => record.poId === po.id)?.review === "Complete" ? "Up to date" : "Review supporting documents";
}

export function releaseBlocker(state: DemoSnapshot, po: PO): string {
  if (po.status !== "approved") return "Accounting must approve this PO before release.";
  if (!procurementReady(state.requests.find(request => request.id === po.mrfId))) return "Complete the MRF correction and archive before release.";
  if (po.archive?.status !== "complete") return "Archive the approved PO before releasing it to Logistics.";
  if (!po.paymentMode) return "Accounting must confirm upfront payment or credit terms.";
  if (isExternalPayment(po)) {
    if (!po.issuance) return "Procurement must issue the PO to its supplier first.";
    if (!isExternalCredit(po) && (!po.externalPayment || !po.externalPayment.proofs.length || !po.externalPayment.proofs.every(archivedProof) || Math.abs(po.externalPayment.amount - poTotal(state, po)) > .000001)) return "Accounting must verify full external payment with archived proof before delivery clearance.";
  }
  if (po.paymentMode === "upfront" && paidTotal(state, po.id) + 0.000001 < poTotal(state, po)) return "Full Finance disbursement is required before releasing an upfront PO.";
  return "";
}
