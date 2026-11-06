import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { record } from "../projects/projects.ts";
import type { FinancialState } from "./financial.ts";
import {
  FINANCIAL_COMMANDS,
  parseFinancialCommand,
  parseFinancialState,
  parseQuotationFamily,
  parseQuotationRevision,
  type FinancialCommand,
  type QuotationFamily,
  type QuotationRevision,
} from "./revisions.ts";

export const HEADER_FIELDS = {
  supplierName: "Supplier name as quoted",
  address: "Quoted address",
  tin: "Quoted TIN",
  contactName: "Contact person",
  email: "Email",
  phone: "Phone",
  ref: "Supplier reference",
  date: "Quotation date",
  validUntil: "Valid until",
  currency: "Quoted currency",
  paymentTerms: "Payment terms",
  deliveryTerms: "Delivery terms",
  availability: "Availability",
  leadDays: "Lead days",
  notes: "Notes",
  taxStatus: "Stated tax classification",
  priceBasis: "Stated price basis",
  financialNotes: "Financial source notes",
  vatRate: "Stated VAT rate",
  printedSubtotal: "Printed subtotal",
  printedTax: "Printed tax",
  printedTotal: "Printed total",
} as const;
export const LINE_FIELDS = {
  description: "Supplier description",
  code: "Supplier code",
  unit: "Offered unit",
  quantity: "Offered quantity",
  unitPrice: "Quoted unit price",
  brand: "Brand",
  specification: "Specification",
  conversionFactor: "Requested units per offered unit",
  varianceReason: "Unit/specification explanation",
  discountType: "Stated discount basis",
  discountValue: "Stated discount value",
  taxLabel: "Stated tax label",
  taxRate: "Stated tax rate",
  printedTotal: "Printed line total",
  discrepancyNote: "Source discrepancy note",
  leadTime: "Line lead time",
  notes: "Line notes",
  sourcePage: "Source page",
} as const;
export const ADJUSTMENT_FIELDS = {
  label: "Source label",
  kind: "Stated kind",
  basis: "Stated fixed/percentage basis",
  value: "Source value",
  taxable: "Stated tax treatment",
  sourceDetails: "Original service/source details",
} as const;
export const QUOTE_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const QUOTE_FILE_LIMIT = 20 * 1024 * 1024;
export const QUOTE_GROUP_LIMIT = 45 * 1024 * 1024;
export const QUOTE_CHUNK_SIZE = 3 * 1024 * 1024;
type Fields<T> = { -readonly [K in keyof T]: string };
export type QuoteLine = Fields<typeof LINE_FIELDS> & {
  id: string;
  requestItemId: string | null;
  sourceFileId: string | null;
};
export type QuoteAdjustment = Fields<typeof ADJUSTMENT_FIELDS> & { id: string };
export type QuoteBody = Fields<typeof HEADER_FIELDS> & {
  lines: QuoteLine[];
  adjustments: QuoteAdjustment[];
};
export type QuoteFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
};
export type QuoteUpload = QuoteFile & {
  state: string;
  offset: number;
  expiresAt: string;
};
export type QuoteGroup = {
  id: string;
  state: string;
  files: string[];
  uploads: QuoteUpload[];
};
export type QuoteJob = {
  id: string;
  kind: string;
  state: string;
  message: string | null;
};
export type QuotationDraft = {
  id: string;
  mrfId: string;
  supplierId: string;
  body: QuoteBody;
  state: "draft" | "cancelled" | "finalized";
  contentVersion?: string;
  financial?: FinancialState;
  family?: QuotationFamily;
  revision?: QuotationRevision | null;
  version: string;
  fileVersion: string;
  creatorName: string;
  createdAt: string;
  checked: boolean;
  matches: string[];
  files: QuoteFile[];
  groups: QuoteGroup[];
  jobs: QuoteJob[];
};
export type QuoteHistory = {
  id: string;
  actorName: string;
  actorRole: AuthRole;
  action: string;
  at: string;
  quoteId: string;
  details: Record<string, unknown>;
};
export type QuotationsView = {
  role: AuthRole;
  request: {
    id: string;
    ref: string;
    procurementReady: boolean;
    items: {
      id: string;
      name: string;
      unit: string;
      quantity: string | null;
    }[];
  } | null;
  suppliers: {
    id: string;
    name: string;
    address: string;
    tin: string;
    contactName: string;
    email: string;
    phone: string;
  }[];
  quotes: QuotationDraft[];
  history: QuoteHistory[];
};
export type QuoteCommand =
  | FinancialCommand
  | ((
      | { type: "create"; mrfId: string; supplierId: string; body: QuoteBody }
      | {
          type: "save";
          quoteId: string;
          expectedVersion: string;
          body: QuoteBody;
        }
      | {
          type: "status";
          quoteId: string;
          expectedVersion: string;
          state: "draft" | "cancelled";
          reason: string;
        }
      | {
          type: "checkSource";
          quoteId: string;
          expectedVersion: string;
          expectedFiles: string;
        }
      | {
          type: "confirmMatch";
          quoteId: string;
          expectedVersion: string;
          expectedFiles: string;
          lineId: string;
        }
    ) & { requestId: string });
