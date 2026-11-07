import type { QuotationDraft } from "../quotations/drafts.ts";
import {
  calculateFinancialInputs,
  type FinancialReview,
  type QuotationCalculation,
} from "../quotations/financial.ts";
import {
  add,
  compare,
  decimal,
  divide,
  money,
  multiply,
  type Decimal,
} from "../quotations/decimal.ts";
import { demandTotals } from "../demand/quantities.ts";
import {
  emptyFields,
  id,
  type OrderAdjustment,
  type OrderBody,
  type OrderLine,
  type PurchasingView,
} from "./contracts.ts";
import { record } from "../projects/projects.ts";

export const PO_RULE_VERSION = "hml-po-draft-2026-11-06-v1";

/** Quantities must have a finite exact decimal representation within the domain bound. */
export function exactQuantity(value: Decimal, maxLength = 80): string {
  if (compare(value) < 0) throw Error("Quantity cannot be negative.");
  let denominator = value.denominator,
    twos = 0,
    fives = 0;
  while (denominator % BigInt(2) === BigInt(0)) {
    denominator /= BigInt(2);
    twos++;
  }
  while (denominator % BigInt(5) === BigInt(0)) {
    denominator /= BigInt(5);
    fives++;
  }
  if (denominator !== BigInt(1))
    throw Error(
      "This conversion requires rounding. Enter an exactly representable offered quantity.",
    );
  const places = Math.max(twos, fives);
  if (places >= maxLength)
    throw Error("The exact quantity exceeds the supported precision.");
  const digits = (
    (value.numerator * BigInt(10) ** BigInt(places)) /
    value.denominator
  )
    .toString()
    .padStart(places + 1, "0");
  const result = places
    ? `${digits.slice(0, -places)}.${digits.slice(-places)}`
        .replace(/0+$/, "")
        .replace(/\.$/, "")
    : digits;
  if (result.length > maxLength)
    throw Error("The exact quantity exceeds the supported length.");
  return result;
}
export function convertedPrice(
  price: string,
  factor: string,
): { text: string; approximate: boolean } {
  return priceText(divide(decimal(price), decimal(factor)));
}
function priceText(value: Decimal): { text: string; approximate: boolean } {
  const scaled = value.numerator * BigInt(1000000),
    whole = scaled / value.denominator;
  const rounded =
    whole +
    ((scaled % value.denominator) * BigInt(2) >= value.denominator
      ? BigInt(1)
      : BigInt(0));
  const digits = rounded.toString().padStart(7, "0");
  return {
    text: `${digits.slice(0, -6)}.${digits.slice(-6)}`
      .replace(/0+$/, "")
      .replace(/\.$/, ""),
    approximate: scaled % value.denominator !== BigInt(0),
  };
}

export function makeOrderLine(
  quote: QuotationDraft,
  sourceLineId: string,
  offeredQuantity: string,
  lineId: string,
): OrderLine {
  const source = quote.body.lines.find((l) => l.id === sourceLineId),
    config = quote.financial?.review?.rows.find((r) => r.id === sourceLineId);
  if (
    !source ||
    !source.requestItemId ||
    config?.role !== "material" ||
    !quote.matches.includes(sourceLineId)
  )
    throw Error("Select a confirmed matched material offer.");
  const offered = decimal(offeredQuantity),
    factor = decimal(source.conversionFactor);
  if (
    compare(offered) <= 0 ||
    compare(factor) <= 0 ||
    compare(offered, decimal(source.quantity)) > 0
  )
    throw Error("Enter a positive quantity within the quoted capacity.");
  const partial = compare(offered, decimal(source.quantity)) !== 0;
  return {
    id: lineId,
    sourceLineId,
    itemId: source.requestItemId,
    offeredQuantity: exactQuantity(offered),
    quantity: exactQuantity(multiply(offered, factor)),
    fixedDiscount:
      config.discountType === "fixed"
        ? partial
          ? ""
          : source.discountValue.replace(/^-/, "")
        : "",
    discountReason: "",
    discountConfirmed: false,
  };
}

