import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { migrateV9, LocalDemoRepository } from "../src/mock/repository.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { bidReportReadiness, captureBidReport, validBidReport } from "../src/domain/bid-reports.ts";
import { quoteTotal, poTotal } from "../src/domain/selectors.ts";
import { quoteLineTotal } from "../src/domain/pricing.ts";
import { buildBidWorkbook, generateBidWorkbook } from "../src/server/bid-workbook.ts";
import { openBidUploadTicket, sealBidUploadTicket, validBidChunk } from "../src/server/bid-upload-ticket.ts";
import { uploadDocument } from "../src/features/requests/archive-purchasing.ts";

let sequence = 0;
const context = { now: () => "2026-09-30T08:00:00.000Z", id: prefix => `${prefix}-report-${++sequence}` };
const execute = (state, command) => { const result = applyCommand(state, command, context); assert.equal(result.ok, true, result.message); return result.snapshot; };
function fixture() {
  const state = seedDemo();
  state.role = "Procurement";
  state.sites[0].driveFolderId = "bid-project-folder";
  state.pos[0].lines = [{ itemId: "m1-i1", quoteLineId: state.quotes[1].lines[0].id, quantity: 60, unitPrice: 278, discountType: "fixed", discountValue: 20, taxRate: 12 }];
  state.pos[0].adjustments = [{ id: "freight", label: "Freight", kind: "shipping", calculation: "percentage", value: 3, included: true, confirmed: true }, { id: "excluded", label: "Not included", kind: "tax", calculation: "fixed", value: 100, included: false, confirmed: true }];
  return state;
}

test("comparison is available before POs and is independent of PO decisions", () => {
  const state = fixture();
  for (const status of ["draft", "submitted", "hold", "returned", "approved", "released", "rejected"]) { state.pos[0].status = status; assert.equal(bidReportReadiness(state, "m1"), ""); }
  state.pos = []; assert.equal(bidReportReadiness(state, "m1"), "");
  const captured = captureBidReport(state, "m1", true); assert.deepEqual(captured.pos, []);
  state.requests[0].correction = { status: "requested", scope: "documents", reason: "Replace supporting PDF" };
  assert.match(bidReportReadiness(state, "m1"), /correction/);
});

test("capture includes PO source and latest revisions, excludes non-PHP and freezes source records", () => {
  let state = fixture();
  state.quotes.push({ ...structuredClone(state.quotes[1]), id: "new-q2", supersedesId: "q2", version: 2 });
  state.quotes.push({ ...structuredClone(state.quotes[0]), id: "usd", supplierId: "usd-supplier", currency: "USD", supplierDetails: { name: "USD supplier" } });
  const data = captureBidReport(state, "m1");
  assert.deepEqual(data.offers.map(offer => [offer.quote.id, offer.source]), [["q1", "Latest bid"], ["q2", "PO source"], ["new-q2", "Latest bid"]]);
  assert.equal(data.excluded[0].currency, "USD");
  const original = state.quotes[0].lines[0].unitPrice;
  state.quotes[0].lines[0].unitPrice = 999;
  assert.equal(data.offers[0].quote.lines[0].unitPrice, original);
  state = execute(state, { type: "createBidReport", requestId: "m1" });
  const captured = structuredClone(state.bidReports[0]);
  state.requests[0].items[0].quantity = 200;
  state = execute(state, { type: "createBidReport", requestId: "m1" });
  assert.equal(state.bidReports[1].version, 2);
  assert.deepEqual(state.bidReports[0], captured);
  state.role = "Finance";
  assert.equal(applyCommand(state, { type: "createBidReport", requestId: "m1" }, context).ok, false);
});

