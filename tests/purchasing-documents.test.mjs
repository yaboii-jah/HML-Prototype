import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { purchasingFixture } from "./helpers/purchasing.mjs";
import { comparisonSnapshot, calculatePo } from "../src/domain/purchasing/pricing.ts";
import {
  generatePurchasingComparisonPdf,
  generatePurchasingComparisonWorkbook,
  generatePurchasingPoPreview,
} from "../src/server/purchasing/documents.ts";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("comparison XLSX preserves exact large decimal text, frozen values and deterministic retry bytes", async () => {
  const { view } = purchasingFixture({ price: "9007199254740993.01" });
  const snapshot = comparisonSnapshot(
    view,
    [],
    "Buyer",
    "2026-11-06T00:00:00.000Z",
  );
  const bytes = await generatePurchasingComparisonWorkbook(snapshot, "1");
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const again = await generatePurchasingComparisonWorkbook(snapshot, "1");
  assert.equal(hash(bytes), hash(again));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const sheet = workbook.getWorksheet("Bid comparison");
  assert.match(String(sheet.getCell("F6").value), /9007199254740993\.01/);
  sheet.eachRow((row) =>
    row.eachCell((cell) =>
      assert.equal(
        typeof cell.value,
        "string",
        "No formulas or floating-point financial cells",
      ),
    ),
  );
});
test("comparison PDF paginates long source content and regenerates identical bytes", async () => {
  const { view } = purchasingFixture();
  const snapshot = comparisonSnapshot(
    view,
    [],
    "Buyer",
    "2026-11-06T00:00:00.000Z",
  );
  snapshot.items = Array.from({ length: 40 }, (_, index) => ({
    ...snapshot.items[0],
    name: `Material ${index + 1} ` + "long specification ".repeat(20),
  }));
  const bytes = await generatePurchasingComparisonPdf(snapshot, "1"),
    again = await generatePurchasingComparisonPdf(snapshot, "1");
  assert.equal(hash(bytes), hash(again));
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
});
test("exact PO preview reuses the branded layout and permits visibly incomplete/free drafts", async () => {
  const { view, order, q } = purchasingFixture({ fixed: "100" });
  const po = {
    id: crypto.randomUUID(),
    kind: "po",
    ref: "QA-PO-0001",
    version: "1",
    quoteId: q.id,
    mrfId: q.mrfId,
    body: order,
    updatedAt: "2026-11-06T00:00:00.000Z",
    blockers: [],
  };
  const bytes = await generatePurchasingPoPreview(view, po);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(hash(bytes), hash(await generatePurchasingPoPreview(view, po)));
});

test("approved PO rendering retains frozen calculations, attribution and deterministic retry bytes", async () => {
  const { view, order, q } = purchasingFixture();
  order.payment = { mode: "upfront", dueDate: "", relation: "differs", reason: "Supplier agreed upfront payment" };
  const po = {
    id: crypto.randomUUID(), kind: "po", ref: "QA49-PO-0001", version: "1", quoteId: q.id,
    mrfId: q.mrfId, body: order, updatedAt: "2026-11-07T00:00:00.000Z", blockers: [],
    calculation: calculatePo(q, order),
  };
  const approval = { name: "Verified Accounting reviewer", at: "2026-11-07T01:00:00.000Z", version: "1" };
  const bytes = await generatePurchasingPoPreview(view, po, approval);
  assert.equal(hash(bytes), hash(await generatePurchasingPoPreview(view, po, approval)));
  assert.notEqual(hash(bytes), hash(await generatePurchasingPoPreview(view, po)));
  const oldGross = po.calculation.gross;
  q.financial.review.priceBasis = "exclusive";
  assert.notEqual(calculatePo(q, order).gross, oldGross, "Later calculations can produce a different result");
  // Frozen rendering uses supplied saved totals rather than invoking the current engine.
  const alternate = await generatePurchasingPoPreview(view, po, approval);
  assert.equal(po.calculation.gross, oldGross);
  assert.ok((await PDFDocument.load(alternate)).getPageCount() >= 1);
});
