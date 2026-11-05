import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyQuoteBody,
  emptyQuoteLine,
} from "../src/domain/quotations/drafts.ts";
import {
  calculateQuotation,
  emptyFinancialReview,
  parseFinancialReview,
  quotationHeaderIssues,
} from "../src/domain/quotations/financial.ts";
import {
  decimal,
  divide,
  money,
  php,
} from "../src/domain/quotations/decimal.ts";

function quote(amounts = ["112"]) {
  const body = {
    ...emptyQuoteBody(),
    ref: "SUP-1",
    date: "2026-11-05",
    paymentTerms: "30 days",
    deliveryTerms: "Delivered to site",
    currency: "PHP",
    lines: amounts.map((amount) => ({
      ...emptyQuoteLine(),
      description: "Material",
      quantity: "1",
      unit: "pc",
      unitPrice: amount,
    })),
  };
  const review = {
    ...emptyFinancialReview(body),
    vatStatus: "VAT",
    priceBasis: "inclusive",
    vatRate: "12",
  };
  review.rows = review.rows.map((row) => ({ ...row, role: "material" }));
  return { body, review };
}
function service(body, review, value = "112", taxable = true) {
  const id = crypto.randomUUID();
  body.adjustments.push({
    id,
    label: "Delivery",
    kind: "delivery",
    basis: "fixed",
    value,
    taxable: "",
    sourceDetails: "",
  });
  review.adjustments.push({
    id,
    kind: "shipping",
    calculation: "fixed",
    taxable,
    reason: "",
    summaryBasis: "",
  });
}

test("exact rounding is symmetric half-up and division remains exact until the final cent", () => {
  assert.equal(money(decimal("1.005")), "1.01");
  assert.equal(money(decimal("-1.005")), "-1.01");
  assert.equal(money(divide(decimal("1"), decimal("3"))), "0.33");
  assert.equal(
    money(decimal("999999999999999999999999.995")),
    "1000000000000000000000000.00",
  );
  assert.equal(
    php("1000000000000000000000000.00"),
    "₱1,000,000,000,000,000,000,000,000.00",
  );
});

test("confirmed company quotation example preserves goods/services withholding and net", () => {
  const { body, review } = quote([
    "185617.82",
    "319055.1",
    "231244.08",
    "96703.4",
    "245995.78",
    "99953.4",
    "37626.8",
  ]);
  service(body, review, "20000");
  const before = structuredClone(body);
  const value = calculateQuotation(body, review);
  assert.equal(value.gross, "1236196.38");
  assert.equal(value.ewtGoods, "10858.90");
  assert.equal(value.ewtServices, "357.14");
  assert.equal(value.net, "1224980.34");
  assert.deepEqual(value.issues, []);
  assert.deepEqual(body, before);
});

test("inclusive and exclusive offers reconcile and non-taxable service excludes VAT and EWT", () => {
  const { body, review } = quote();
  service(body, review);
  assert.equal(calculateQuotation(body, review).net, "221.00");
  body.lines[0].unitPrice = "100";
  body.adjustments[0].value = "100";
  review.priceBasis = "exclusive";
  const exclusive = calculateQuotation(body, review);
  assert.equal(exclusive.gross, "224.00");
  assert.equal(exclusive.vat, "24.00");
  assert.equal(exclusive.net, "221.00");
  review.adjustments[0].taxable = false;
  const untaxed = calculateQuotation(body, review);
  assert.equal(untaxed.gross, "212.00");
  assert.equal(untaxed.ewtServices, "0.00");
  review.vatStatus = "NON-VAT";
  assert.equal(calculateQuotation(body, review).net, "200.00");
});

test("existing rounding stages and fixed adjustment precision are preserved", () => {
  const { body, review } = quote(["19.995", "10.555"]);
  body.lines[0].quantity = "3";
  body.lines[0].discountValue = "5";
  review.rows[0].discountType = "percentage";
  body.lines[1].quantity = "2";
  body.lines[1].discountValue = "1.01";
  review.rows[1].discountType = "fixed";
  review.priceBasis = "exclusive";
  review.vatRate = "10";
  service(body, review, "1.005");
  const id = crypto.randomUUID();
  body.adjustments.push({
    id,
    label: "Discount",
    kind: "",
    basis: "",
    value: "15",
    taxable: "",
    sourceDetails: "",
  });
  review.adjustments.push({
    id,
    kind: "discount",
    calculation: "percentage",
    taxable: true,
    reason: "",
    summaryBasis: "",
  });
  const value = calculateQuotation(body, review);
  assert.equal(value.materials, "77.09");
  assert.equal(value.gross, "73.19");
  assert.equal(value.net, "72.40");
});

