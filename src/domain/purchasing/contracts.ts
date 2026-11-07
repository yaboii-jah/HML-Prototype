import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { record } from "../projects/projects.ts";
import {
  parseQuotationsView,
  type QuotationsView,
} from "../quotations/drafts.ts";
import { parseCalculation } from "../quotations/revisions.ts";
import type { QuotationCalculation } from "../quotations/financial.ts";
import type { DemandClaim } from "../demand/quantities.ts";
import { parsePayment, parsePoReview, type PaymentArrangement, type PoReview } from "./accounting.ts";

export const PO_FIELDS = {
  date: "PO date",
  vendorName: "Vendor name (printed)",
  vendorAddress: "Vendor address",
  vendorContact: "Vendor contact",
  vendorPhone: "Vendor phone",
  shipTo: "Ship to",
  shipAddress: "Delivery address",
  shipContact: "Delivery contact",
  shipPhone: "Delivery phone",
  requisitioner: "Requisitioner",
  paymentTerms: "Payment terms",
  fob: "FOB",
  shippingTerms: "Shipping terms",
  bankName: "Bank name",
  accountName: "Bank account name",
  accountNumber: "Bank account number",
  notes: "Notes",
} as const;
export type PoFields = { -readonly [K in keyof typeof PO_FIELDS]: string };
export type OrderLine = {
  id: string;
  sourceLineId: string;
  itemId: string;
  offeredQuantity: string;
  quantity: string;
  fixedDiscount: string;
  discountReason: string;
  discountConfirmed: boolean;
};
export type OrderAdjustment = {
  id: string;
  sourceKind: "line" | "adjustment";
  include: boolean;
  amount: string;
  reason: string;
  confirmed: boolean;
};
export type OrderBody = {
  reason: string;
  fields: PoFields;
  lines: OrderLine[];
  adjustments: OrderAdjustment[];
  payment?: PaymentArrangement;
};
export type PurchasingRecord = {
  id: string;
  kind: "award" | "po";
  mrfId: string;
  supplierId: string;
  quoteId: string;
  revisionId: string;
  version: string;
  state: "active" | "cancelled" | "converted";
  ref: string | null;
  body: OrderBody;
  checked: boolean;
  blockers: string[];
  calculation: QuotationCalculation | null;
  updatedAt: string;
  review?: PoReview | null;
};
export type ComparisonArtifact = {
  id: string;
  format: "pdf" | "xlsx";
  state: "pending" | "running" | "failed" | "paused" | "complete";
  message: string | null;
};
export type ComparisonReport = {
  id: string;
  version: string;
  createdAt: string;
  artifacts: ComparisonArtifact[];
};
export type PurchasingHistory = {
  id: string;
  actorName: string;
  actorRole: string;
  action: string;
  at: string;
  details: Record<string, unknown>;
};
export type PurchasingView = {
  role: AuthRole;
  version: string;
  demandVersion: string;
  quotations: QuotationsView;
  records: PurchasingRecord[];
  reports: ComparisonReport[];
  claims: DemandClaim[];
  history: PurchasingHistory[];
};
export const id = (v: unknown): v is string =>
  typeof v === "string" && UUID_PATTERN.test(v);