test("saved workbook identities cannot be overwritten; failed archives retain downloadable records", () => {
  let state = execute(fixture(), { type: "createBidReport", requestId: "m1" });
  const id = state.bidReports[0].id;
  state = execute(state, { type: "saveBidReportFile", id, localFileId: "file", sha256: "a".repeat(64) });
  assert.equal(applyCommand(state, { type: "saveBidReportFile", id, localFileId: "other", sha256: "b".repeat(64) }, context).ok, false);
  state = execute(state, { type: "failBidArchive", id, error: "Drive unavailable" });
  assert.equal(state.bidReports[0].localFileId, "file");
  assert.equal(state.bidReports[0].archive.error, "Drive unavailable");
  state = execute(state, { type: "completeBidArchive", id, fileId: "drive-file", url: "https://drive.google.com/file/d/drive-file/view" });
  state = execute(state, { type: "failBidArchive", id, error: "late response" });
  assert.equal(state.bidReports[0].archive.status, "complete");
  assert.equal(state.bidReports[0].archive.error, undefined);
});

test("XLSX contains correct formulas, cached results, converted bids, unmatched lines and award coverage", async () => {
  let state = fixture();
  const quote = state.quotes[0];
  quote.supplierDetails = { name: '=HYPERLINK("https://example.com")' };
  quote.lines[0] = { ...quote.lines[0], quantity: 2.5, unit: "pallet", conversionFactor: 20, unitPrice: 4000, discountType: "percentage", discountValue: 5, taxRate: 12, varianceReason: "20 bags per pallet" };
  quote.lines.push({ ...quote.lines[0], id: "alternate", quantity: 5, unitPrice: 2100, discountType: "fixed", discountValue: 10 });
  quote.lines.push({ ...quote.lines[0], id: "unmatched", requestItemId: "", quantity: 1, unitPrice: 50 });
  quote.adjustments = [{ id: "freight", label: "Freight", kind: "shipping", calculation: "percentage", value: 5 }, { id: "discount", label: "Discount", kind: "discount", calculation: "percentage", value: 2 }];
  state = execute(state, { type: "createBidReport", requestId: "m1", comparisonSelections: { [quote.id]: { [quote.lines[0].requestItemId]: quote.lines[0].id } } });
  const report = state.bidReports[0];
  // Older frozen reports still use the original workbook and quoted-quantity calculations.
  delete report.comparisonRevision; delete report.comparisonSelections;
  const bytes = await generateBidWorkbook(report);
  assert.equal(bytes.subarray(0, 4).toString("hex"), "504b0304");
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ["Bid comparison", "Quotation details", "Awards"]);
  const comparison = book.getWorksheet("Bid comparison"), details = book.getWorksheet("Quotation details"), awards = book.getWorksheet("Awards");
  assert.equal(details.getCell("A9").type, ExcelJS.ValueType.String);
  assert.equal(details.getCell("A9").value, quote.supplierDetails.name);
  assert.equal(details.getCell("R9").result, quoteLineTotal(quote.lines[0]));
  assert.equal(details.getCell("S9").result, 50);
  assert.equal(details.getCell("T9").result, quoteLineTotal(quote.lines[0]) / 50);
  assert.equal(comparison.getCell("F12").result, quoteLineTotal(quote.lines[0]) / 50);
  assert.equal(comparison.getCell("G13").result, quoteLineTotal(quote.lines[1]));
  assert.equal(details.getCell("E11").value, "Unmatched");
  const totalRows = []; details.eachRow(row => { if (row.getCell(1).value === "Total (PHP)") totalRows.push(row); });
  assert.deepEqual(totalRows.map(row => row.getCell(18).result), report.data.offers.map(offer => quoteTotal(state, offer.quote)));
  const poRows = []; awards.eachRow(row => { if (row.getCell(6).value === "Total (PHP)") poRows.push(row); });
  assert.equal(poRows[0].getCell(17).result, poTotal(state, state.pos[0]));
  assert.equal(awards.lastRow.getCell(4).result, 60);
  assert.equal(awards.lastRow.getCell(5).result, 40);
  assert.equal(comparison.views[0].state, "frozen");
  assert.equal(comparison.pageSetup.orientation, "landscape");
  assert.equal(comparison.model.conditionalFormattings.length, 0);
  assert.equal(comparison.getCell("F12").fill.fgColor.argb, "FFF2CC");
  assert.equal(comparison.getCell("E12").value, null);
  assert.equal(comparison.getCell("AA11").value, "TOTAL COST");
  const invalid = structuredClone(report); invalid.data.offers[0].quote.lines[0].unitPrice = Infinity;
  assert.equal(validBidReport(invalid), false);
  assert.throws(() => buildBidWorkbook(invalid), /invalid/);
  const injected = structuredClone(report); injected.data.offers[0].quote.ref = { formula: "HYPERLINK(\"https://example.com\")" };
  assert.equal(validBidReport(injected), false);
});

