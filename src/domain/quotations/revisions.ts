import { record } from "../projects/projects.ts";
import {
  parseFinancialReview,
  type FinancialReview,
  type FinancialState,
  type QuotationCalculation,
  type CalculatedRow,
  type PrintedComparison,
} from "./financial.ts";

const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const version = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9]\d{0,18}$/.test(v);
const nullableUuid = (v: unknown): v is string | null => v === null || uuid(v);
const reason = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length >= 5 && v.trim().length <= 2000;
const amount = (v: unknown): v is string =>
  typeof v === "string" && /^-?\d{1,250}\.\d{2}$/.test(v);
export type QuotationFamily = {
  id: string;
  version: string;
  currentQuoteId: string | null;
  pendingQuoteId: string | null;
  currentMrfArchiveId: string | null;
  supplierActive: boolean;
};
export type QuotationRevision = {
  id: string;
  number: string;
  finalizedBy: string;
  finalizedAt: string;
  mrfArchiveId: string;
  withdrawn: boolean;
  current: boolean;
  eligible: boolean;
  blockers: string[];
  archiveState: "pending" | "running" | "failed" | "paused" | "complete";
  archiveMessage: string | null;
  pdfAvailable: boolean;
};
type FinancialBase = {
  requestId: string;
  quoteId: string;
  expectedVersion: string;
};
export type FinancialCommand = FinancialBase &
  (
    | { type: "saveFinancial"; expectedFiles: string; review: FinancialReview }
    | {
        type: "checkFinancial";
        expectedFiles: string;
        expectedFinancial: string;
      }
    | {
        type: "finalize";
        expectedFiles: string;
        expectedFinancial: string;
        expectedFamily: string;
      }
    | {
        type: "startRevision" | "withdraw";
        expectedFamily: string;
        reason: string;
      }
    | {
        type: "reconfirmMrf" | "activateRevision";
        expectedFamily: string;
        expectedMrf: string;
        reason: string;
      }
    | { type: "retryArchive"; expectedFamily: string }
  );
export const FINANCIAL_COMMANDS = [
  "saveFinancial",
  "checkFinancial",
  "finalize",
  "startRevision",
  "withdraw",
  "reconfirmMrf",
  "activateRevision",
  "retryArchive",
];
export function parseFinancialCommand(value: unknown): FinancialCommand | null {
  const v = record(value);
  if (
    !v ||
    !uuid(v.requestId) ||
    !uuid(v.quoteId) ||
    !version(v.expectedVersion)
  )
    return null;
  // Calculations are server-owned and never accepted in the browser command.
  if ("calculation" in v || "snapshot" in v || "totals" in v) return null;
  const base = {
    requestId: v.requestId,
    quoteId: v.quoteId,
    expectedVersion: v.expectedVersion,
  };
  if (v.type === "saveFinancial" && version(v.expectedFiles)) {
    const review = parseFinancialReview(v.review);
    return review
      ? { ...base, type: v.type, expectedFiles: v.expectedFiles, review }
      : null;
  }
  if (
    v.type === "checkFinancial" &&
    version(v.expectedFiles) &&
    version(v.expectedFinancial)
  )
    return {
      ...base,
      type: v.type,
      expectedFiles: v.expectedFiles,
      expectedFinancial: v.expectedFinancial,
    };
  if (!version(v.expectedFamily)) return null;
  const family = { ...base, expectedFamily: v.expectedFamily };
  if (
    v.type === "finalize" &&
    version(v.expectedFiles) &&
    version(v.expectedFinancial)
  )
    return {
      ...family,
      type: v.type,
      expectedFiles: v.expectedFiles,
      expectedFinancial: v.expectedFinancial,
    };
  if ((v.type === "startRevision" || v.type === "withdraw") && reason(v.reason))
    return { ...family, type: v.type, reason: v.reason.trim() };
  if (
    (v.type === "reconfirmMrf" || v.type === "activateRevision") &&
    uuid(v.expectedMrf) &&
    reason(v.reason)
  )
    return {
      ...family,
      type: v.type,
      expectedMrf: v.expectedMrf,
      reason: v.reason.trim(),
    };
  return v.type === "retryArchive" ? { ...family, type: v.type } : null;
}

