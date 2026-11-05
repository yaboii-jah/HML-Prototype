import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  emptyQuoteBody,
  emptyQuoteLine,
  parseQuoteCommand,
} from "../src/domain/quotations/drafts.ts";
import {
  emptyFinancialReview,
  calculateQuotation,
} from "../src/domain/quotations/financial.ts";
import {
  parseCalculation,
  parseFinancialCommand,
} from "../src/domain/quotations/revisions.ts";
import { generateQuotationReviewPdf } from "../src/server/quotations/review-pdf.ts";
import { pageText } from "./helpers/pdf-text.mjs";

function fixture() {
  const source = {
    ...emptyQuoteBody(),
    ref: "SUP-45B",
    date: "2026-11-05",
    paymentTerms: "30 days",
    deliveryTerms: "Delivered to project",
    lines: Array.from({ length: 18 }, (_, index) => ({
      ...emptyQuoteLine(),
      description: `Source material ${index + 1}: specification retained through pagination`,
      unit: "pc",
      quantity: "1",
      unitPrice: "112.0000",
      conversionFactor: "1",
      requestItemId: randomUUID(),
    })),
  };
  const review = {
    ...emptyFinancialReview(source),
    vatStatus: "VAT",
    priceBasis: "inclusive",
    vatRate: "12",
  };
  review.rows = review.rows.map((row) => ({ ...row, role: "material" }));
  const calculation = calculateQuotation(source, review);
  return {
    id: randomUUID(),
    number: "1",
    finalizedAt: "2026-11-05T08:00:00.000Z",
    finalizedBy: "Verified Procurement",
    mrfRef: "QA-MRF-0045",
    mrfArchiveId: randomUUID(),
    source,
    review,
    calculation,
    files: [
      {
        id: randomUUID(),
        name: "supplier-original.pdf",
        mime: "application/pdf",
        size: 123,
        sha256: "a".repeat(64),
      },
    ],
  };
}

test("financial commands reject browser-supplied calculation snapshots and preserve opaque versions", () => {
  const input = {
    type: "saveFinancial",
    requestId: randomUUID(),
    quoteId: randomUUID(),
    expectedVersion: "9007199254740993",
    expectedFiles: "2",
    review: fixture().review,
  };
  assert.deepEqual(parseQuoteCommand(input), input);
  for (const field of ["calculation", "snapshot", "totals"])
    assert.equal(
      parseQuoteCommand({ ...input, [field]: { net: "0.00" } }),
      null,
    );
  const finalize = {
    type: "finalize",
    requestId: randomUUID(),
    quoteId: input.quoteId,
    expectedVersion: "1",
    expectedFiles: "2",
    expectedFinancial: "3",
    expectedFamily: "4",
  };
  assert.deepEqual(parseFinancialCommand(finalize), finalize);
  assert.equal(parseFinancialCommand({ ...finalize, expectedFamily: 4 }), null);
  assert.equal(
    parseFinancialCommand({ ...finalize, type: "withdraw", reason: "no" }),
    null,
  );
  assert.equal(
    parseFinancialCommand({
      ...finalize,
      type: "reconfirmMrf",
      reason: "Offer still applies",
      expectedMrf: "forged",
    }),
    null,
  );
  const calculation = fixture().calculation;
  assert.deepEqual(parseCalculation(calculation), calculation);
  assert.equal(parseCalculation({ ...calculation, net: 1 }), null);
});

test("internal review PDF retains exact source text, provenance, totals and every overflow row", async () => {
  const input = fixture();
  input.source.notes = "Retained supporting source notes. ".repeat(100);
  const before = structuredClone(input);
  const bytes = await generateQuotationReviewPdf(input);
  const again = await generateQuotationReviewPdf(input);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(again).digest("hex"),
    "Frozen retries produce the same PDF",
  );
  assert.deepEqual(
    input,
    before,
    "PDF generation never rewrites source or calculation",
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  const positions = pdf.getPages().flatMap((page) => pageText(pdf, page));
  const text = positions.map((row) => row.text).join("\n");
  for (const expected of [
    "Internal quotation review",
    "Verified Procurement",
    "QA-MRF-0045",
    "Source material 18",
    "112.0000",
    "supplier-original.pdf",
    "a".repeat(64),
    "Net after EWT",
    input.mrfArchiveId,
  ])
    assert.ok(text.includes(expected), `PDF contains ${expected}`);
  assert.ok(
    positions.every(
      (row) => row.x >= 40 && row.x < 554 && row.y >= 28 && row.y <= 802,
    ),
    "All text anchors remain inside page margins",
  );
});
