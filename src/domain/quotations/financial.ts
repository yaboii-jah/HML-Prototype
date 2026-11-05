import { record } from "../projects/projects.ts";
import type { QuoteBody } from "./drafts.ts";
import {
  absolute,
  add,
  compare,
  decimal,
  divide,
  HUNDRED,
  money,
  multiply,
  ONE,
  rounded,
  subtract,
  sum,
  ZERO,
  type Decimal,
} from "./decimal.ts";

export const QUOTATION_RULE_VERSION = "hml-quotation-2026-11-05-v1";
export const ROW_ROLES = [
  "",
  "material",
  "shipping",
  "other",
  "discount",
  "summary",
  "reference",
] as const;
export const SUMMARY_BASES = [
  "",
  "materials",
  "subtotal",
  "vat",
  "gross",
  "net",
] as const;
export type SummaryBasis = (typeof SUMMARY_BASES)[number];
export type FinancialRow = {
  id: string;
  role: (typeof ROW_ROLES)[number];
  discountType: "none" | "percentage" | "fixed";
  taxable: boolean | null;
  free: boolean;
  reason: string;
  printedBasis: "input" | "contribution";
  summaryBasis: SummaryBasis;
  amountField: "printedTotal" | "unitPrice";
};
export type FinancialAdjustment = {
  id: string;
  kind: "" | "discount" | "shipping" | "other" | "summary" | "reference";
  calculation: "" | "fixed" | "percentage";
  taxable: boolean | null;
  reason: string;
  summaryBasis: SummaryBasis;
};
export type FinancialReview = {
  vatStatus: "" | "VAT" | "NON-VAT";
  priceBasis: "" | "inclusive" | "exclusive";
  vatRate: string;
  subtotalBasis: "materials" | "subtotal";
  totalBasis: "gross" | "net";
  rows: FinancialRow[];
  adjustments: FinancialAdjustment[];
};
export type CalculatedRow = {
  id: string;
  label: string;
  role: string;
  input: string;
  contribution: string;
  taxable: boolean;
  excluded: boolean;
  reason: string;
};
export type PrintedComparison = {
  label: string;
  basis: string;
  printed: string;
  calculated: string;
  matches: boolean;
};
export type QuotationCalculation = {
  ruleVersion: string;
  materials: string;
  subtotal: string;
  vat: string;
  gross: string;
  ewtGoods: string;
  ewtServices: string;
  net: string;
  rows: CalculatedRow[];
  adjustments: CalculatedRow[];
  comparisons: PrintedComparison[];
  issues: string[];
};
export type FinancialState = {
  version: string;
  review: FinancialReview | null;
  sourceVersion: string;
  filesVersion: string;
  checked: boolean;
  calculation: QuotationCalculation | null;
};