export function parseCalculation(value: unknown): QuotationCalculation | null {
  const v = record(value);
  if (
    !v ||
    typeof v.ruleVersion !== "string" ||
    !Array.isArray(v.rows) ||
    !Array.isArray(v.adjustments) ||
    !Array.isArray(v.comparisons) ||
    !Array.isArray(v.issues) ||
    !v.issues.every((issue): issue is string => typeof issue === "string") ||
    !amount(v.materials) ||
    !amount(v.subtotal) ||
    !amount(v.vat) ||
    !amount(v.gross) ||
    !amount(v.ewtGoods) ||
    !amount(v.ewtServices) ||
    !amount(v.net)
  )
    return null;
  const rows: CalculatedRow[] = [],
    adjustments: CalculatedRow[] = [],
    comparisons: PrintedComparison[] = [];
  for (const [values, target] of [
    [v.rows, rows],
    [v.adjustments, adjustments],
  ] as const) {
    for (const raw of values) {
      const r = record(raw);
      if (
        !r ||
        !uuid(r.id) ||
        typeof r.label !== "string" ||
        typeof r.role !== "string" ||
        !amount(r.input) ||
        !amount(r.contribution) ||
        typeof r.taxable !== "boolean" ||
        typeof r.excluded !== "boolean" ||
        typeof r.reason !== "string"
      )
        return null;
      target.push({
        id: r.id,
        label: r.label,
        role: r.role,
        input: r.input,
        contribution: r.contribution,
        taxable: r.taxable,
        excluded: r.excluded,
        reason: r.reason,
      });
    }
  }
  for (const raw of v.comparisons) {
    const r = record(raw);
    if (
      !r ||
      typeof r.label !== "string" ||
      typeof r.basis !== "string" ||
      !amount(r.printed) ||
      !amount(r.calculated) ||
      typeof r.matches !== "boolean"
    )
      return null;
    comparisons.push({
      label: r.label,
      basis: r.basis,
      printed: r.printed,
      calculated: r.calculated,
      matches: r.matches,
    });
  }
  return {
    ruleVersion: v.ruleVersion,
    materials: v.materials,
    subtotal: v.subtotal,
    vat: v.vat,
    gross: v.gross,
    ewtGoods: v.ewtGoods,
    ewtServices: v.ewtServices,
    net: v.net,
    rows,
    adjustments,
    comparisons,
    issues: v.issues,
  };
}

export function parseFinancialState(value: unknown): FinancialState | null {
  const v = record(value);
  if (
    !v ||
    !version(v.version) ||
    !version(v.sourceVersion) ||
    !version(v.filesVersion) ||
    typeof v.checked !== "boolean"
  )
    return null;
  const review = v.review === null ? null : parseFinancialReview(v.review);
  const calculation =
    v.calculation === null ? null : parseCalculation(v.calculation);
  if (
    (v.review !== null && !review) ||
    (v.calculation !== null && !calculation)
  )
    return null;
  return {
    version: v.version,
    sourceVersion: v.sourceVersion,
    filesVersion: v.filesVersion,
    review,
    calculation,
    checked: v.checked,
  };
}

export function parseQuotationFamily(value: unknown): QuotationFamily | null {
  const v = record(value);
  return v &&
    uuid(v.id) &&
    version(v.version) &&
    nullableUuid(v.currentQuoteId) &&
    nullableUuid(v.pendingQuoteId) &&
    nullableUuid(v.currentMrfArchiveId) &&
    typeof v.supplierActive === "boolean"
    ? {
        id: v.id,
        version: v.version,
        currentQuoteId: v.currentQuoteId,
        pendingQuoteId: v.pendingQuoteId,
        currentMrfArchiveId: v.currentMrfArchiveId,
        supplierActive: v.supplierActive,
      }
    : null;
}

export function parseQuotationRevision(
  value: unknown,
): QuotationRevision | null {
  const v = record(value);
  if (
    !v ||
    !uuid(v.id) ||
    !version(v.number) ||
    typeof v.finalizedBy !== "string" ||
    typeof v.finalizedAt !== "string" ||
    !uuid(v.mrfArchiveId) ||
    typeof v.withdrawn !== "boolean" ||
    typeof v.current !== "boolean" ||
    typeof v.eligible !== "boolean" ||
    !Array.isArray(v.blockers) ||
    !v.blockers.every((item): item is string => typeof item === "string") ||
    !(v.archiveMessage === null || typeof v.archiveMessage === "string") ||
    typeof v.pdfAvailable !== "boolean" ||
    !["pending", "running", "failed", "paused", "complete"].includes(
      String(v.archiveState),
    )
  )
    return null;
  return {
    id: v.id,
    number: v.number,
    finalizedBy: v.finalizedBy,
    finalizedAt: v.finalizedAt,
    mrfArchiveId: v.mrfArchiveId,
    withdrawn: v.withdrawn,
    current: v.current,
    eligible: v.eligible,
    blockers: v.blockers,
    archiveState: v.archiveState as QuotationRevision["archiveState"],
    archiveMessage: v.archiveMessage,
    pdfAvailable: v.pdfAvailable,
  };
}
