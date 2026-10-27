import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "./fixtures/workspace.ts";
import { quotationMatchReview } from "../src/features/requests/quotation-match-review.ts";
import { quoteReviewIssues } from "../src/domain/procurement.ts";

const setup = () => {
  const state = seedDemo(), request = state.requests[0], item = request.items[0];
  const quote = {
    id: "match-review", mrfId: request.id, supplierId: "", supplierDetails: { name: "Sample supplier" },
    ref: "Q-REVIEW", currency: "PHP", reviewStatus: "draft", prices: {}, adjustments: [],
    documents: [{ name: "quotation.pdf", type: "application/pdf", fileId: "test-source" }],
    financial: { vatStatus: "NON-VAT", priceBasis: "inclusive", vatRate: 12, reviewed: true },
    lines: [{ id: "offer", description: item.name, quantity: item.quantity, unit: item.unit, unitPrice: 100,
      brand: "", specification: "", requestItemId: item.id, conversionFactor: 1, varianceReason: "",
      matchConfirmed: false, matchConfidence: "high", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null }],
  };
  return { state, request, item, quote };
};

test("Explicit bulk confirmation includes only straightforward item links across all lines", () => {
  const { state, request, quote } = setup();
  quote.lines.push({ ...quote.lines[0], id: "off-page-offer" });
  quote.lines[0].unit = ` ${quote.lines[0].unit.toUpperCase()} `;
  assert.deepEqual(quotationMatchReview(state, request, quote).filter(value => value.eligible).map(value => value.id), ["offer", "off-page-offer"]);
  assert.equal(quote.lines[0].matchConfirmed, false, "Eligibility never confirms a line automatically");
  assert.ok(quoteReviewIssues(state, quote).some(issue => issue.includes("confirm the suggested")));
  const confirmed = { ...quote, lines: quote.lines.map(line => ({ ...line, matchConfirmed: true })) };
  assert.equal(quoteReviewIssues(state, confirmed).length, 0);
});

test("Partial offers, uncertain matches, unit differences and conversions require individual confirmation", () => {
  for (const change of [{ quantity: 0.5 }, { matchConfidence: "medium" }, { matchConfidence: undefined },
    { unit: "different unit", varianceReason: "Checked supplier unit" }, { conversionFactor: 2 },
    { requestItemId: "" }, { requestItemId: "missing-item" }]) {
    const { state, request, quote } = setup();
    Object.assign(quote.lines[0], change);
    const result = quotationMatchReview(state, request, quote)[0];
    assert.equal(result.eligible, false, JSON.stringify(change));
    assert.ok(result.reasons.length);
  }
  const { state, quote } = setup();
  quote.lines[0].quantity = 0.5; quote.lines[0].matchConfirmed = true;
  assert.equal(quoteReviewIssues(state, quote).length, 0, "A valid partial quantity can still finalize after individual confirmation");
});

test("Invalid line fields and printed differences stay excluded even when a discrepancy is explained", () => {
  for (const change of [{ description: "" }, { quantity: 0 }, { unitPrice: 0 }, { taxRate: -1 },
    { discountType: "percentage", discountValue: 101 }, { printedTotal: 1, discrepancyReason: "Source checked" },
    { printedTotal: NaN }]) {
    const { state, request, quote } = setup(); Object.assign(quote.lines[0], change);
    assert.equal(quotationMatchReview(state, request, quote)[0].eligible, false, JSON.stringify(change));
  }
});

test("Eligibility rechecks changed data and omits already confirmed links", () => {
  const { state, request, quote } = setup();
  assert.equal(quotationMatchReview(state, request, quote)[0].eligible, true);
  quote.lines[0].quantity += 1;
  assert.equal(quotationMatchReview(state, request, quote)[0].eligible, false);
  quote.lines[0].quantity -= 1; quote.lines[0].matchConfirmed = true;
  assert.deepEqual(quotationMatchReview(state, request, quote)[0], { id: "offer", number: 1, eligible: false, confirmed: true, reasons: [] });
});
