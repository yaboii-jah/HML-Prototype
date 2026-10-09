import type { MRF, PO, PaymentProof } from "./types.ts";
export const requiresPMReview = (request?: MRF) => request?.workflow === "pm-external-v1";
export const isExternalCredit = (po?: PO) => po?.externalCredit === true && po.workflow === "pm-external-v1" && po.paymentMode === "credit";
export const isExternalPayment = (po?: PO) => isExternalCredit(po) || po?.workflow === "pm-external-v1" && po.paymentMode === "upfront";
export const proofAssigned = (po: PO, proofId: string) => !!po.creditPayments?.some(payment => payment.proofs.some(proof => proof.id === proofId));
export const canAttachPaymentProof = (po: PO) => isExternalPayment(po) && !!po.issuance && (isExternalCredit(po) ? ["approved", "released"].includes(po.status) : po.status === "approved" && !po.externalPayment);
export const servedPO = (po: PO) => isExternalPayment(po) ? !!po.issuance && ["approved", "released"].includes(po.status) : po.status === "released";
export const archivedProof = (proof: PaymentProof) => proof.archive.status === "complete" && !!proof.archive.fileId && !!proof.archive.url;
export const externalPaymentLabel = (po: PO) => isExternalCredit(po) ? !po.issuance ? "Awaiting supplier issuance" : po.status === "released" ? "Delivery cleared; payment tracked separately" : "Ready for delivery clearance" : po.status === "released" ? "Delivery cleared" : po.status === "rejected" ? "Closed" : po.status !== "approved" ? "Awaiting Accounting approval" : !po.issuance ? "Awaiting Procurement issuance" : po.externalPayment ? "Payment verified; awaiting clearance" : "Awaiting external payment verification";
