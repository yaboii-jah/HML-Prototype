import type { DemoSnapshot, PO, POStatus } from "./types.ts";
import { procurementReady } from "./request-archive.ts";
import { paidTotal, poTotal } from "./selectors.ts";
export const poStatusLabel = (status: POStatus) => ({ draft: "Draft", submitted: "Awaiting Accounting", hold: "Accounting hold", returned: "Returned to Procurement", rejected: "Rejected", approved: "Accounting approved", released: "Released to Logistics" })[status];
export const openPaymentRequest = (state: DemoSnapshot, poId: string) => state.paymentRequests.find(value => value.poId === poId && !["rejected", "disbursed"].includes(value.status));
export function accountingNextAction(state: DemoSnapshot, po: PO): string {
  if (["submitted", "hold"].includes(po.status)) return "Review PO and budget";
  if (po.status === "draft" || po.status === "returned") return "Awaiting Procurement";
  if (po.status === "rejected") return "Closed";
  if (po.archive?.status === "pending") return "Archive approved PO";
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
  if (po.paymentMode === "upfront" && paidTotal(state, po.id) + 0.000001 < poTotal(state, po)) return "Full Finance disbursement is required before releasing an upfront PO.";
  return "";
}
