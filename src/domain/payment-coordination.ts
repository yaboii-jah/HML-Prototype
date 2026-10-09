import { isExternalPayment } from "./full-disbursement.ts";
import { philippineDate, validPaymentDate } from "./credit-terms.ts";
import { paidTotal, poTotal } from "./selectors.ts";
import type { AuditIdentity, DemoSnapshot, PaymentCoordination, PO } from "./types.ts";

export const COORDINATION_STATUSES = ["Pending", "Scheduled", "Processing", "Awaiting Accounting verification", "Delayed"] as const;
export function coordinationEligible(po: PO) {
  return isExternalPayment(po) && !!po.issuance && ["approved", "released"].includes(po.status);
}
export function coordinationBalance(state: DemoSnapshot, po: PO) {
  return Math.max(0, Math.round((poTotal(state, po) - paidTotal(state, po.id)) * 100) / 100);
}
export function coordinationStatus(state: DemoSnapshot, po: PO) {
  return coordinationBalance(state, po) === 0 ? "Settled" : po.paymentCoordination?.status || "Pending";
}
export function coordinationWarning(state: DemoSnapshot, po: PO, now = new Date()) {
  if (!coordinationEligible(po) || !coordinationBalance(state, po)) return "";
  const today = philippineDate(now);
  if (po.paymentDueDate && po.paymentDueDate < today) return "Agreed payment due date overdue";
  if (po.paymentCoordination?.plannedDate && po.paymentCoordination.plannedDate < today) return "Planned payment date missed";
  return "";
}
export function coordinationError(value: Pick<PaymentCoordination, "priority" | "status" | "plannedDate" | "note">) {
  if (!["Normal", "High", "Urgent"].includes(value.priority) || !COORDINATION_STATUSES.includes(value.status)) return "Choose a valid priority and coordination status.";
  if (value.plannedDate && !validPaymentDate(value.plannedDate)) return "Enter a valid planned payment date.";
  if (value.status === "Scheduled" && !value.plannedDate) return "Scheduled payments require a planned date.";
  if (value.status === "Delayed" && value.note.trim().length < 5) return "Explain the delay with at least five characters.";
  if (value.note.length > 2000) return "Keep coordination notes within 2,000 characters.";
  return "";
}
export function saveCoordination(po: PO, value: Pick<PaymentCoordination, "priority" | "status" | "plannedDate" | "note">, at: string, by: AuditIdentity, reason: string) {
  const record = { ...value, revision: (po.paymentCoordination?.revision || 0) + 1, at, by: structuredClone(by) };
  po.paymentCoordination = record;
  (po.coordinationHistory ||= []).push({ ...structuredClone(record), reason });
}
export function resetCoordination(po: PO, at: string, by: AuditIdentity, reason: string, settled = false) {
  saveCoordination(po, { priority: po.paymentCoordination?.priority || "Normal", status: "Pending", plannedDate: "", note: "" }, at, by, reason);
  po.coordinationHistory!.at(-1)!.outcome = settled ? "Settled" : "Pending";
}
export function coordinatedPOs(state: DemoSnapshot, includeSettled = false) {
  const rank = { Urgent: 0, High: 1, Normal: 2 };
  return state.pos.filter(po => coordinationEligible(po) && (includeSettled || coordinationBalance(state, po) > 0)).sort((a, b) =>
    rank[a.paymentCoordination?.priority || "Normal"] - rank[b.paymentCoordination?.priority || "Normal"] ||
    Number(!!coordinationWarning(state, b)) - Number(!!coordinationWarning(state, a)) ||
    ([a.paymentDueDate, a.paymentCoordination?.plannedDate].filter(Boolean).sort()[0] || "9999").localeCompare([b.paymentDueDate, b.paymentCoordination?.plannedDate].filter(Boolean).sort()[0] || "9999") ||
    a.createdAt.localeCompare(b.createdAt));
}
