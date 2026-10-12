import test from "node:test";
import assert from "node:assert/strict";
import { quotationReviewSummary } from "../src/features/requests/quotation-review-summary.ts";
import { quoteFinancialBreakdown, roundMoney } from "../src/domain/pricing.ts";

const quote = () => ({
  financial: { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, reviewed: true },
  lines: [{ id: "line", quantity: 12, unitPrice: 100, discountType: "none", taxRate: 12 }],
  adjustments: [
    { id: "delivery", label: "Delivery fee", kind: "shipping", calculation: "fixed", value: 100 },
    { id: "discount", label: "Quotation discount", kind: "discount", calculation: "percentage", value: 10 },
    { id: "tax", label: "Extracted VAT", kind: "tax", calculation: "percentage", value: 12 },
  ],
});
const reconciles = value => {
  const actual = quoteFinancialBreakdown(value), summary = quotationReviewSummary(value);
  assert.equal(roundMoney(summary.materials + summary.adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0) + summary.vatAdded), actual.gross);
  assert.equal(summary.net, actual.net);
  assert.equal(summary.ewtGoods, actual.ewtGoods);
  assert.equal(summary.ewtServices, actual.ewtServices);
  return summary;
};

test("Inclusive prices show VAT already included and ignore extracted tax adjustments", () => {
  const value = quote(), snapshot = structuredClone(value), summary = reconciles(value);
  assert.equal(summary.materials, 1200);
  assert.equal(summary.vatAdded, 0);
  assert.equal(summary.gross, 1180);
  assert.equal(summary.adjustments[2].ignored, true);
  assert.equal(summary.adjustments[2].amount, 0);
  assert.equal(summary.adjustments[2].contribution, 0);
  assert.deepEqual(value, snapshot, "The view model does not change source values");
});

test("Exclusive prices add VAT once, after discounts and taxable services", () => {
  const value = quote(); value.financial.priceBasis = "exclusive";
  const summary = reconciles(value);
  assert.equal(summary.vatAdded, 141.6);
  assert.equal(summary.gross, 1321.6);
  assert.equal(summary.adjustments[0].amount, 100);
  assert.equal(summary.adjustments[0].contribution, 112);
  assert.equal(summary.ewtGoods, 12);
  assert.equal(summary.ewtServices, 2);
});

test("Non-taxable service charges receive neither added VAT nor services EWT", () => {
  const value = quote(); value.financial.priceBasis = "exclusive"; value.adjustments[0].taxable = false;
  const summary = reconciles(value);
  assert.equal(summary.adjustments[0].contribution, 100);
  assert.equal(summary.ewtServices, 0);
  assert.equal(summary.vatAdded, 129.6);
});

test("NON-VAT ignores stored VAT basis and rate without changing them", () => {
  const value = quote(); value.financial.vatStatus = "NON-VAT"; value.financial.priceBasis = "exclusive";
  const summary = reconciles(value);
  assert.equal(summary.vatAdded, 0);
  assert.equal(summary.ewtGoods, 0); assert.equal(summary.ewtServices, 0);
  assert.equal(summary.net, summary.gross);
  assert.equal(value.financial.priceBasis, "exclusive"); assert.equal(value.financial.vatRate, 12);
});

test("Fixed and percentage adjustments retain the engine's rounding and common subtotal", () => {
  const value = quote(); value.financial.priceBasis = "exclusive"; value.financial.vatRate = 10;
  value.lines = [{ id: "one", quantity: 3, unitPrice: 19.995, discountType: "percentage", discountValue: 5 }, { id: "two", quantity: 2, unitPrice: 10.555, discountType: "fixed", discountValue: 1.01 }];
  value.adjustments = [{ id: "fee", label: "Handling", kind: "other", calculation: "fixed", value: 1.005 }, { id: "discount", label: "Discount", kind: "discount", calculation: "percentage", value: 15 }];
  reconciles(value);
});

test("Legacy quotations receive no invented financial treatment and invalid amounts remain invalid", () => {
  const value = quote(); delete value.financial;
  assert.equal(quotationReviewSummary(value), undefined);
  value.financial = quote().financial; value.lines[0].unitPrice = NaN;
  const summary = quotationReviewSummary(value);
  assert.equal(Number.isNaN(summary.gross), true);
  assert.equal(Number.isNaN(summary.materials), true);
});