export function initialAdjustments(quote: QuotationDraft): OrderAdjustment[] {
  const review = quote.financial?.review;
  if (!review) throw Error("Finalized financial review required.");
  const result: OrderAdjustment[] = [];
  for (const row of review.rows)
    if (["shipping", "other", "discount"].includes(row.role)) {
      const calculated = quote.financial?.calculation?.rows.find(
        (r) => r.id === row.id,
      );
      if (!calculated) throw Error("Source calculation unavailable.");
      result.push({
        id: row.id,
        sourceKind: "line",
        include: true,
        amount: calculated.input.replace(/^-/, ""),
        reason: "",
        confirmed: false,
      });
    }
  for (const config of review.adjustments)
    if (["shipping", "other", "discount"].includes(config.kind)) {
      const source = quote.body.adjustments.find((a) => a.id === config.id);
      if (!source) throw Error("Source adjustment unavailable.");
      result.push({
        id: source.id,
        sourceKind: "adjustment",
        include: true,
        amount: source.value.replace(/^-/, ""),
        reason: "",
        confirmed: false,
      });
    }
  return result;
}

export function initialOrderBody(quote: QuotationDraft): OrderBody {
  const body = quote.body;
  return {
    reason: "",
    fields: {
      ...emptyFields(),
      vendorName: body.supplierName,
      vendorAddress: body.address,
      vendorContact: body.contactName,
      vendorPhone: body.phone,
      paymentTerms: body.paymentTerms,
      shippingTerms: body.deliveryTerms,
    },
    lines: [],
    adjustments: initialAdjustments(quote),
  };
}

/** Awarding quantities never carries a PO pricing attestation forward. */
export function preparePoBody(
  quote: QuotationDraft,
  award: OrderBody,
): OrderBody {
  return {
    reason: award.reason,
    fields: { ...award.fields },
    lines: award.lines.map((line) =>
      makeOrderLine(quote, line.sourceLineId, line.offeredQuantity, line.id),
    ),
    adjustments: initialAdjustments(quote),
  };
}