type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type QuoteInput = WithoutRequest<QuoteCommand>;
export type QuoteResult = {
  ok: boolean;
  message: string;
  quoteId?: string;
  quote?: QuotationDraft;
  conflict?: boolean;
};
export const quoteUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_PATTERN.test(v);
const version = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9]\d{0,18}$/.test(v);
export function quoteDecimal(
  value: unknown,
  mode: "signed" | "quantity" | "factor" = "signed",
): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return "";
  if (text.length > 80 || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-") && /[1-9]/.test(text);
  if (
    (mode !== "signed" && negative) ||
    (mode === "factor" && !/[1-9]/.test(text))
  )
    return null;
  return text;
}
function textFields<T extends Record<string, string>>(
  raw: Record<string, unknown>,
  fields: T,
): Fields<T> | null {
  const result: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    if (typeof raw[key] !== "string" || raw[key].length > 4000) return null;
    result[key] = raw[key].trim();
  }
  return result as Fields<T>;
}
function date(value: string): boolean {
  return (
    value === "" ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value)
  );
}
export function parseQuoteBody(value: unknown): QuoteBody | null {
  const raw = record(value);
  if (
    !raw ||
    JSON.stringify(raw).length > 750000 ||
    !Array.isArray(raw.lines) ||
    raw.lines.length > 1000 ||
    !Array.isArray(raw.adjustments) ||
    raw.adjustments.length > 100
  )
    return null;
  const header = textFields(raw, HEADER_FIELDS);
  if (
    !header ||
    !date(header.date) ||
    !date(header.validUntil) ||
    (header.leadDays !== "" && !/^\d{1,6}$/.test(header.leadDays))
  )
    return null;
  for (const key of [
    "vatRate",
    "printedSubtotal",
    "printedTax",
    "printedTotal",
  ] as const) {
    const decimal = quoteDecimal(header[key]);
    if (decimal === null) return null;
    header[key] = decimal;
  }
  const lines: QuoteLine[] = [],
    adjustments: QuoteAdjustment[] = [];
  const ids = new Set<string>();
  for (const value of raw.lines) {
    const row = record(value),
      text = row && textFields(row, LINE_FIELDS);
    if (
      !row ||
      !text ||
      !quoteUuid(row.id) ||
      ids.has(row.id) ||
      !(row.requestItemId === null || quoteUuid(row.requestItemId)) ||
      !(row.sourceFileId === null || quoteUuid(row.sourceFileId))
    )
      return null;
    ids.add(row.id);
    for (const key of [
      "quantity",
      "unitPrice",
      "conversionFactor",
      "discountValue",
      "taxRate",
      "printedTotal",
    ] as const) {
      const decimal = quoteDecimal(
        text[key],
        key === "quantity"
          ? "quantity"
          : key === "conversionFactor"
            ? "factor"
            : "signed",
      );
      if (decimal === null) return null;
      text[key] = decimal;
    }
    if (text.sourcePage !== "" && !/^[1-9]\d{0,5}$/.test(text.sourcePage))
      return null;
    lines.push({
      ...text,
      id: row.id,
      requestItemId: row.requestItemId,
      sourceFileId: row.sourceFileId,
    });
  }
  ids.clear();
  for (const value of raw.adjustments) {
    const row = record(value),
      text = row && textFields(row, ADJUSTMENT_FIELDS);
    if (
      !row ||
      !text ||
      !quoteUuid(row.id) ||
      ids.has(row.id) ||
      quoteDecimal(text.value) === null
    )
      return null;
    ids.add(row.id);
    adjustments.push({ ...text, id: row.id });
  }
  return { ...header, lines, adjustments };
}
export function emptyQuoteBody(): QuoteBody {
  return {
    ...(Object.fromEntries(
      Object.keys(HEADER_FIELDS).map((key) => [key, ""]),
    ) as Fields<typeof HEADER_FIELDS>),
    lines: [],
    adjustments: [],
  };
}
export function emptyQuoteLine(): QuoteLine {
  return {
    ...(Object.fromEntries(
      Object.keys(LINE_FIELDS).map((key) => [key, ""]),
    ) as Fields<typeof LINE_FIELDS>),
    id: crypto.randomUUID(),
    requestItemId: null,
    sourceFileId: null,
  };
}
export function parseQuoteCommand(value: unknown): QuoteCommand | null {
  const raw = record(value);
  if (!raw || !quoteUuid(raw.requestId)) return null;
  if (FINANCIAL_COMMANDS.includes(String(raw.type)))
    return parseFinancialCommand(raw);
  if (raw.type === "create") {
    const body = parseQuoteBody(raw.body);
    return body && quoteUuid(raw.mrfId) && quoteUuid(raw.supplierId)
      ? {
          type: raw.type,
          requestId: raw.requestId,
          mrfId: raw.mrfId,
          supplierId: raw.supplierId,
          body,
        }
      : null;
  }
  if (!quoteUuid(raw.quoteId) || !version(raw.expectedVersion)) return null;
  const base = {
    requestId: raw.requestId,
    quoteId: raw.quoteId,
    expectedVersion: raw.expectedVersion,
  };
  if (raw.type === "save") {
    const body = parseQuoteBody(raw.body);
    return body ? { ...base, type: raw.type, body } : null;
  }
  if (
    raw.type === "status" &&
    (raw.state === "draft" || raw.state === "cancelled") &&
    typeof raw.reason === "string" &&
    raw.reason.trim().length >= 5 &&
    raw.reason.trim().length <= 2000
  )
    return {
      ...base,
      type: raw.type,
      state: raw.state,
      reason: raw.reason.trim(),
    };
  if (!version(raw.expectedFiles)) return null;
  if (raw.type === "checkSource")
    return { ...base, type: raw.type, expectedFiles: raw.expectedFiles };
  return raw.type === "confirmMatch" && quoteUuid(raw.lineId)
    ? {
        ...base,
        type: raw.type,
        expectedFiles: raw.expectedFiles,
        lineId: raw.lineId,
      }
    : null;
}
export function validQuoteFile(
  value: unknown,
): value is Omit<QuoteFile, "id"> & Record<string, unknown> {
  const f = record(value);
  return (
    !!f &&
    typeof f.name === "string" &&
    f.name.length > 0 &&
    f.name.length <= 240 &&
    typeof f.mime === "string" &&
    QUOTE_MIMES.some((mime) => mime === f.mime) &&
    typeof f.size === "number" &&
    Number.isSafeInteger(f.size) &&
    f.size >= 5 &&
    f.size <= QUOTE_FILE_LIMIT &&
    typeof f.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(f.sha256)
  );
}
export function parseQuotationsView(value: unknown): QuotationsView | null {
  const raw = record(value);
  if (
    !raw ||
    !isAuthRole(raw.role) ||
    raw.role === "Site Personnel" ||
    !Array.isArray(raw.suppliers) ||
    !Array.isArray(raw.quotes) ||
    !Array.isArray(raw.history)
  )
    return null;
  let request: QuotationsView["request"] = null;
  if (raw.request !== null) {
    const r = record(raw.request);
    if (
      !r ||
      !quoteUuid(r.id) ||
      typeof r.ref !== "string" ||
      typeof r.procurementReady !== "boolean" ||
      !Array.isArray(r.items)
    )
      return null;
    const items: NonNullable<QuotationsView["request"]>["items"] = [];
    for (const value of r.items) {
      const item = record(value);
      if (
        !item ||
        !quoteUuid(item.id) ||
        typeof item.name !== "string" ||
        typeof item.unit !== "string" ||
        !(item.quantity === null || typeof item.quantity === "string")
      )
        return null;
      items.push({
        id: item.id,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
      });
    }
    request = {
      id: r.id,
      ref: r.ref,
      procurementReady: r.procurementReady,
      items,
    };
  }
  const suppliers: QuotationsView["suppliers"] = [],
    quotes: QuotationDraft[] = [],
    history: QuoteHistory[] = [];
  for (const value of raw.suppliers) {
    const s = record(value);
    if (
      !s ||
      !quoteUuid(s.id) ||
      ["name", "address", "tin", "contactName", "email", "phone"].some(
        (k) => typeof s[k] !== "string",
      )
    )
      return null;
    suppliers.push({
      id: s.id,
      name: String(s.name),
      address: String(s.address),
      tin: String(s.tin),
      contactName: String(s.contactName),
      email: String(s.email),
      phone: String(s.phone),
    });
  }
  for (const value of raw.quotes) {
    const q = record(value),
      body = parseQuoteBody(q?.body);
    if (
      !q ||
      !body ||
      !quoteUuid(q.id) ||
      !quoteUuid(q.mrfId) ||
      !quoteUuid(q.supplierId) ||
      !version(q.version) ||
      !version(q.fileVersion) ||
      !["draft", "cancelled", "finalized"].includes(String(q.state)) ||
      typeof q.creatorName !== "string" ||
      typeof q.createdAt !== "string" ||
      !Array.isArray(q.matches) ||
      !q.matches.every(quoteUuid) ||
      !Array.isArray(q.files) ||
      !Array.isArray(q.groups) ||
      !Array.isArray(q.jobs)
    )
      return null;
    const files: QuoteFile[] = [],
      groups: QuoteGroup[] = [],
      jobs: QuoteJob[] = [];
    for (const value of q.files) {
      const f = record(value);
      if (!f || !quoteUuid(f.id) || !validQuoteFile(f)) return null;
      files.push({
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        sha256: f.sha256,
      });
    }
    for (const value of q.groups) {
      const g = record(value);
      if (
        !g ||
        !quoteUuid(g.id) ||
        typeof g.state !== "string" ||
        !Array.isArray(g.files) ||
        !g.files.every(quoteUuid) ||
        !Array.isArray(g.uploads)
      )
        return null;
      const uploads: QuoteUpload[] = [];
      for (const value of g.uploads) {
        const f = record(value);
        if (
          !f ||
          !quoteUuid(f.id) ||
          !validQuoteFile(f) ||
          typeof f.state !== "string" ||
          typeof f.offset !== "number" ||
          !Number.isSafeInteger(f.offset) ||
          f.offset < 0 ||
          f.offset > f.size ||
          typeof f.expiresAt !== "string"
        )
          return null;
        uploads.push({
          id: f.id,
          name: f.name,
          mime: f.mime,
          size: f.size,
          sha256: f.sha256,
          state: f.state,
          offset: f.offset,
          expiresAt: f.expiresAt,
        });
      }
      groups.push({ id: g.id, state: g.state, files: g.files, uploads });
    }
    for (const value of q.jobs) {
      const j = record(value);
      if (
        !j ||
        !quoteUuid(j.id) ||
        typeof j.kind !== "string" ||
        typeof j.state !== "string" ||
        !(j.message === null || typeof j.message === "string")
      )
        return null;
      jobs.push({ id: j.id, kind: j.kind, state: j.state, message: j.message });
    }
    const financial =
      q.financial === undefined ? undefined : parseFinancialState(q.financial);
    const family =
      q.family === undefined ? undefined : parseQuotationFamily(q.family);
    const revision =
      q.revision == null ? q.revision : parseQuotationRevision(q.revision);
    if (
      financial === null ||
      family === null ||
      (q.revision != null && !revision) ||
      (q.contentVersion !== undefined && !version(q.contentVersion))
    )
      return null;
    quotes.push({
      id: q.id,
      mrfId: q.mrfId,
      supplierId: q.supplierId,
      version: q.version,
      fileVersion: q.fileVersion,
      body,
      state: q.state as QuotationDraft["state"],
      contentVersion: q.contentVersion as string | undefined,
      financial,
      family,
      revision,
      creatorName: q.creatorName,
      createdAt: q.createdAt,
      checked: q.checked === true,
      matches: q.matches,
      files,
      groups,
      jobs,
    });
  }
  for (const value of raw.history) {
    const h = record(value),
      details = record(h?.details);
    if (
      !h ||
      !quoteUuid(h.id) ||
      !quoteUuid(h.quoteId) ||
      typeof h.actorName !== "string" ||
      !isAuthRole(h.actorRole) ||
      typeof h.action !== "string" ||
      typeof h.at !== "string" ||
      !details
    )
      return null;
    history.push({
      id: h.id,
      quoteId: h.quoteId,
      actorName: h.actorName,
      actorRole: h.actorRole,
      action: h.action,
      at: h.at,
      details,
    });
  }
  return { role: raw.role, request, suppliers, quotes, history };
}
