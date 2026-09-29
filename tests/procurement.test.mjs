import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { migrateV3OrV4 } from "../src/mock/repository.ts";
import { poTotal } from "../src/domain/selectors.ts";

let sequence = 0;
const context = { now: () => "2026-09-27T10:00:00.000Z", id: prefix => `${prefix}-proc-${++sequence}` };
const execute = (state, command) => { const result = applyCommand(state, command, context); assert.equal(result.ok, true, result.message); return result.snapshot; };
const setup = () => {
  let state = seedDemo();
  const request = structuredClone(state.requests.find(value => value.id === "m3"));
  request.id = "procurement-request"; request.ref = "MRF-2026-099"; request.items[0].id = "procurement-item"; request.items[0].quantity = 10;
  state.requests.push(request);
  state = execute(state, { type: "setRole", role: "Procurement" });
  return { state, request };
};
const draft = (requestId, supplier, price, suffix) => ({ id: `draft-${suffix}`, mrfId: requestId, supplierId: "", ref: `Q-${suffix}`, prices: {}, available: "In stock", leadDays: 3, terms: "30 days", documents: [{ name: `supplier-${suffix}.pdf`, type: "application/pdf", fileId: `source-${suffix}` }], lines: [{ id: `line-${suffix}`, description: "Plywood", quantity: 10, unit: "sheet", unitPrice: price, brand: "", specification: "", requestItemId: "procurement-item", conversionFactor: 1, varianceReason: "", matchConfidence: "medium", matchConfirmed: false, discountType: "fixed", discountValue: 100, taxRate: 0, printedTotal: 10 * price - 90, discrepancyReason: "" }], currency: "PHP", extraction: "manual", reviewStatus: "draft", supplierDetails: { name: supplier, address: "", tin: "", contactName: "", email: "", phone: "" }, adjustments: [{ id: `shipping-${suffix}`, label: "Freight", kind: "shipping", calculation: "fixed", value: 50 }] });
const archive = (state, quoteId) => { const quote = state.quotes.find(value => value.id === quoteId); return execute(state, { type: "completeQuoteArchive", id: quoteId, files: quote.documents.map(document => ({ localFileId: document.fileId, driveFileId: `drive-${document.fileId}`, url: `https://drive.google.com/file/d/drive-${document.fileId}/view`, name: document.name })) }); };

test("Procurement can remove an unfinalized quotation draft without changing finalized offers", () => {
  let { state, request } = setup();
  const quote = draft(request.id, "Supplier A", 700, "delete");
  state = execute(state, { type: "saveQuoteDraft", quote });
  state = execute(state, { type: "deleteQuoteDraft", id: quote.id });
  assert.equal(state.quotes.some(value => value.id === quote.id), false);
  assert.equal(applyCommand(state, { type: "deleteQuoteDraft", id: state.quotes[0].id }, context).ok, false);
});

test("manual quotation needs a supplier file and completed Drive archive before award", () => {
  let { state, request } = setup();
  const quote = draft(request.id, "Supplier A", 700, "required-file");
  quote.documents = [];
  quote.lines[0].matchConfirmed = true;
  quote.lines[0].printedTotal = null;
  state = execute(state, { type: "saveQuoteDraft", quote });
  const missing = applyCommand(state, { type: "finalizeQuote", id: quote.id }, context);
  assert.equal(missing.ok, false);
  assert.match(missing.message, /supplier quotation PDF or image/);
  quote.documents = [{ name: "supplier.pdf", type: "application/pdf", fileId: "supplier-file" }];
  state = execute(state, { type: "saveQuoteDraft", quote });
  state = execute(state, { type: "finalizeQuote", id: quote.id });
  assert.equal(applyCommand(state, { type: "stageAward", requestId: request.id, quoteId: quote.id, quoteLineId: quote.lines[0].id, quantity: 1 }, context).ok, false);
  state = archive(state, quote.id);
  state = execute(state, { type: "stageAward", requestId: request.id, quoteId: quote.id, quoteLineId: quote.lines[0].id, quantity: 1 });
  assert.equal(state.pendingAwards.length, 1);
});