export function orderPricingBasis(body: OrderBody): string {
  return JSON.stringify(
    body.lines
      .map((line) => ({
        id: line.id,
        sourceLineId: line.sourceLineId,
        itemId: line.itemId,
        offeredQuantity: line.offeredQuantity,
        quantity: line.quantity,
        fixedDiscount: line.fixedDiscount,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/** Source prices/classifications are selected from the immutable authorized quotation. */
export function calculatePo(
  quote: QuotationDraft,
  order: OrderBody,
): QuotationCalculation {
  const sourceReview = quote.financial?.review;
  if (!sourceReview || !quote.revision)
    throw Error("A finalized source revision is required.");
  const issues: string[] = [],
    lines: QuotationDraft["body"]["lines"] = [],
    rows: FinancialReview["rows"] = [];
  const adjustments: QuotationDraft["body"]["adjustments"] = [],
    configs: FinancialReview["adjustments"] = [];
  if (!order.lines.length) issues.push("Select at least one material.");
  for (const selected of order.lines) {
    const source = quote.body.lines.find((l) => l.id === selected.sourceLineId),
      config = sourceReview.rows.find((r) => r.id === selected.sourceLineId);
    if (
      !source ||
      config?.role !== "material" ||
      !quote.matches.includes(source.id) ||
      source.requestItemId !== selected.itemId
    ) {
      issues.push(
        "Only confirmed matched source material rows may be ordered.",
      );
      continue;
    }
    try {
      if (
        compare(decimal(selected.offeredQuantity)) <= 0 ||
        compare(decimal(selected.offeredQuantity), decimal(source.quantity)) >
          0 ||
        exactQuantity(
          multiply(
            decimal(selected.offeredQuantity),
            decimal(source.conversionFactor),
          ),
        ) !== exactQuantity(decimal(selected.quantity))
      )
        throw Error(
          "Review the exact offered/requested quantity and quoted capacity.",
        );
      let discountValue = source.discountValue;
      if (config.discountType === "fixed") {
        discountValue = selected.fixedDiscount;
        if (!selected.discountConfirmed || discountValue === "")
          issues.push(
            `${source.description}: confirm the fixed line discount, including zero.`,
          );
        if (
          discountValue !== "" &&
          compare(
            decimal(discountValue),
            decimal(source.discountValue.replace(/^-/, "")),
          ) !== 0 &&
          selected.discountReason.trim().length < 5
        )
          issues.push(
            `${source.description}: explain the changed fixed discount.`,
          );
      }
      lines.push({
        ...source,
        quantity: selected.offeredQuantity,
        discountValue,
        printedTotal: "",
      });
      rows.push({ ...config });
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : "Invalid source quantity.",
      );
    }
  }
  const expected = initialAdjustments(quote);
  if (
    expected.length !== order.adjustments.length ||
    order.adjustments.some(
      (a) =>
        !expected.some((e) => e.id === a.id && e.sourceKind === a.sourceKind),
    )
  )
    issues.push(
      "Review every quoted document adjustment; new charges are not permitted.",
    );
  for (const original of expected) {
    const selected = order.adjustments.find(
      (a) => a.id === original.id && a.sourceKind === original.sourceKind,
    );
    if (!selected) continue;
    try {
      if (!selected.confirmed)
        issues.push("Confirm each adjustment's inclusion and amount.");
      if (
        (!selected.include ||
          (selected.amount !== "" &&
            compare(decimal(selected.amount), decimal(original.amount)) !==
              0)) &&
        selected.reason.trim().length < 5
      )
        issues.push(
          "Explain changed or excluded adjustments (at least five characters).",
        );
      if (!selected.include) continue;
      if (original.sourceKind === "line") {
        const source = quote.body.lines.find((l) => l.id === selected.id),
          config = sourceReview.rows.find((r) => r.id === selected.id);
        if (!source || !config) {
          issues.push("Source service unavailable.");
          continue;
        }
        lines.push({
          ...source,
          quantity: "1",
          unitPrice: selected.amount,
          discountType: "none",
          discountValue: "",
          printedTotal: "",
        });
        rows.push({ ...config, discountType: "none", printedBasis: "input" });
      } else {
        const source = quote.body.adjustments.find((a) => a.id === selected.id),
          config = sourceReview.adjustments.find((a) => a.id === selected.id);
        if (!source || !config) {
          issues.push("Source adjustment unavailable.");
          continue;
        }
        if (
          config.calculation === "percentage" &&
          (selected.amount === "" ||
            compare(decimal(selected.amount), decimal(original.amount)) !== 0)
        )
          issues.push("Quoted percentage rates cannot be changed.");
        adjustments.push({
          ...source,
          value:
            config.calculation === "percentage"
              ? source.value
              : selected.amount,
        });
        configs.push({ ...config });
      }
    } catch {
      issues.push("Enter an exact nonnegative adjustment amount.");
    }
  }
  const calculation = calculateFinancialInputs(
    {
      ...quote.body,
      lines,
      adjustments,
      printedSubtotal: "",
      printedTax: "",
      printedTotal: "",
    },
    { ...sourceReview, rows, adjustments: configs },
    { reconcile: false, allowZero: true, ruleVersion: PO_RULE_VERSION },
  );
  return {
    ...calculation,
    issues: [...new Set([...issues, ...calculation.issues])],
  };
}

export type ComparisonSnapshot = {
  mrfId: string;
  mrfArchiveId: string;
  demandVersion: string;
  ref: string;
  createdAt: string;
  createdBy: string;
  sources: {
    quoteId: string;
    revisionId: string;
    supplierId: string;
    supplierName: string;
    ref: string;
    gross: string;
    ewt: string;
    net: string;
    adjustments: string[];
  }[];
  items: {
    id: string;
    name: string;
    unit: string;
    requested: string;
    purchase: string;
    unassigned: string;
    ordered: string;
    awarded: string;
    suitability: string;
    transfers: string;
    offers: {
      quoteId: string;
      lineId: string;
      price: string;
      amount: string;
      capacity: string;
      sufficient: boolean;
      lowest: boolean;
    }[];
  }[];
};
export function comparisonSnapshot(
  view: PurchasingView,
  selections: { itemId: string; quoteId: string; lineId: string }[],
  actorName: string,
  at: string,
): ComparisonSnapshot {
  const request = view.quotations.request;
  if (!request?.procurementReady)
    throw Error("Current approved archived MRF required.");
  const quotes = view.quotations.quotes.filter((q) => q.revision?.eligible);
  if (!quotes.length)
    throw Error("At least one eligible archived quotation is required.");
  const mrfArchiveId = quotes[0].family?.currentMrfArchiveId;
  if (!mrfArchiveId) throw Error("Current approved MRF archive required.");
  const sources = quotes.map((q) => {
    if (!q.revision || !q.financial?.calculation)
      throw Error("Finalized source calculation unavailable.");
    return {
      quoteId: q.id,
      revisionId: q.revision.id,
      supplierId: q.supplierId,
      supplierName: q.body.supplierName,
      ref: q.body.ref,
      gross: q.financial.calculation.gross,
      ewt: money(
        add(
          decimal(q.financial.calculation.ewtGoods, 400),
          decimal(q.financial.calculation.ewtServices, 400),
        ),
      ),
      net: q.financial.calculation.net,
      adjustments: initialAdjustments(q).map(
        (a) =>
          `${a.sourceKind === "line" ? q.body.lines.find((l) => l.id === a.id)?.description : q.body.adjustments.find((s) => s.id === a.id)?.label}: ${a.amount}`,
      ),
    };
  });
  const items = request.items.map((item) => {
    if (!item.quantity) throw Error("Approved quantity is missing.");
    const totals = demandTotals(
      item.quantity,
      view.claims.filter((c) => c.itemId === item.id),
    );
    const offers: (ComparisonSnapshot["items"][number]["offers"][number] & {
      exact: Decimal;
    })[] = [];
    for (const quote of quotes) {
      const candidates = quote.body.lines.filter(
        (l) =>
          l.requestItemId === item.id &&
          quote.matches.includes(l.id) &&
          quote.financial?.review?.rows.some(
            (r) => r.id === l.id && r.role === "material",
          ),
      );
      const selected = selections.find(
        (s) => s.itemId === item.id && s.quoteId === quote.id,
      );
      const source = selected
        ? candidates.find((l) => l.id === selected.lineId)
        : candidates.length === 1
          ? candidates[0]
          : null;
      if (selected && !source)
        throw Error("The comparison alternative is no longer eligible.");
      if (!source) {
        if (candidates.length > 1)
          throw Error(
            `Choose a comparison alternative for ${item.name} and ${quote.body.supplierName}.`,
          );
        continue;
      }
      const calculated = quote.financial?.calculation?.rows.find(
        (r) => r.id === source.id,
      );
      if (!calculated) throw Error("Source material calculation unavailable.");
      const exact = divide(
        decimal(calculated.contribution, 400),
        multiply(decimal(source.quantity), decimal(source.conversionFactor)),
      );
      const capacity = multiply(
        decimal(source.quantity),
        decimal(source.conversionFactor),
      );
      offers.push({
        quoteId: quote.id,
        lineId: source.id,
        price: priceText(exact).text,
        amount: money(multiply(exact, decimal(totals.purchase))),
        capacity: exactQuantity(capacity, 400),
        sufficient: compare(capacity, decimal(totals.purchase)) >= 0,
        lowest: false,
        exact,
      });
    }
    let minimum: Decimal | null = null;
    for (const offer of offers)
      if (minimum === null || compare(offer.exact, minimum) < 0)
        minimum = offer.exact;
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      ...totals,
      offers: offers.map(({ exact, ...offer }) => ({
        ...offer,
        lowest: minimum !== null && compare(exact, minimum) === 0,
      })),
    };
  });
  return {
    mrfId: request.id,
    mrfArchiveId,
    demandVersion: view.demandVersion,
    ref: request.ref,
    createdAt: at,
    createdBy: actorName,
    sources,
    items,
  };
}

export function parseComparisonSnapshot(
  value: unknown,
): ComparisonSnapshot | null {
  const string = (v: unknown): string => {
    if (typeof v !== "string" || v.length > 20000)
      throw Error("Invalid snapshot text");
    return v;
  };
  const uuid = (v: unknown): string => {
    if (!id(v)) throw Error("Invalid snapshot identity");
    return v;
  };
  const exact = (v: unknown): string => {
    if (typeof v !== "string" || v.length > 400 || !/^-?\d+(?:\.\d+)?$/.test(v))
      throw Error("Invalid snapshot decimal");
    return v;
  };
  try {
    const v = record(value);
    if (
      !v ||
      !Array.isArray(v.sources) ||
      !v.sources.length ||
      v.sources.length > 1000 ||
      !Array.isArray(v.items) ||
      v.items.length > 1000 ||
      JSON.stringify(v).length > 10 * 1024 * 1024
    )
      return null;
    const sources: ComparisonSnapshot["sources"] = [],
      items: ComparisonSnapshot["items"] = [];
    for (const raw of v.sources) {
      const s = record(raw);
      if (!s || !Array.isArray(s.adjustments) || s.adjustments.length > 1100)
        return null;
      sources.push({
        quoteId: uuid(s.quoteId),
        revisionId: uuid(s.revisionId),
        supplierId: uuid(s.supplierId),
        supplierName: string(s.supplierName),
        ref: string(s.ref),
        gross: exact(s.gross),
        ewt: exact(s.ewt),
        net: exact(s.net),
        adjustments: s.adjustments.map(string),
      });
    }
    for (const raw of v.items) {
      const i = record(raw);
      if (!i || !Array.isArray(i.offers) || i.offers.length > 1000) return null;
      const offers: ComparisonSnapshot["items"][number]["offers"] = [];
      for (const rawOffer of i.offers) {
        const o = record(rawOffer);
        if (
          !o ||
          typeof o.lowest !== "boolean" ||
          typeof o.sufficient !== "boolean" ||
          typeof o.capacity !== "string" ||
          !/^\d+(?:\.\d+)?$/.test(o.capacity)
        )
          return null;
        offers.push({
          quoteId: uuid(o.quoteId),
          lineId: uuid(o.lineId),
          price: exact(o.price),
          amount: exact(o.amount),
          capacity: exact(o.capacity),
          sufficient: o.sufficient,
          lowest: o.lowest,
        });
      }
      items.push({
        id: uuid(i.id),
        name: string(i.name),
        unit: string(i.unit),
        requested: exact(i.requested),
        purchase: exact(i.purchase),
        unassigned: exact(i.unassigned),
        awarded: exact(i.awarded),
        ordered: exact(i.ordered),
        suitability: exact(i.suitability),
        transfers: exact(i.transfers),
        offers,
      });
    }
    const createdAt = string(v.createdAt);
    if (!Number.isFinite(Date.parse(createdAt))) return null;
    return {
      mrfId: uuid(v.mrfId),
      mrfArchiveId: uuid(v.mrfArchiveId),
      demandVersion: string(v.demandVersion),
      ref: string(v.ref),
      createdAt,
      createdBy: string(v.createdBy),
      sources,
      items,
    };
  } catch {
    return null;
  }
}