test("document discounts leave EWT bases unchanged and excessive discounts block negative net", () => {
  const { body, review } = quote(["1120"]);
  body.lines[0].discountValue = "10";
  review.rows[0].discountType = "percentage";
  service(body, review);
  const id = crypto.randomUUID();
  body.adjustments.push({
    id,
    label: "Document discount",
    kind: "",
    basis: "",
    value: "112",
    taxable: "",
    sourceDetails: "",
  });
  review.adjustments.push({
    id,
    kind: "discount",
    calculation: "fixed",
    taxable: true,
    reason: "",
    summaryBasis: "",
  });
  const value = calculateQuotation(body, review);
  assert.equal(value.gross, "1008.00");
  assert.equal(value.ewtGoods, "9.00");
  assert.equal(value.ewtServices, "2.00");
  assert.equal(value.net, "997.00");
  body.adjustments[1].value = "1119";
  assert.ok(
    calculateQuotation(body, review).issues.some((issue) =>
      issue.includes("EWT cannot exceed"),
    ),
  );
});

test("included VAT is rounded once over aggregate taxable contributions", () => {
  const { body, review } = quote(["100", "100", "100"]);
  body.printedTax = "32.14";
  assert.equal(calculateQuotation(body, review).vat, "32.14");
  body.printedTax = "32.13";
  assert.ok(
    calculateQuotation(body, review).issues.some((issue) =>
      issue.includes("Printed VAT"),
    ),
  );
});

test("printed totals use declared gross/net basis with no cent tolerance or note override", () => {
  const { body, review } = quote();
  service(body, review);
  body.printedTotal = "221";
  review.totalBasis = "net";
  assert.deepEqual(calculateQuotation(body, review).issues, []);
  body.printedTotal = "221.01";
  body.financialNotes = "Supplier checked";
  assert.ok(
    calculateQuotation(body, review).issues.some((issue) =>
      issue.includes("Printed total"),
    ),
  );
});

test("free and reference rows require deliberate review; blank prices do not become zero", () => {
  const { body, review } = quote(["112", "0"]);
  assert.ok(
    calculateQuotation(body, review).issues.some((issue) =>
      issue.includes("free"),
    ),
  );
  review.rows[1].free = true;
  assert.deepEqual(calculateQuotation(body, review).issues, []);
  body.lines[1].unitPrice = "";
  assert.ok(calculateQuotation(body, review).issues.length);
  review.rows[1].role = "reference";
  review.rows[1].reason = "Alternative excluded from supplier total";
  assert.deepEqual(calculateQuotation(body, review).issues, []);
});

test("summary rows reconcile without double-counting and unclassified or mixed-tax rows block", () => {
  const { body, review } = quote(["100", "12"]);
  review.priceBasis = "exclusive";
  review.rows[1].role = "summary";
  review.rows[1].summaryBasis = "vat";
  review.rows[1].amountField = "unitPrice";
  review.rows[1].reason = "Printed VAT summary";
  assert.equal(calculateQuotation(body, review).gross, "112.00");
  assert.deepEqual(calculateQuotation(body, review).issues, []);
  body.lines[0].taxRate = "0";
  assert.ok(
    calculateQuotation(body, review).issues.some((issue) =>
      issue.includes("Mixed material"),
    ),
  );
  assert.equal(
    parseFinancialReview({ ...review, rows: [...review.rows, review.rows[0]] }),
    null,
  );
});

test("header readiness requires reference/date/terms and rejects foreign, expired and inverted validity", () => {
  const { body } = quote();
  assert.deepEqual(quotationHeaderIssues(body, "2026-11-05"), []);
  body.currency = "";
  assert.deepEqual(quotationHeaderIssues(body, "2026-11-05"), []);
  body.currency = "USD";
  body.deliveryTerms = "";
  body.validUntil = "2026-11-04";
  assert.equal(quotationHeaderIssues(body, "2026-11-05").length, 4);
});