test("Finance approval waits for PO PDF archive before serving", () => {
  let { state, request } = setup();
  const quote = draft(request.id, "Supplier A", 700, "po-archive");
  quote.lines[0].matchConfirmed = true;
  quote.lines[0].printedTotal = null;
  state = execute(state, { type: "saveQuoteDraft", quote });
  state = execute(state, { type: "finalizeQuote", id: quote.id });
  state = archive(state, quote.id);
  state = execute(state, { type: "createAwardPO", requestId: request.id, quoteId: quote.id, lines: [{ itemId: request.items[0].id, quoteLineId: quote.lines[0].id, quantity: 2, unitPrice: 700 }], tax: 0, freight: 0, discount: 0, reason: "Supplier selected for price", notes: "" });
  const po = state.pos.at(-1);
  state = execute(state, { type: "savePO", id: po.id, quoteId: quote.id, lines: po.lines, tax: 0, freight: 0, discount: 0, notes: "", reason: po.selectionReason, finalize: true });
  state = execute(state, { type: "setRole", role: "Finance" });
  state = execute(state, { type: "reviewPO", id: po.id, decision: "approve" });
  assert.equal(state.pos.at(-1).archive.status, "pending");
  state = execute(state, { type: "setRole", role: "Procurement" });
  assert.equal(applyCommand(state, { type: "servePO", id: po.id }, context).ok, false);
  state = execute(state, { type: "completePOArchive", id: po.id, fileId: "drive-po", url: "https://drive.google.com/file/d/drive-po/view" });
  state = execute(state, { type: "servePO", id: po.id });
  assert.equal(state.pos.at(-1).status, "served");
});

test("quote drafts persist through commands and cannot finalize with unresolved match or printed total", () => {
  let { state, request } = setup();
  const quote = draft(request.id, "Supplier A", 700, "a");
  state = execute(state, { type: "saveQuoteDraft", quote });
  assert.equal(state.quotes.at(-1).reviewStatus, "draft");
  assert.equal(applyCommand(state, { type: "finalizeQuote", id: quote.id }, context).ok, false);
  quote.lines[0].matchConfirmed = true;
  state = execute(state, { type: "saveQuoteDraft", quote });
  assert.equal(applyCommand(state, { type: "finalizeQuote", id: quote.id }, context).ok, false);
  quote.lines[0].discrepancyReason = "Supplier confirmed a printed rounding difference";
  quote.adjustments[0] = { ...quote.adjustments[0], kind: "discount", value: 7000 };
  state = execute(state, { type: "saveQuoteDraft", quote });
  assert.equal(applyCommand(state, { type: "finalizeQuote", id: quote.id }, context).ok, false);
  quote.adjustments[0] = { ...quote.adjustments[0], kind: "shipping", value: 50 };
  state = execute(state, { type: "saveQuoteDraft", quote });
  state = execute(state, { type: "finalizeQuote", id: quote.id });
  assert.equal(state.quotes.at(-1).reviewStatus, "finalized");
  assert.equal(state.quotes.at(-1).archive.status, "pending");
  assert.equal(state.suppliers.some(value => value.name === "Supplier A"), true);
  assert.equal(applyCommand(state, { type: "saveQuoteDraft", quote }, context).ok, false);
});

