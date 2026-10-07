import { auditRecords, type AuditRecord } from "./audit.ts";
import { isSiteBatch, normalizedQuantity, warehouseAvailableFor, warehouseHeldFor } from "./delivery-flow.ts";
import { roundMoney } from "./pricing.ts";
import { scopeName } from "./scope-budgets.ts";
import { acceptedFor, orderedFor, paidTotal, poItems, poTotal, schedulableFor } from "./selectors.ts";
import type { Activity, Batch, DemoSnapshot, Item, MRF, PaymentRequest, PO } from "./types.ts";

export type MonitoringState = "pending" | "partial" | "complete" | "blocked" | "inactive";
export type MonitoringMilestone = Readonly<{ state: MonitoringState; label: string; detail: string }>;
export type MaterialCoverage = Readonly<{ item: Item; approved: number; released: number; accepted: number; posted: number }>;
export type RequestMonitoring = Readonly<{
  request: MRF; projectName: string; scopeName: string;
  review: MonitoringMilestone; served: MonitoringMilestone; finance: MonitoringMilestone; logistics: MonitoringMilestone; delivered: MonitoringMilestone; stock: MonitoringMilestone;
  coverage: readonly MaterialCoverage[]; pos: readonly PO[]; batches: readonly Batch[]; paymentRequests: readonly PaymentRequest[];
  amounts: Readonly<{ payable: number; paid: number; outstanding: number }>;
  flags: Readonly<{ forFinance: boolean; forLogistics: boolean; needsAttention: boolean }>;
  latestActivity?: Activity;
}>;
const milestone = (state: MonitoringState, label: string, detail = ""): MonitoringMilestone => ({ state, label, detail });
const sum = (values: number[]) => normalizedQuantity(values.reduce((total, value) => total + value, 0));
const validRequirement = (row: MaterialCoverage) => Number.isFinite(row.item.quantity) && row.item.quantity > 0;
const fullCoverage = (coverage: MaterialCoverage[], key: "approved" | "released" | "accepted" | "posted") => coverage.length > 0 && coverage.every(row => validRequirement(row) && row[key] >= row.item.quantity);
function coverageMilestone(coverage: MaterialCoverage[], key: "released" | "accepted" | "posted", pending: string, partial: string, complete: string) {
  const completeLines = coverage.filter(row => validRequirement(row) && row[key] >= row.item.quantity).length;
  const any = coverage.some(row => row[key] > 0);
  return milestone(fullCoverage(coverage, key) ? "complete" : any ? "partial" : "pending", fullCoverage(coverage, key) ? complete : any ? partial : pending, `${completeLines} of ${coverage.length} materials fully covered`);
}
export function requestMonitoring(state: DemoSnapshot, requestId: string, records: Map<string, AuditRecord> = auditRecords(state)): RequestMonitoring | undefined {
  const request = state.requests.find(value => value.id === requestId);
  if (!request) return undefined;
  const pos = state.pos.filter(po => po.mrfId === requestId);
  const active = pos.filter(po => po.status !== "rejected"), approved = active.filter(po => ["approved", "released"].includes(po.status)), released = active.filter(po => po.status === "released");
  const poIds = new Set(pos.map(po => po.id)), activeIds = new Set(active.map(po => po.id)), approvedIds = new Set(approved.map(po => po.id));
  const batches = state.batches.filter(batch => poIds.has(batch.poId)), activeBatches = batches.filter(batch => activeIds.has(batch.poId));
  const paymentRequests = state.paymentRequests.filter(payment => poIds.has(payment.poId)), openPayments = paymentRequests.filter(payment => approvedIds.has(payment.poId) && !["rejected", "disbursed"].includes(payment.status));
  const coverage = request.items.map(item => ({
    item,
    approved: sum(approved.map(po => orderedFor(state, po, item.id))),
    released: sum(released.map(po => orderedFor(state, po, item.id))),
    accepted: sum(active.map(po => acceptedFor(state, po.id, item.id))),
    posted: sum(activeBatches.filter(batch => isSiteBatch(batch) && batch.status === "posted").flatMap(batch => batch.lines.filter(line => line.itemId === item.id).map(line => line.accepted))),
  }));
  const payable = roundMoney(approved.reduce((total, po) => total + poTotal(state, po), 0)), paid = roundMoney(approved.reduce((total, po) => total + paidTotal(state, po.id), 0)), outstanding = roundMoney(approved.reduce((total, po) => total + Math.max(0, poTotal(state, po) - paidTotal(state, po.id)), 0));
  const poHeld = active.filter(po => po.status === "hold").length, poReturned = active.filter(po => po.status === "returned").length;
  const paymentHeld = openPayments.filter(payment => payment.status === "hold").length, paymentReturned = openPayments.filter(payment => payment.status === "returned").length;
  const forFinance = openPayments.filter(payment => ["submitted", "hold", "approved"].includes(payment.status)).length;
  const toDisburse = openPayments.filter(payment => payment.status === "approved").length;
  const expected = activeBatches.filter(batch => batch.status === "expected").length, transit = activeBatches.filter(batch => batch.status === "dispatched").length;
  const heldAtWarehouse = activeBatches.filter(batch => batch.lines.some(line => warehouseHeldFor(state, batch.id, line.itemId) > 0)).length;
  const forwardable = activeBatches.filter(batch => batch.lines.some(line => warehouseAvailableFor(state, batch.id, line.itemId) > 0)).length;
  const supplierCapacity = released.some(po => poItems(state, po).some(item => schedulableFor(state, po, item.id) > 0));
  const awaitingPosting = activeBatches.filter(batch => isSiteBatch(batch) && batch.status === "confirmed").length;
  const receiptIssues = activeBatches.filter(batch => batch.lines.some(line => line.accepted < line.expected && line.issue.trim())).length;
  const archivePending = request.archive?.status === "pending" || active.some(po => po.archive?.status === "pending");
  const hasBlocker = request.status === "returned" || !!request.correction || poHeld > 0 || poReturned > 0 || paymentHeld > 0 || paymentReturned > 0 || archivePending || receiptIssues > 0 && !fullCoverage(coverage, "accepted");
  const review = request.status === "approved" ? milestone("complete", "Approved", request.correction ? `Correction ${request.correction.status}` : request.archive?.status === "pending" ? "MRF archive pending" : "Procurement reviewed") : request.status === "rejected" ? milestone("inactive", "Rejected", request.reason || "") : request.status === "returned" ? milestone("blocked", "Returned", request.reason || "") : milestone("pending", request.status === "draft" ? "Draft" : "For Procurement", request.status === "draft" ? "Awaiting submission" : "Review required");
  const servedBase = coverageMilestone(coverage, "released", "Not served", "Partly served", "Served");
  const poProblems = [poHeld ? `${poHeld} PO on hold` : "", poReturned ? `${poReturned} PO returned` : ""].filter(Boolean).join(" · ");
  const served = milestone(servedBase.state === "pending" && poProblems ? "blocked" : servedBase.state, servedBase.label, `${servedBase.detail}${poProblems ? ` · ${poProblems}` : ""}`);
  const paidComplete = fullCoverage(coverage, "approved") && approved.length > 0 && approved.every(po => poTotal(state, po) > 0 && paidTotal(state, po.id) + .000001 >= poTotal(state, po));
  const finance = paidComplete ? milestone("complete", "Paid", "All requested goods covered by paid approved POs") : paymentHeld ? milestone("blocked", "On hold", `${paymentHeld} Finance request on hold`) : paymentReturned ? milestone("blocked", "Returned to Accounting", `${paymentReturned} payment request to revise`) : forFinance ? milestone(paid > 0 ? "partial" : "pending", "For Finance", `${forFinance} requests · ${toDisburse} ready to disburse`) : approved.length ? milestone(paid > 0 ? "partial" : "pending", paid > 0 ? "Partly paid" : "Accounting preparation", outstanding > 0 ? "Payment request preparation required" : "Current POs paid · further purchasing required") : milestone("pending", "Not ready", "Awaiting Accounting PO approval");
  const delivered = coverageMilestone(coverage, "accepted", "Not delivered", "Partly delivered", "Delivered");
  const stockBase = coverageMilestone(coverage, "posted", "Not posted", "Partly posted", "Stock posted");
  const stock = milestone(stockBase.state, stockBase.label, `${stockBase.detail}${awaitingPosting ? ` · ${awaitingPosting} batches to post` : ""}`);
  const forLogistics = expected > 0 || forwardable > 0 || supplierCapacity;
  const logistics = delivered.state === "complete" ? milestone("complete", "At site", "Requested quantities received at site") : forLogistics ? milestone("pending", "For Logistics", `${expected} to dispatch · ${forwardable} warehouse receipts to forward${supplierCapacity ? " · supplier scheduling available" : ""}`) : transit ? milestone("pending", "In transit", `${transit} legs awaiting Procurement/site receipt`) : heldAtWarehouse ? milestone("pending", "At warehouse", `${heldAtWarehouse} warehouse receipts holding goods`) : released.length ? milestone(receiptIssues ? "blocked" : "partial", receiptIssues ? "Delivery discrepancy" : "Further purchasing needed", receiptIssues ? `${receiptIssues} receipts with shortage/damage` : "Released PO quantities received; MRF coverage remains partial") : milestone("pending", "Awaiting release", approved.length ? "Accounting release required" : "PO approval/release required");
  const latestActivity = state.activity.filter(event => event.requestId ? event.requestId === requestId : records.get(event.entity)?.requestId === requestId).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
  return {
    request, projectName: state.sites.find(site => site.id === request.siteId)?.name || "Project not recorded", scopeName: scopeName(state, request.scopeId),
    review, served, finance, logistics, delivered, stock, coverage, pos, batches, paymentRequests,
    amounts: { payable, paid, outstanding }, flags: { forFinance: forFinance > 0 && !paidComplete, forLogistics: forLogistics && delivered.state !== "complete", needsAttention: hasBlocker }, latestActivity,
  };
}
export function monitoringRequests(state: DemoSnapshot, siteId?: string): RequestMonitoring[] {
  const records = auditRecords(state), project = siteId || state.siteFilter;
  return state.requests.filter(request => project === "all" || request.siteId === project).map(request => requestMonitoring(state, request.id, records)!).sort((a, b) => Date.parse(b.latestActivity?.at || b.request.createdAt) - Date.parse(a.latestActivity?.at || a.request.createdAt));
}