export const version = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v);
export const quantity = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 80 && /^\d+(?:\.\d+)?$/.test(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 2000;
export const emptyFields = (): PoFields => ({
  date: "",
  vendorName: "",
  vendorAddress: "",
  vendorContact: "",
  vendorPhone: "",
  shipTo: "",
  shipAddress: "",
  shipContact: "",
  shipPhone: "",
  requisitioner: "",
  paymentTerms: "",
  fob: "",
  shippingTerms: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
  notes: "",
});

export function parseOrderBody(value: unknown): OrderBody | null {
  const v = record(value),
    fields = record(v?.fields);
  if (
    !v ||
    !fields ||
    JSON.stringify(v).length > 750000 ||
    !text(v.reason) ||
    !Array.isArray(v.lines) ||
    !v.lines.length ||
    v.lines.length > 1000 ||
    !Array.isArray(v.adjustments) ||
    v.adjustments.length > 1100
  )
    return null;
  const parsedFields = emptyFields();
  for (const key of Object.keys(parsedFields) as (keyof PoFields)[]) {
    if (typeof fields[key] !== "string" || fields[key].length > 4000)
      return null;
    parsedFields[key] = fields[key];
  }
  if (
    parsedFields.date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(parsedFields.date) ||
      !Number.isFinite(Date.parse(parsedFields.date)) ||
      new Date(parsedFields.date).toISOString().slice(0, 10) !==
        parsedFields.date)
  )
    return null;
  const lines: OrderLine[] = [],
    adjustments: OrderAdjustment[] = [];
  for (const raw of v.lines) {
    const r = record(raw);
    if (
      !r ||
      !id(r.id) ||
      !id(r.sourceLineId) ||
      !id(r.itemId) ||
      !quantity(r.offeredQuantity) ||
      !quantity(r.quantity) ||
      !(r.fixedDiscount === "" || quantity(r.fixedDiscount)) ||
      !text(r.discountReason) ||
      typeof r.discountConfirmed !== "boolean" ||
      lines.some((l) => l.id === r.id || l.sourceLineId === r.sourceLineId)
    )
      return null;
    lines.push({
      id: r.id,
      sourceLineId: r.sourceLineId,
      itemId: r.itemId,
      offeredQuantity: r.offeredQuantity,
      quantity: r.quantity,
      fixedDiscount: r.fixedDiscount,
      discountReason: r.discountReason,
      discountConfirmed: r.discountConfirmed,
    });
  }
  for (const raw of v.adjustments) {
    const r = record(raw);
    if (
      !r ||
      !id(r.id) ||
      (r.sourceKind !== "line" && r.sourceKind !== "adjustment") ||
      typeof r.include !== "boolean" ||
      !(r.amount === "" || quantity(r.amount)) ||
      !text(r.reason) ||
      typeof r.confirmed !== "boolean" ||
      adjustments.some((a) => a.id === r.id && a.sourceKind === r.sourceKind)
    )
      return null;
    adjustments.push({
      id: r.id,
      sourceKind: r.sourceKind,
      include: r.include,
      amount: r.amount,
      reason: r.reason,
      confirmed: r.confirmed,
    });
  }
  const payment = v.payment === undefined ? undefined : parsePayment(v.payment);
  if (payment === null) return null;
  return { reason: v.reason, fields: parsedFields, lines, adjustments, ...(payment ? { payment } : {}) };
}

export type PurchasingCommand = {
  type:
    | "saveAward"
    | "savePo"
    | "cancel"
    | "reopen"
    | "convert"
    | "rebind"
    | "checkPo"
    | "saveComparison"
    | "retryArtifact";
  requestId: string;
  mrfId: string;
  expectedVersion: string;
  expectedDemand: string;
  targetId: string;
  quoteId?: string;
  expectedFamily?: string;
  body?: OrderBody;
  reason?: string;
  selections?: { itemId: string; quoteId: string; lineId: string }[];
  sources?: { quoteId: string; familyVersion: string }[];
};
export function parsePurchasingCommand(
  value: unknown,
): PurchasingCommand | null {
  const v = record(value);
  if (
    !v ||
    !id(v.requestId) ||
    !id(v.mrfId) ||
    !id(v.targetId) ||
    !version(v.expectedVersion) ||
    !version(v.expectedDemand) ||
    typeof v.type !== "string" ||
    "calculation" in v ||
    "snapshot" in v ||
    "totals" in v
  )
    return null;
  const base = {
    requestId: v.requestId,
    mrfId: v.mrfId,
    targetId: v.targetId,
    expectedVersion: v.expectedVersion,
    expectedDemand: v.expectedDemand,
  };
  if (v.type === "saveAward" || v.type === "savePo" || v.type === "rebind") {
    const body = parseOrderBody(v.body);
    if (!body || !id(v.quoteId) || !version(v.expectedFamily)) return null;
    return {
      ...base,
      type: v.type,
      quoteId: v.quoteId,
      expectedFamily: v.expectedFamily,
      body,
    };
  }
  if (v.type === "cancel" || v.type === "reopen")
    return text(v.reason) && v.reason.trim().length >= 5
      ? { ...base, type: v.type, reason: v.reason.trim() }
      : null;
  if (
    v.type === "convert" ||
    v.type === "checkPo" ||
    v.type === "retryArtifact"
  )
    return { ...base, type: v.type };
  if (
    v.type === "saveComparison" &&
    Array.isArray(v.selections) &&
    v.selections.length <= 1000 &&
    Array.isArray(v.sources) &&
    v.sources.length <= 1000
  ) {
    const selections: NonNullable<PurchasingCommand["selections"]> = [],
      sources: NonNullable<PurchasingCommand["sources"]> = [];
    for (const raw of v.selections) {
      const r = record(raw);
      if (
        !r ||
        !id(r.itemId) ||
        !id(r.quoteId) ||
        !id(r.lineId) ||
        selections.some((s) => s.itemId === r.itemId && s.quoteId === r.quoteId)
      )
        return null;
      selections.push({
        itemId: r.itemId,
        quoteId: r.quoteId,
        lineId: r.lineId,
      });
    }
    for (const raw of v.sources) {
      const r = record(raw);
      if (
        !r ||
        !id(r.quoteId) ||
        !version(r.familyVersion) ||
        sources.some((s) => s.quoteId === r.quoteId)
      )
        return null;
      sources.push({ quoteId: r.quoteId, familyVersion: r.familyVersion });
    }
    return { ...base, type: v.type, selections, sources };
  }
  return null;
}