test("staged split awards enforce both quantity caps and generate supplier POs atomically", () => {
  let { state, request } = setup();
  const a = draft(request.id, "Supplier A", 700, "a"), b = draft(request.id, "Supplier B", 680, "b");
  for (const quote of [a, b]) { quote.lines[0].matchConfirmed = true; quote.lines[0].discrepancyReason = "Confirmed by supplier"; state = execute(state, { type: "saveQuoteDraft", quote }); state = execute(state, { type: "finalizeQuote", id: quote.id }); state = archive(state, quote.id); }
  assert.equal(applyCommand(state, { type: "stageAward", requestId: request.id, quoteId: a.id, quoteLineId: a.lines[0].id, quantity: 11 }, context).ok, false);
  state = execute(state, { type: "stageAward", requestId: request.id, quoteId: a.id, quoteLineId: a.lines[0].id, quantity: 6 });
  assert.equal(applyCommand(state, { type: "stageAward", requestId: request.id, quoteId: b.id, quoteLineId: b.lines[0].id, quantity: 5 }, context).ok, false);
  state = execute(state, { type: "stageAward", requestId: request.id, quoteId: b.id, quoteLineId: b.lines[0].id, quantity: 4 });
  const before = state.pos.length;
  state = execute(state, { type: "generateAwardPOs", requestId: request.id, reasons: { [state.quotes.find(value => value.id === a.id).supplierId]: "Confirmed Supplier A" } });
  assert.equal(state.pos.length, before + 2);
  assert.equal(state.pendingAwards.length, 0);
  const first = state.pos.at(-2);
  const second = state.pos.at(-1);
  assert.equal(first.selectionReason, "Confirmed Supplier A");
  assert.equal(second.selectionReason, "");
  const duplicateSupplier = applyCommand(state, { type: "savePO", id: first.id, quoteId: second.quoteId, lines: first.lines, notes: "", finalize: false, reason: first.selectionReason }, context);
  assert.equal(duplicateSupplier.ok, false);
  assert.match(duplicateSupplier.message, /active PO already exists/);
  assert.equal(first.lines[0].quantity, 6);
  assert.equal(first.lines[0].discountValue, 0);
  assert.equal(first.lines[0].fixedDiscountConfirmed, false);
  assert.equal(poTotal(state, first), 4250);
  assert.equal(applyCommand(state, { type: "savePO", id: first.id, quoteId: first.quoteId, notes: "", finalize: true, reason: first.selectionReason }, context).ok, false);
  const updatedLines = first.lines.map(line => ({ ...line, discountValue: 60, fixedDiscountConfirmed: true }));
  const adjustments = first.adjustments.map(value => ({ ...value, value: 30, confirmed: true }));
  state = execute(state, { type: "savePO", id: first.id, quoteId: first.quoteId, lines: updatedLines, adjustments, notes: "", finalize: true, reason: first.selectionReason });
  assert.equal(poTotal(state, state.pos.find(value => value.id === first.id)), 4170);
});

test("a finalized quote revision blocks old draft PO finalization until Procurement explains its choice", () => {
  let { state, request } = setup();
  const quote = draft(request.id, "Supplier A", 700, "a"); quote.lines[0].matchConfirmed = true; quote.lines[0].discrepancyReason = "Supplier confirmed amount";
  state = execute(state, { type: "saveQuoteDraft", quote }); state = execute(state, { type: "finalizeQuote", id: quote.id }); state = archive(state, quote.id);
  state = execute(state, { type: "stageAward", requestId: request.id, quoteId: quote.id, quoteLineId: quote.lines[0].id, quantity: 5 });
  const supplierId = state.quotes.find(value => value.id === quote.id).supplierId;
  state = execute(state, { type: "generateAwardPOs", requestId: request.id, reasons: { [supplierId]: "Confirmed supplier selection" } });
  const po = state.pos.at(-1);
  const revision = structuredClone(quote); revision.id = "draft-revision"; revision.supersedesId = quote.id; revision.lines[0].id = "revised-line"; revision.lines[0].unitPrice = 680; revision.lines[0].printedTotal = null; revision.supplierId = supplierId;
  state = execute(state, { type: "saveQuoteDraft", quote: revision }); state = execute(state, { type: "finalizeQuote", id: revision.id });
  const lines = po.lines.map(line => ({ ...line, fixedDiscountConfirmed: true }));
  const adjustments = po.adjustments.map(value => ({ ...value, confirmed: true }));
  assert.equal(applyCommand(state, { type: "savePO", id: po.id, quoteId: po.quoteId, lines, adjustments, notes: "", reason: po.selectionReason, finalize: true }, context).ok, false);
  state = execute(state, { type: "savePO", id: po.id, quoteId: po.quoteId, lines, adjustments, notes: "", reason: po.selectionReason, supersededReason: "Supplier confirmed original offer still applies", finalize: true });
  assert.equal(state.pos.at(-1).status, "finalized");
  assert.equal(state.pos.at(-1).quoteId, quote.id);
});

test("v4 browser data migrates to v10 with prior POs and awardable legacy quotations", () => {
  const old = structuredClone(seedDemo()); old.version = 4; delete old.pendingAwards; old.quotes.forEach(quote => { delete quote.reviewStatus; delete quote.lines; });
  const migrated = migrateV3OrV4(old);
  assert.equal(migrated.version, 10);
  assert.equal(migrated.pos[0].quoteId, old.pos[0].quoteId);
  assert.equal(migrated.quotes[0].reviewStatus, "finalized");
  assert.equal(migrated.quotes[0].lines[0].requestItemId, "m1-i1");
  assert.deepEqual(migrated.pendingAwards, []);
});