test("current report history survives reload while old workflow records require manual reset", async () => {
  const old = fixture(); old.version = 9; delete old.bidReports;
  old.requests[0].scope = "Keep this browser edit";
  const migrated = migrateV9(old);
  assert.equal(migrated.version, 11); assert.deepEqual(migrated.bidReports, []);
  assert.equal(migrated.requests[0].scope, old.requests[0].scope);
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  const saved = new Map([["hml-constructsync-demo-v9", JSON.stringify(old)]]);
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  try {
    const blocked = new LocalDemoRepository(); assert.equal((await blocked.load()).status, "recovery");
    assert.equal(saved.has("hml-constructsync-demo-v9"), true);
    assert.equal((await blocked.execute({ type: "createBidReport", requestId: "m1" })).ok, false);
    await blocked.reset(); assert.equal(saved.has("hml-constructsync-demo-v9"), false);
    saved.set("hml-constructsync-demo-v12", JSON.stringify(fixture()));
    const repository = new LocalDemoRepository(); await repository.load();
    const result = await repository.execute({ type: "createBidReport", requestId: "m1" });
    assert.equal(result.ok, true);
    assert.equal(saved.has("hml-constructsync-demo-v9"), false);
    const reloaded = new LocalDemoRepository(); const view = await reloaded.load();
    assert.deepEqual(view.snapshot.bidReports, result.snapshot.bidReports);
    await reloaded.reset(); assert.equal(reloaded.getSnapshot().snapshot.bidReports.length, 0);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

test("bid upload tickets and chunks are XLSX-specific, bounded and reject tampering", () => {
  const previous = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
  process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = randomBytes(32).toString("base64");
  try {
    const sessionUri = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=bid";
    const ticket = sealBidUploadTicket({ reportId: "bid-1", total: 1024, sessionUri });
    assert.equal(openBidUploadTicket(ticket).reportId, "bid-1");
    assert.throws(() => openBidUploadTicket(`${ticket[0] === "A" ? "B" : "A"}${ticket.slice(1)}`), /invalid/);
    assert.throws(() => sealBidUploadTicket({ reportId: "bid-1", total: 51 * 1024 * 1024, sessionUri }), /invalid/);
    assert.throws(() => sealBidUploadTicket({ reportId: "bid-1", total: 1024, sessionUri: "https://evil.example/upload" }), /invalid/);
    assert.equal(validBidChunk(0, 4, Uint8Array.from([80, 75, 3, 4])), true);
    assert.equal(validBidChunk(0, 4, Uint8Array.from([37, 80, 68, 70])), false);
    assert.equal(validBidChunk(1, 5, Uint8Array.from([80, 75, 3, 4])), false);
  } finally { if (previous === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = previous; }
});

test("report chunk uploads recover a lost response without restarting or uploading duplicate bytes", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  const blob = new Blob([new Uint8Array(3 * 1024 * 1024 + 10)]);
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.method, init.headers["x-drive-upload-offset"]]);
    if (calls.length === 1) throw new Error("Lost response");
    const result = init.method === "POST" ? { offset: 3 * 1024 * 1024 } : { driveFileId: "bid-file", url: "https://drive.google.com/file/d/bid-file/view" };
    return Response.json(result);
  };
  try {
    const result = await uploadDocument(blob, "ticket", 0, "/api/drive/bid-comparisons/chunk");
    assert.equal(result.driveFileId, "bid-file");
    assert.deepEqual(calls.map(call => call.slice(1)), [["PUT", "0"], ["POST", undefined], ["PUT", String(3 * 1024 * 1024)]]);
  } finally { globalThis.fetch = previous; }
});
