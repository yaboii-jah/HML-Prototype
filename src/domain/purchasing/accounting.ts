import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { canonicalMoney, record } from "../projects/projects.ts";

export const PO_STATUSES = ["draft", "submitted", "held", "returned", "approved", "rejected"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export type PaymentArrangement = {
  mode: "" | "upfront" | "credit";
  dueDate: string;
  relation: "" | "matches" | "differs";
  reason: string;
};
export const emptyPayment = (): PaymentArrangement => ({ mode: "", dueDate: "", relation: "", reason: "" });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function parsePayment(value: unknown): PaymentArrangement | null {
  const p = record(value);
  if (!p || (p.mode !== "" && p.mode !== "upfront" && p.mode !== "credit")
    || (p.relation !== "" && p.relation !== "matches" && p.relation !== "differs")
    || !(p.dueDate === "" || date(p.dueDate)) || typeof p.reason !== "string" || p.reason.length > 2000) return null;
  return { mode: p.mode, dueDate: p.dueDate, relation: p.relation, reason: p.reason };
}

export function paymentIssues(payment: PaymentArrangement | undefined, poDate: string, today: string): string[] {
  if (!payment?.mode) return ["Choose Upfront or Credit payment."];
  const issues: string[] = [];
  if (!payment.relation) issues.push("Confirm whether the payment arrangement matches the quotation.");
  if (payment.relation === "differs" && payment.reason.trim().length < 5) issues.push("Explain the agreed payment-term difference with at least five characters.");
  if (payment.mode === "upfront" && payment.dueDate) issues.push("Upfront orders must not carry a Credit due date.");
  if (payment.mode === "credit" && (!date(payment.dueDate) || !date(poDate) || payment.dueDate < poDate || payment.dueDate < today)) {
    issues.push("Credit due date must be on or after the PO date and the current Philippine date.");
  }
  return issues;
}

export type ReviewActor = { userId: string; name: string; activeRole: AuthRole };
export type PoBudget = {
  projectId: string; projectName: string; version: string;
  scopeId: string; scopeName: string;
  allocation: string | null; committed: string; uncommitted: string | null;
};
export type PoApproval = {
  id: string; version: string; actor: ReviewActor; at: string;
  archiveId: string | null; archiveState: "pending" | "running" | "failed" | "paused" | "complete" | null;
  message: string | null;
};
export type PoReview = {
  status: PoStatus; submissionId: string | null; approvalId: string | null;
  budget: PoBudget | null; preparerIds: string[]; submitterIds: string[];
  approvals: PoApproval[];
  events: { id: string; action: string; reason: string; actor: ReviewActor; at: string }[];
};
function parseActor(value: unknown): ReviewActor | null {
  const a = record(value);
  return a && uuid(a.userId) && typeof a.name === "string" && isAuthRole(a.activeRole)
    ? { userId: a.userId, name: a.name, activeRole: a.activeRole } : null;
}
export function parsePoReview(value: unknown): PoReview | null {
  const r = record(value);
  if (!r || !PO_STATUSES.includes(r.status as PoStatus)
    || !(r.submissionId === null || uuid(r.submissionId)) || !(r.approvalId === null || uuid(r.approvalId))
    || !Array.isArray(r.preparerIds) || !r.preparerIds.every(uuid)
    || !Array.isArray(r.submitterIds) || !r.submitterIds.every(uuid)
    || !Array.isArray(r.approvals) || !Array.isArray(r.events)) return null;
  let budget: PoBudget | null = null;
  if (r.budget !== null) {
    const b = record(r.budget);
    if (!b || !uuid(b.projectId) || !uuid(b.scopeId) || !version(b.version)
      || typeof b.projectName !== "string" || typeof b.scopeName !== "string"
      || !(b.allocation === null || canonicalMoney(b.allocation))
      || !canonicalMoney(b.committed) || !(b.uncommitted === null || canonicalMoney(b.uncommitted))) return null;
    budget = {
      projectId: b.projectId, scopeId: b.scopeId, projectName: b.projectName, scopeName: b.scopeName, version: b.version,
      allocation: b.allocation === null ? null : canonicalMoney(b.allocation), committed: canonicalMoney(b.committed)!,
      uncommitted: b.uncommitted === null ? null : canonicalMoney(b.uncommitted),
    };
  }
  const approvals: PoApproval[] = [], events: PoReview["events"] = [];
  for (const raw of r.approvals) {
    const a = record(raw), actor = parseActor(a?.actor);
    if (!a || !actor || !uuid(a.id) || !version(a.version) || typeof a.at !== "string"
      || !(a.archiveId === null || uuid(a.archiveId))
      || !(a.archiveState === null || ["pending", "running", "failed", "paused", "complete"].includes(String(a.archiveState)))
      || !(a.message === null || typeof a.message === "string")) return null;
    const archiveState = a.archiveState;
    if (archiveState !== null && archiveState !== "pending" && archiveState !== "running" && archiveState !== "failed" && archiveState !== "paused" && archiveState !== "complete") return null;
    approvals.push({ id: a.id, version: a.version, actor, at: a.at, archiveId: a.archiveId, archiveState, message: a.message });
  }
  for (const raw of r.events) {
    const e = record(raw), actor = parseActor(e?.actor);
    if (!e || !actor || !uuid(e.id) || typeof e.action !== "string" || typeof e.reason !== "string" || typeof e.at !== "string") return null;
    events.push({ id: e.id, actor, action: e.action, reason: e.reason, at: e.at });
  }
  return { status: r.status as PoStatus, submissionId: r.submissionId, approvalId: r.approvalId, budget,
    preparerIds: r.preparerIds, submitterIds: r.submitterIds, approvals, events };
}

export const ACCOUNTING_ACTIONS = ["submitPo", "recallPo", "approvePo", "holdPo", "returnPo", "rejectPo", "revokePo", "reconfirmPo", "retryPoArchive"] as const;
export type AccountingAction = (typeof ACCOUNTING_ACTIONS)[number];
export type AccountingCommand = {
  type: AccountingAction; requestId: string; mrfId: string; targetId: string;
  expectedVersion: string; expectedDemand: string; expectedPoVersion: string;
  expectedProjectVersion: string; expectedFamily: string; expectedMrfArchive: string;
  reason: string; archiveId?: string;
};
export function parseAccountingCommand(value: unknown): AccountingCommand | null {
  const c = record(value);
  if (!c || !ACCOUNTING_ACTIONS.includes(c.type as AccountingAction)
    || !uuid(c.requestId) || !uuid(c.mrfId) || !uuid(c.targetId)
    || !version(c.expectedVersion) || !version(c.expectedDemand) || !version(c.expectedPoVersion)
    || !version(c.expectedProjectVersion) || !version(c.expectedFamily)
    || !(c.expectedMrfArchive === "" || uuid(c.expectedMrfArchive))
    || typeof c.reason !== "string" || c.reason.length > 2000
    || (c.type !== "submitPo" && c.type !== "approvePo" && c.reason.trim().length < 5)
    || (c.type === "retryPoArchive" && !uuid(c.archiveId))
    || "snapshot" in c || "calculation" in c || "totals" in c) return null;
  return {
    type: c.type as AccountingAction, requestId: c.requestId, mrfId: c.mrfId, targetId: c.targetId,
    expectedVersion: c.expectedVersion, expectedDemand: c.expectedDemand, expectedPoVersion: c.expectedPoVersion,
    expectedProjectVersion: c.expectedProjectVersion, expectedFamily: c.expectedFamily, expectedMrfArchive: c.expectedMrfArchive,
    reason: c.reason.trim(), ...(c.type === "retryPoArchive" ? { archiveId: String(c.archiveId) } : {}),
  };
}