const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 2000;
function choice<T extends string>(v: unknown, choices: readonly T[]): v is T {
  return typeof v === "string" && choices.some((value) => value === v);
}
export function parseFinancialReview(value: unknown): FinancialReview | null {
  const v = record(value);
  if (
    !v ||
    JSON.stringify(v).length > 500000 ||
    !choice(v.vatStatus, ["", "VAT", "NON-VAT"]) ||
    !choice(v.priceBasis, ["", "inclusive", "exclusive"]) ||
    typeof v.vatRate !== "string" ||
    v.vatRate.length > 80 ||
    (v.vatRate !== "" && !/^-?\d+(?:\.\d+)?$/.test(v.vatRate)) ||
    !choice(v.subtotalBasis, ["materials", "subtotal"]) ||
    !choice(v.totalBasis, ["gross", "net"]) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 1000 ||
    !Array.isArray(v.adjustments) ||
    v.adjustments.length > 100
  )
    return null;
  const rows: FinancialRow[] = [],
    adjustments: FinancialAdjustment[] = [];
  for (const raw of v.rows) {
    const r = record(raw);
    if (
      !r ||
      !uuid(r.id) ||
      rows.some((row) => row.id === r.id) ||
      !choice(r.role, ROW_ROLES) ||
      !choice(r.discountType, ["none", "fixed", "percentage"]) ||
      !(r.taxable === null || typeof r.taxable === "boolean") ||
      typeof r.free !== "boolean" ||
      !text(r.reason) ||
      !choice(r.printedBasis, ["input", "contribution"]) ||
      !choice(r.summaryBasis, SUMMARY_BASES) ||
      !choice(r.amountField, ["printedTotal", "unitPrice"])
    )
      return null;
    rows.push({
      id: r.id,
      role: r.role,
      discountType: r.discountType,
      taxable: r.taxable,
      free: r.free,
      reason: r.reason.trim(),
      printedBasis: r.printedBasis,
      summaryBasis: r.summaryBasis,
      amountField: r.amountField,
    });
  }
  for (const raw of v.adjustments) {
    const r = record(raw);
    if (
      !r ||
      !uuid(r.id) ||
      adjustments.some((row) => row.id === r.id) ||
      !choice(r.kind, [
        "",
        "discount",
        "shipping",
        "other",
        "summary",
        "reference",
      ]) ||
      !choice(r.calculation, ["", "fixed", "percentage"]) ||
      !(r.taxable === null || typeof r.taxable === "boolean") ||
      !text(r.reason) ||
      !choice(r.summaryBasis, SUMMARY_BASES)
    )
      return null;
    adjustments.push({
      id: r.id,
      kind: r.kind,
      calculation: r.calculation,
      taxable: r.taxable,
      reason: r.reason.trim(),
      summaryBasis: r.summaryBasis,
    });
  }
  return {
    vatStatus: v.vatStatus,
    priceBasis: v.priceBasis,
    vatRate: v.vatRate,
    subtotalBasis: v.subtotalBasis,
    totalBasis: v.totalBasis,
    rows,
    adjustments,
  };
}

export function emptyFinancialReview(body: QuoteBody): FinancialReview {
  return {
    vatStatus: "",
    priceBasis: "",
    vatRate: "",
    subtotalBasis: "materials",
    totalBasis: "gross",
    rows: body.lines.map((line) => ({
      id: line.id,
      role: "",
      discountType: "none",
      taxable: null,
      free: false,
      reason: "",
      printedBasis: "input",
      summaryBasis: "",
      amountField: "printedTotal",
    })),
    adjustments: body.adjustments.map((row) => ({
      id: row.id,
      kind: "",
      calculation: "",
      taxable: null,
      reason: "",
      summaryBasis: "",
    })),
  };
}

/** Retain deliberate classifications, but newly captured source rows start unclassified. */
export function reconcileFinancialRows(
  review: FinancialReview,
  body: QuoteBody,
): FinancialReview {
  const empty = emptyFinancialReview(body);
  return {
    ...review,
    rows: empty.rows.map(
      (row) => review.rows.find((saved) => saved.id === row.id) ?? row,
    ),
    adjustments: empty.adjustments.map(
      (row) => review.adjustments.find((saved) => saved.id === row.id) ?? row,
    ),
  };
}

function nonnegative(value: string, label: string): Decimal {
  const result = decimal(value);
  if (compare(result) < 0)
    throw Error(`${label} cannot be negative; classify a discount explicitly.`);
  return result;
}