export function parsePurchasingView(value: unknown): PurchasingView | null {
  const v = record(value);
  if (
    !v ||
    !isAuthRole(v.role) ||
    v.role === "Site Personnel" ||
    !version(v.version) ||
    !version(v.demandVersion) ||
    !Array.isArray(v.records) ||
    !Array.isArray(v.claims) ||
    !Array.isArray(v.reports) ||
    !Array.isArray(v.history)
  )
    return null;
  const quotations = parseQuotationsView(v.quotations);
  if (!quotations) return null;
  const records: PurchasingRecord[] = [],
    claims: DemandClaim[] = [],
    reports: ComparisonReport[] = [],
    history: PurchasingHistory[] = [];
  for (const raw of v.records) {
    const r = record(raw),
      review = r?.review === null || r?.review === undefined ? r?.review : parsePoReview(r.review),
      body = parseOrderBody(r?.body),
      calculation =
        r?.calculation === null ? null : parseCalculation(r?.calculation);
    if (
      !r ||
      !body ||
      !id(r.id) ||
      !id(r.mrfId) ||
      !id(r.supplierId) ||
      !id(r.quoteId) ||
      !id(r.revisionId) ||
      !version(r.version) ||
      (r.kind !== "award" && r.kind !== "po") ||
      (r.state !== "active" &&
        r.state !== "cancelled" &&
        r.state !== "converted") ||
      !(r.ref === null || typeof r.ref === "string") ||
      typeof r.checked !== "boolean" ||
      typeof r.updatedAt !== "string" ||
      !Array.isArray(r.blockers) ||
      !r.blockers.every((b): b is string => typeof b === "string") ||
      (r.calculation !== null && !calculation) ||
      (r.review !== null && r.review !== undefined && !review)
    )
      return null;
    records.push({
      id: r.id,
      mrfId: r.mrfId,
      supplierId: r.supplierId,
      quoteId: r.quoteId,
      revisionId: r.revisionId,
      kind: r.kind,
      state: r.state,
      version: r.version,
      ref: r.ref,
      body,
      checked: r.checked,
      blockers: r.blockers,
      calculation,
      updatedAt: r.updatedAt,
      ...(review !== undefined ? { review } : {}),
    });
  }
  for (const raw of v.claims) {
    const c = record(raw);
    if (
      !c ||
      !id(c.claimId) ||
      !id(c.itemId) ||
      !id(c.ownerId) ||
      !id(c.ownerLineId) ||
      !quantity(c.quantity) ||
      (c.ownerKind !== "award" &&
        c.ownerKind !== "purchase_order" &&
        c.ownerKind !== "suitability" &&
        c.ownerKind !== "transfer")
    )
      return null;
    claims.push({
      claimId: c.claimId,
      itemId: c.itemId,
      ownerId: c.ownerId,
      ownerLineId: c.ownerLineId,
      ownerKind: c.ownerKind,
      quantity: c.quantity,
    });
  }
  for (const raw of v.reports) {
    const r = record(raw);
    if (
      !r ||
      !id(r.id) ||
      !version(r.version) ||
      typeof r.createdAt !== "string" ||
      !Array.isArray(r.artifacts)
    )
      return null;
    const artifacts: ComparisonArtifact[] = [];
    for (const rawArtifact of r.artifacts) {
      const a = record(rawArtifact);
      if (
        !a ||
        !id(a.id) ||
        (a.format !== "pdf" && a.format !== "xlsx") ||
        !["pending", "running", "failed", "paused", "complete"].includes(
          String(a.state),
        ) ||
        !(a.message === null || typeof a.message === "string")
      )
        return null;
      const state = a.state;
      if (
        state !== "pending" &&
        state !== "running" &&
        state !== "failed" &&
        state !== "paused" &&
        state !== "complete"
      )
        return null;
      artifacts.push({ id: a.id, format: a.format, state, message: a.message });
    }
    reports.push({
      id: r.id,
      version: r.version,
      createdAt: r.createdAt,
      artifacts,
    });
  }
  for (const raw of v.history) {
    const h = record(raw),
      details = record(h?.details);
    if (
      !h ||
      !details ||
      !id(h.id) ||
      typeof h.actorName !== "string" ||
      typeof h.actorRole !== "string" ||
      typeof h.action !== "string" ||
      typeof h.at !== "string"
    )
      return null;
    history.push({
      id: h.id,
      actorName: h.actorName,
      actorRole: h.actorRole,
      action: h.action,
      at: h.at,
      details,
    });
  }
  return {
    role: v.role,
    version: v.version,
    demandVersion: v.demandVersion,
    quotations,
    records,
    claims,
    reports,
    history,
  };
}

export type PurchasingResult =
  | { ok: true; message: string; targetId: string }
  | { ok: false; message: string; conflict?: boolean; uncertain?: boolean };
