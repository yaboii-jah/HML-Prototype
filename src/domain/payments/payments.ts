import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { canonicalMoney, moneyCents, record } from "../projects/projects.ts";
import { parseActor, type ReviewActor } from "../purchasing/accounting.ts";
import { validQuoteFile, type QuoteFile, type QuoteGroup, type QuoteJob } from "../quotations/drafts.ts";

export const PAYMENT_METHODS = ["Bank transfer", "Check", "Cash", "Other"] as const;
export const PRIORITIES = ["Normal", "High", "Urgent"] as const;
export const COORDINATION_STATUSES = ["Pending", "Scheduled", "Processing", "Awaiting Accounting verification", "Delayed"] as const;
export type PaymentBody = { amount: string; method: string; reference: string; date: string; note: string; other: string; duplicateReason: string };
export type PaymentPlan = { priority: string; status: string; plannedDate: string; note: string };
export const emptyPaymentBody = (): PaymentBody => ({ amount: "", method: "", reference: "", date: "", note: "", other: "", duplicateReason: "" });
export const emptyPlan = (): PaymentPlan => ({ priority: "Normal", status: "Pending", plannedDate: "", note: "" });
const uuid = (v: unknown): v is string => typeof v === "string" && UUID_PATTERN.test(v);
const version = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2000;
export const paymentDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const philippineToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const instant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function parsePaymentBody(value: unknown): PaymentBody | null {
  const b = record(value);
  if (!b || !text(b.amount) || !(b.amount === "" || (moneyCents(b.amount) ?? BigInt(0)) > BigInt(0))
    || !text(b.method) || !(b.method === "" || PAYMENT_METHODS.some(m => m === b.method))
    || !text(b.reference) || !text(b.date) || !(b.date === "" || paymentDate(b.date))
    || !text(b.note) || !text(b.other) || !text(b.duplicateReason)) return null;
  return { amount: b.amount === "" ? "" : canonicalMoney(b.amount)!, method: b.method, reference: b.reference.trim(), date: b.date, note: b.note, other: b.other, duplicateReason: b.duplicateReason };
}
export function parsePlan(value: unknown): PaymentPlan | null {
  const p = record(value);
  if (!p || !PRIORITIES.some(v => v === p.priority) || !COORDINATION_STATUSES.some(v => v === p.status)
    || !text(p.plannedDate) || !(p.plannedDate === "" || paymentDate(p.plannedDate)) || !text(p.note)
    || p.status === "Scheduled" && !p.plannedDate || p.status === "Delayed" && p.note.trim().length < 5) return null;
  return { priority: String(p.priority), status: String(p.status), plannedDate: p.plannedDate, note: p.note };
}
/** Cumulative gross budget consumption, in exact half-up cents. No tax remittance inference. */
export function grossSpent(gross: string, net: string, paid: string, noCashConfirmed = false): string {
  const g = moneyCents(gross), n = moneyCents(net), p = moneyCents(paid);
  if (g === null || n === null || p === null || g <= BigInt(0) || p > n) throw Error("Invalid settlement amounts");
  const cents = n === BigInt(0) ? (noCashConfirmed ? g : BigInt(0)) : (g * p * BigInt(2) + n) / (n * BigInt(2));
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
export type PaymentDraft = {
  id: string; poId: string; body: PaymentBody; state: "draft" | "verified" | "cancelled";
  version: string; fileVersion: string; replacesId: string | null; creatorName: string; createdAt: string;
  files: QuoteFile[]; replacementFiles: QuoteFile[]; groups: QuoteGroup[]; jobs: QuoteJob[];
};
export type PaymentEvent = { id: string; actor: ReviewActor; at: string; action?: string; reason?: string; reversal?: { reason: string; actor: ReviewActor; at: string } | null };
export type Coordination = PaymentEvent & { plan: PaymentPlan; ledgerVersion: string };
export type Verification = PaymentEvent & { amount: string; body: PaymentBody; files: string[]; reversal: { reason: string; actor: ReviewActor; at: string } | null };
export type PaymentRecord = {
  poId: string; ref: string; vendor: string; projectId: string; poDate: string; mode: "upfront" | "credit"; dueDate: string;
  version: string; ledgerVersion: string; gross: string; net: string; paid: string; outstanding: string; spent: string;
  settled: boolean; noCashId: string | null; cleared: boolean; blockers: string[]; sentAt: string;
  coordinators: string[]; settlers: string[]; coordination: Coordination | null;
  drafts: PaymentDraft[]; verifications: Verification[]; coordinationHistory: Coordination[]; clearanceHistory: PaymentEvent[]; noCashHistory: PaymentEvent[];
};
export type PaymentsView = { role: AuthRole; actorId: string; records: PaymentRecord[] };
function parseFiles(value: unknown): QuoteFile[] | null {
  if (!Array.isArray(value) || value.some(v => !validQuoteFile(v) || !uuid(record(v)?.id))) return null;
  return value.map(v => ({ id: v.id, name: v.name, mime: v.mime, size: v.size, sha256: v.sha256 }));
}
function parseEvent(value: unknown): PaymentEvent | null {
  const e = record(value), actor = parseActor(e?.actor);
  if (!e || !actor || !uuid(e.id) || !instant(e.at) || ("reason" in e && !text(e.reason)) || ("action" in e && !text(e.action))) return null;
  const result: PaymentEvent = { id: e.id, actor, at: e.at };
  if (typeof e.reason === "string") result.reason = e.reason;
  if (typeof e.action === "string") result.action = e.action;
  if ("reversal" in e) {
    if (e.reversal === null) result.reversal = null;
    else {
      const x = record(e.reversal), by = parseActor(x?.actor);
      if (!x || !by || !text(x.reason) || !instant(x.at)) return null;
      result.reversal = { actor: by, reason: x.reason, at: x.at };
    }
  }
  return result;
}
function parseCoordination(value: unknown): Coordination | null {
  const e = parseEvent(value), r = record(value), plan = parsePlan(r?.plan);
  return e && plan && version(r?.ledgerVersion) ? { ...e, plan, ledgerVersion: r.ledgerVersion } : null;
}
export function parsePaymentDraft(value: unknown): PaymentDraft | null {
  const d = record(value), body = parsePaymentBody(d?.body), files = parseFiles(d?.files), replacementFiles = parseFiles(d?.replacementFiles);
  if (!d || !body || !files || !replacementFiles || !uuid(d.id) || !uuid(d.poId) || !version(d.version) || !version(d.fileVersion)
    || !(d.replacesId === null || uuid(d.replacesId)) || !text(d.creatorName) || !instant(d.createdAt)
    || !(d.state === "draft" || d.state === "verified" || d.state === "cancelled") || !Array.isArray(d.groups) || !Array.isArray(d.jobs)) return null;
  const groups: QuoteGroup[] = [], jobs: QuoteJob[] = [];
  for (const raw of d.groups) {
    const g = record(raw);
    if (!g || !uuid(g.id) || !["uploading", "conflict"].includes(String(g.state)) || !Array.isArray(g.files) || !g.files.every(uuid) || !Array.isArray(g.uploads)) return null;
    const uploads = [];
    for (const upload of g.uploads) {
      const f = record(upload);
      if (!f || !uuid(f.id) || !validQuoteFile(f) || !text(f.state) || !Number.isSafeInteger(f.offset) || Number(f.offset) < 0 || !instant(f.expiresAt)) return null;
      uploads.push({ id: f.id, name: String(f.name), mime: String(f.mime), size: Number(f.size), sha256: String(f.sha256), state: f.state, offset: Number(f.offset), expiresAt: f.expiresAt });
    }
    groups.push({ id: g.id, state: String(g.state), files: g.files, uploads });
  }
  for (const raw of d.jobs) {
    const j = record(raw);
    if (!j || !uuid(j.id) || !["validate", "cleanup"].includes(String(j.kind)) || !["pending", "running", "failed", "paused"].includes(String(j.state)) || !(j.message === null || text(j.message))) return null;
    jobs.push({ id: j.id, kind: String(j.kind), state: String(j.state), message: j.message });
  }
  return { id: d.id, poId: d.poId, body, state: d.state, version: d.version, fileVersion: d.fileVersion, replacesId: d.replacesId, creatorName: d.creatorName, createdAt: d.createdAt, files, replacementFiles, groups, jobs };
}
export function parsePaymentsView(value: unknown): PaymentsView | null {
  const view = record(value);
  if (!view || !isAuthRole(view.role) || view.role === "Site Personnel" || !uuid(view.actorId) || !Array.isArray(view.records)) return null;
  const records: PaymentRecord[] = [];
  for (const raw of view.records) {
    const r = record(raw);
    if (!r || !uuid(r.poId) || !uuid(r.projectId) || !text(r.ref) || !text(r.vendor) || !paymentDate(r.poDate)
      || !(r.mode === "upfront" || r.mode === "credit") || !(r.dueDate === "" || paymentDate(r.dueDate)) || !version(r.version) || !version(r.ledgerVersion)
      || ![r.gross, r.net, r.paid, r.outstanding, r.spent].every(v => canonicalMoney(v) !== null)
      || typeof r.settled !== "boolean" || typeof r.cleared !== "boolean" || !(r.noCashId === null || uuid(r.noCashId))
      || !instant(r.sentAt) || !Array.isArray(r.blockers) || !r.blockers.every(text)
      || !Array.isArray(r.coordinators) || !r.coordinators.every(uuid) || !Array.isArray(r.settlers) || !r.settlers.every(uuid)
      || !Array.isArray(r.drafts) || !Array.isArray(r.verifications) || !Array.isArray(r.coordinationHistory) || !Array.isArray(r.clearanceHistory) || !Array.isArray(r.noCashHistory)) return null;
    const drafts = r.drafts.map(parsePaymentDraft), coordination = r.coordination === null ? null : parseCoordination(r.coordination);
    const coordinationHistory = r.coordinationHistory.map(parseCoordination), clearanceHistory = r.clearanceHistory.map(parseEvent), noCashHistory = r.noCashHistory.map(parseEvent);
    if (drafts.some(d => !d) || coordinationHistory.some(d => !d) || clearanceHistory.some(d => !d) || noCashHistory.some(d => !d) || r.coordination !== null && !coordination) return null;
    const verifications: Verification[] = [];
    for (const rawPayment of r.verifications) {
      const v = record(rawPayment), e = parseEvent(v), body = parsePaymentBody(v?.body);
      if (!v || !e || !body || canonicalMoney(v.amount) === null || !Array.isArray(v.files) || !v.files.every(uuid) || !("reversal" in e)) return null;
      verifications.push({ ...e, amount: String(v.amount), body, files: v.files, reversal: e.reversal ?? null });
    }
    records.push({ poId: r.poId, ref: r.ref, vendor: r.vendor, projectId: r.projectId, poDate: r.poDate, mode: r.mode, dueDate: r.dueDate,
      version: r.version, ledgerVersion: r.ledgerVersion, gross: String(r.gross), net: String(r.net), paid: String(r.paid), outstanding: String(r.outstanding), spent: String(r.spent),
      settled: r.settled, noCashId: r.noCashId, cleared: r.cleared, blockers: r.blockers, sentAt: r.sentAt, coordinators: r.coordinators, settlers: r.settlers,
      coordination, drafts: drafts.filter((d): d is PaymentDraft => d !== null), verifications, coordinationHistory: coordinationHistory.filter((d): d is Coordination => d !== null),
      clearanceHistory: clearanceHistory.filter((d): d is PaymentEvent => d !== null), noCashHistory: noCashHistory.filter((d): d is PaymentEvent => d !== null) });
  }
  return { role: view.role, actorId: view.actorId, records };
}
export const PAYMENT_ACTIONS = ["coordinate", "saveDraft", "cancelDraft", "verify", "reverse", "noCash", "reverseNoCash", "clear", "hold"] as const;
export type PaymentCommand = { type: (typeof PAYMENT_ACTIONS)[number]; requestId: string; poId: string; expectedVersion: string; draftId?: string; replacesId?: string; reason: string; body?: PaymentBody; plan?: PaymentPlan; expectedLedger?: string; evidenceReviewed?: boolean };
export function parsePaymentCommand(value: unknown): PaymentCommand | null {
  const c = record(value);
  if (!c || !PAYMENT_ACTIONS.some(t => t === c.type) || !uuid(c.requestId) || !uuid(c.poId) || !version(c.expectedVersion)
    || !text(c.reason) || ["snapshot", "totals", "calculation", "actor"].some(k => k in c)) return null;
  const type = PAYMENT_ACTIONS.find(t => t === c.type)!;
  const command: PaymentCommand = { type, requestId: c.requestId, poId: c.poId, expectedVersion: c.expectedVersion, reason: c.reason.trim() };
  if (["cancelDraft", "reverse", "noCash", "reverseNoCash", "hold"].includes(type) && command.reason.length < 5) return null;
  if (["saveDraft", "cancelDraft", "verify", "reverse"].includes(type)) {
    if (!uuid(c.draftId)) return null; command.draftId = c.draftId;
  }
  if (type === "saveDraft") {
    const body = parsePaymentBody(c.body); if (!body) return null; command.body = body;
    if (c.replacesId !== undefined) { if (!uuid(c.replacesId)) return null; command.replacesId = c.replacesId; }
  }
  if (type === "coordinate") {
    const plan = parsePlan(c.plan); if (!plan || !version(c.expectedLedger)) return null;
    command.plan = plan; command.expectedLedger = c.expectedLedger;
  }
  if (type === "verify") { if (c.evidenceReviewed !== true) return null; command.evidenceReviewed = true; }
  return command;
}