/** This is the only quotation calculation engine; source values are never mutated. */
export function calculateQuotation(
  body: QuoteBody,
  review: FinancialReview,
): QuotationCalculation {
  const issues: string[] = [];
  const rows: CalculatedRow[] = [],
    adjustments: CalculatedRow[] = [],
    comparisons: PrintedComparison[] = [];
  const materialInputs: Decimal[] = [],
    materialContributions: Decimal[] = [],
    adjustmentInputs: Decimal[] = [],
    adjustmentContributions: Decimal[] = [],
    serviceInputs: Decimal[] = [],
    taxableContributions: Decimal[] = [];
  const pendingSummaries: {
    label: string;
    basis: SummaryBasis;
    value: string;
  }[] = [];
  const vat = review.vatStatus === "VAT";
  const statedStatus = body.taxStatus
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (
    (statedStatus === "VAT" && review.vatStatus === "NON-VAT") ||
    (statedStatus === "NONVAT" && review.vatStatus === "VAT")
  )
    issues.push(
      "The reviewed VAT classification contradicts the captured source classification.",
    );
  const statedBasis = body.priceBasis.trim().toLowerCase();
  if (
    (statedBasis === "inclusive" || statedBasis === "exclusive") &&
    review.priceBasis &&
    statedBasis !== review.priceBasis
  )
    issues.push(
      "The reviewed price basis contradicts the captured source basis.",
    );
  let rate = ZERO;
  if (!review.vatStatus || !review.priceBasis)
    issues.push("Choose the VAT classification and price basis explicitly.");
  try {
    if (vat) {
      rate = nonnegative(review.vatRate, "VAT rate");
      if (compare(rate, HUNDRED) > 0)
        throw Error("VAT rate cannot exceed 100%.");
      if (body.vatRate && compare(decimal(body.vatRate), rate) !== 0)
        issues.push(
          "The reviewed VAT rate differs from the captured source rate.",
        );
    }
  } catch (error) {
    issues.push(
      error instanceof Error ? error.message : "Review the VAT rate.",
    );
  }
  const multiplier = add(ONE, divide(rate, HUNDRED));
  const exclusive = vat && review.priceBasis === "exclusive";
  const divisor = vat && review.priceBasis === "inclusive" ? multiplier : ONE;
  const contribution = (value: Decimal, taxable: boolean) =>
    rounded(exclusive && taxable ? multiply(value, multiplier) : value);
  if (
    review.rows.length !== body.lines.length ||
    review.rows.some((row) => !body.lines.some((line) => line.id === row.id)) ||
    review.adjustments.length !== body.adjustments.length ||
    review.adjustments.some(
      (row) => !body.adjustments.some((source) => source.id === row.id),
    )
  )
    issues.push("Review classifications for the current saved source rows.");
  const addComparison = (
    label: string,
    basis: string,
    printed: string,
    calculated: Decimal,
  ) => {
    if (!printed) return;
    try {
      const printedMoney = money(decimal(printed)),
        calculatedMoney = money(calculated);
      comparisons.push({
        label,
        basis,
        printed: printedMoney,
        calculated: calculatedMoney,
        matches: printedMoney === calculatedMoney,
      });
      if (printedMoney !== calculatedMoney)
        issues.push(
          `${label} does not match ${basis}; reconcile the source and calculation.`,
        );
    } catch {
      issues.push(`${label}: review the captured printed amount.`);
    }
  };
  const serviceLines: {
    source: QuoteBody["lines"][number];
    config: FinancialRow;
    input: Decimal;
  }[] = [];
  for (const [index, source] of body.lines.entries()) {
    const label = `Line ${index + 1}`,
      config = review.rows.find((row) => row.id === source.id);
    try {
      if (!config?.role) throw Error("Classify this source row.");
      if (config.role === "summary" || config.role === "reference") {
        if (config.reason.trim().length < 5)
          throw Error(
            "Explain why this row is excluded (at least five characters).",
          );
        if (config.role === "summary") {
          if (!config.summaryBasis || !source[config.amountField])
            throw Error(
              "Select the summary basis and a captured amount field.",
            );
          pendingSummaries.push({
            label,
            basis: config.summaryBasis,
            value: source[config.amountField],
          });
        }
        rows.push({
          id: source.id,
          label: source.description || label,
          role: config.role,
          input: "0.00",
          contribution: "0.00",
          taxable: false,
          excluded: true,
          reason: config.reason,
        });
        continue;
      }
      if (!source.description || !source.unit)
        throw Error("Enter the description and offered unit.");
      const quantity = nonnegative(source.quantity, "Offered quantity");
      if (compare(quantity) <= 0)
        throw Error("Offered quantity must be positive.");
      const price =
        config.role === "discount"
          ? absolute(decimal(source.unitPrice))
          : nonnegative(source.unitPrice, "Unit price");
      if (compare(price) === 0 && (!config.free || config.role !== "material"))
        throw Error(
          "Confirm a zero-priced material as free; a blank price is incomplete.",
        );
      const base = rounded(multiply(quantity, price));
      let discount = ZERO;
      if (config.discountType !== "none") {
        const value = absolute(decimal(source.discountValue));
        if (config.discountType === "percentage" && compare(value, HUNDRED) > 0)
          throw Error("Line discount cannot exceed 100%.");
        discount =
          config.discountType === "percentage"
            ? rounded(divide(multiply(base, value), HUNDRED))
            : value;
        if (compare(discount, base) > 0)
          throw Error("Line discount cannot exceed the rounded line base.");
      } else if (
        source.discountValue &&
        compare(decimal(source.discountValue)) !== 0
      )
        throw Error("Classify the captured line discount.");
      const input = rounded(subtract(base, discount));
      if (config.role !== "material") {
        serviceLines.push({ source, config, input });
        continue;
      }
      if (
        source.taxRate &&
        compare(decimal(source.taxRate), vat ? rate : ZERO) !== 0
      )
        throw Error(
          "Mixed material tax rates are unsupported; reconcile the source treatment.",
        );
      const total = contribution(input, true);
      materialInputs.push(input);
      materialContributions.push(total);
      taxableContributions.push(total);
      rows.push({
        id: source.id,
        label: source.description,
        role: config.role,
        input: money(input),
        contribution: money(total),
        taxable: true,
        excluded: false,
        reason: config.reason,
      });
      addComparison(
        `${label} printed total`,
        config.printedBasis,
        source.printedTotal,
        config.printedBasis === "input" ? input : total,
      );
    } catch (error) {
      issues.push(
        `${label}: ${error instanceof Error ? error.message : "Review this source row."}`,
      );
    }
  }
  const materials = sum(materialInputs);
  const applyAdjustment = (
    id: string,
    label: string,
    kind: string,
    value: Decimal,
    taxable: boolean,
    reason: string,
    target: CalculatedRow[],
  ) => {
    const sign = kind === "discount" ? decimal("-1") : ONE;
    const total = multiply(contribution(value, taxable), sign);
    adjustmentInputs.push(multiply(rounded(value), sign));
    adjustmentContributions.push(total);
    if (taxable) taxableContributions.push(total);
    if (taxable && (kind === "shipping" || kind === "other"))
      serviceInputs.push(value);
    target.push({
      id,
      label,
      role: kind,
      input: money(multiply(value, sign)),
      contribution: money(total),
      taxable,
      excluded: false,
      reason,
    });
    return total;
  };
  for (const { source, config, input } of serviceLines) {
    if (config.taxable === null) {
      issues.push(
        `${source.description}: explicitly choose the adjustment tax treatment.`,
      );
      continue;
    }
    const total = applyAdjustment(
      source.id,
      source.description,
      config.role,
      input,
      config.taxable,
      config.reason,
      rows,
    );
    addComparison(
      `${source.description} printed total`,
      config.printedBasis,
      source.printedTotal,
      config.printedBasis === "input" ? input : absolute(total),
    );
  }
  for (const [index, source] of body.adjustments.entries()) {
    const label = `Adjustment ${index + 1}`,
      config = review.adjustments.find((row) => row.id === source.id);
    try {
      if (!config?.kind) throw Error("Classify this source adjustment.");
      if (!source.label) throw Error("Enter the source label.");
      if (config.kind === "summary" || config.kind === "reference") {
        if (config.reason.trim().length < 5)
          throw Error("Explain the exclusion (at least five characters).");
        if (config.kind === "summary") {
          if (!config.summaryBasis || !source.value)
            throw Error(
              "Select the summary basis and record the source value.",
            );
          pendingSummaries.push({
            label,
            basis: config.summaryBasis,
            value: source.value,
          });
        }
        adjustments.push({
          id: source.id,
          label: source.label,
          role: config.kind,
          input: "0.00",
          contribution: "0.00",
          taxable: false,
          excluded: true,
          reason: config.reason,
        });
        continue;
      }
      if (!config.calculation || config.taxable === null)
        throw Error(
          "Choose fixed/percentage basis and tax treatment explicitly.",
        );
      const raw =
        config.kind === "discount"
          ? absolute(decimal(source.value))
          : nonnegative(source.value, "Adjustment value");
      if (config.calculation === "percentage" && compare(raw, HUNDRED) > 0)
        throw Error("Adjustment percentage cannot exceed 100%.");
      const value =
        config.calculation === "percentage"
          ? rounded(divide(multiply(materials, raw), HUNDRED))
          : raw;
      applyAdjustment(
        source.id,
        source.label,
        config.kind,
        value,
        config.taxable,
        config.reason,
        adjustments,
      );
    } catch (error) {
      issues.push(
        `${label}: ${error instanceof Error ? error.message : "Review this source adjustment."}`,
      );
    }
  }
  const subtotal = rounded(add(materials, sum(adjustmentInputs)));
  const gross = rounded(
    add(sum(materialContributions), sum(adjustmentContributions)),
  );
  const includedVat =
    vat && review.priceBasis === "inclusive"
      ? rounded(
          divide(multiply(sum(taxableContributions), rate), add(HUNDRED, rate)),
        )
      : exclusive
        ? rounded(subtract(gross, subtotal))
        : ZERO;
  const ewtGoods = vat
    ? rounded(divide(divide(materials, divisor), HUNDRED))
    : ZERO;
  const ewtServices = vat
    ? rounded(
        divide(
          multiply(divide(sum(serviceInputs), divisor), decimal("2")),
          HUNDRED,
        ),
      )
    : ZERO;
  const net = rounded(subtract(subtract(gross, ewtGoods), ewtServices));
  const bases = { materials, subtotal, vat: includedVat, gross, net };
  addComparison(
    "Printed subtotal",
    review.subtotalBasis,
    body.printedSubtotal,
    bases[review.subtotalBasis],
  );
  addComparison("Printed VAT", "vat", body.printedTax, includedVat);
  addComparison(
    "Printed total",
    review.totalBasis,
    body.printedTotal,
    bases[review.totalBasis],
  );
  for (const summary of pendingSummaries)
    if (summary.basis)
      addComparison(
        summary.label,
        summary.basis,
        summary.value,
        bases[summary.basis],
      );
  if (compare(gross) <= 0)
    issues.push("The quotation gross total must be positive.");
  if (compare(net) < 0)
    issues.push(
      "EWT cannot exceed gross; reconcile the document discounts and source.",
    );
  return {
    ruleVersion: QUOTATION_RULE_VERSION,
    materials: money(materials),
    subtotal: money(subtotal),
    vat: money(includedVat),
    gross: money(gross),
    ewtGoods: money(ewtGoods),
    ewtServices: money(ewtServices),
    net: money(net),
    rows,
    adjustments,
    comparisons,
    issues,
  };
}

export function quotationHeaderIssues(
  body: QuoteBody,
  today: string,
): string[] {
  const issues: string[] = [];
  for (const [key, label] of [
    ["ref", "supplier reference"],
    ["date", "quotation date"],
    ["paymentTerms", "payment terms"],
    ["deliveryTerms", "delivery terms"],
  ] as const) {
    if (!body[key].trim())
      issues.push(`Record the ${label} from the supplier source.`);
  }
  if (
    body.currency &&
    ![
      "PHP",
      "₱",
      "PESO",
      "PESOS",
      "PHILIPPINE PESO",
      "PHILIPPINE PESOS",
    ].includes(body.currency.trim().toUpperCase())
  )
    issues.push(
      "Only PHP quotations can finalize. Obtain a corrected supplier source for an explicit foreign currency.",
    );
  if (body.validUntil && body.validUntil < today)
    issues.push("The supplier offer has expired; obtain a renewed offer.");
  if (body.validUntil && body.date && body.validUntil < body.date)
    issues.push("The validity date cannot precede the quotation date.");
  return issues;
}
