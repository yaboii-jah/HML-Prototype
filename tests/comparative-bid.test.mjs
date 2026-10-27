import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { captureBidReport, normalizedBidReportReadiness, validBidReport } from '../src/domain/bid-reports.ts';
import { resolveComparisonSelections } from '../src/domain/comparison-report.ts';
import { comparableMaterialAmount, comparableUnitPrice } from '../src/domain/comparative-pricing.ts';
import { awardInputValue, chooseMaterialOffer, currentComparisonQuotes, materialAwardStatus, offerAwardError, selectedMaterialOffer, wholeSupplierProposal } from '../src/domain/comparative-awards.ts';
import { buildBidWorkbook } from '../src/server/bid-workbook.ts';
import { generateBidPdf } from '../src/server/bid-pdf.ts';
import { pageText } from './helpers/pdf-text.mjs';

let sequence = 0;
const context = { now: () => '2026-10-12T02:00:00Z', id: prefix => prefix + '-' + ++sequence };
function fixture() {
  const state = seedDemo(); state.role = 'Procurement'; state.pos = []; state.pendingAwards = [];
  const request = state.requests[0]; request.archive = undefined; request.correction = undefined; request.status = 'approved';
  state.sites[0].driveFolderId = 'comparative-folder';
  request.items = ['x', 'y'].map(id => ({ ...request.items[0], id, name: 'Material ' + id, quantity: 10, unit: 'bag' }));
  const source = state.quotes[0];
  state.quotes = ['a', 'b', 'c'].map((id, index) => ({ ...structuredClone(source), id, mrfId: request.id, supplierId: id, ref: 'Q-' + id, reviewStatus: 'finalized', reviewedAt: context.now(), supplierDetails: { ...source.supplierDetails, name: 'Supplier ' + id }, archive: { status: 'complete', files: [] }, currency: 'PHP', financial: { vatStatus: index === 2 ? 'NON-VAT' : 'VAT', priceBasis: index === 1 ? 'inclusive' : 'exclusive', vatRate: 12, reviewed: true }, adjustments: [], lines: request.items.map(item => ({ id: id + '-' + item.id, requestItemId: item.id, description: item.name, quantity: 10, unit: 'bag', unitPrice: index === 1 ? 112 : 100, conversionFactor: 1, matchConfirmed: true, brand: '', specification: '', varianceReason: '', discountType: 'none', discountValue: 0, taxRate: 99 })) }));
  return { state, request, a: state.quotes[0], b: state.quotes[1], c: state.quotes[2] };
}
function reportFor(state, revision = 4) {
  const data = captureBidReport(state, state.requests[0].id, true);
  return { id: 'report', requestId: data.request.id, version: 1, generatedAt: context.now(), fileName: 'bid.xlsx', data, comparisonRevision: revision, comparisonSelections: resolveComparisonSelections(data), archive: { status: 'pending' } };
}

test('inclusive and exclusive material prices compare equally, NON-VAT remains untaxed, and charges/EWT stay separate', () => {
  const { a, b, c, request } = fixture();
  for (const quote of [a, b, c]) quote.adjustments = [{ id: 'freight', label: 'Delivery', kind: 'shipping', calculation: 'fixed', value: 999 }, { id: 'discount', label: 'Quote discount', kind: 'discount', calculation: 'fixed', value: 500 }];
  assert.equal(comparableUnitPrice(a, a.lines[0]), 112);
  assert.equal(comparableUnitPrice(b, b.lines[0]), 112);
  assert.equal(comparableUnitPrice(c, c.lines[0]), 100);
  assert.equal(comparableMaterialAmount(a, a.lines[0], request.items[0]), 1120);
  a.lines[0].discountType = 'percentage'; a.lines[0].discountValue = 10;
  assert.equal(comparableUnitPrice(a, a.lines[0]), 100.8);
});

test('fixed discounts are spread over converted offered units and required amounts retain internal precision', () => {
  const { a } = fixture();
  a.lines[0] = { ...a.lines[0], quantity: 3, unitPrice: 1000, conversionFactor: 7, discountType: 'fixed', discountValue: 100 };
  assert.equal(comparableUnitPrice(a, a.lines[0]), 3248 / 21);
  assert.equal(comparableMaterialAmount(a, a.lines[0], { quantity: 13 }), 2010.67);
  a.financial.priceBasis = 'inclusive'; assert.equal(comparableUnitPrice(a, a.lines[0]), 2900 / 21);
});

test('unknown, unreviewed, invalid and foreign financial bases never invent comparable prices', () => {
  const { a } = fixture();
  for (const mutate of [q => { delete q.financial; }, q => { q.financial.reviewed = false; }, q => { q.financial.vatRate = NaN; }, q => { q.currency = 'USD'; }, q => { q.lines[0].conversionFactor = 0; }]) {
    const quote = structuredClone(a); mutate(quote); assert.equal(comparableUnitPrice(quote, quote.lines[0]), undefined);
  }
});

test('choosing a material replaces supplier choices without writing records and caps a partial offer', () => {
  const { state, request, a, b } = fixture(), before = structuredClone(state);
  a.lines[0].quantity = 6;
  let edits = chooseMaterialOffer(state, request, request.items[0], { quote: b, line: b.lines[0] }, {});
  edits = chooseMaterialOffer(state, request, request.items[0], { quote: a, line: a.lines[0] }, edits);
  assert.equal(edits['a-x'], '6'); assert.equal(edits['b-x'], '0');
  assert.equal(materialAwardStatus(state, request, request.items[0], edits).unassigned, 4);
  before.quotes[0].lines[0].quantity = 6; assert.deepEqual(state, before);
});

test('whole-supplier preview replaces covered quantities, retains other choices for gaps and never mutates state or edits', () => {
  const { state, request, a } = fixture(); a.lines[0].quantity = 6; a.lines = [a.lines[0]];
  const edits = { 'b-x': '10', 'b-y': '8' }, before = structuredClone(state);
  const result = wholeSupplierProposal(state, request, a, edits, {});
  assert.equal(result.edits['a-x'], '6'); assert.equal(result.edits['b-x'], '4'); assert.equal(result.edits['b-y'], '8');
  assert.deepEqual(result.rows.map(row => [row.assigned, row.retained, row.gap]), [[6, 4, 0], [0, 8, 2]]);
  assert.equal(result.rows[1].note, 'Not quoted'); assert.equal(result.changedCount, 1);
  assert.deepEqual(edits, { 'b-x': '10', 'b-y': '8' }); assert.deepEqual(state, before);
});

test('alternatives require an explicit choice and existing PO suppliers cannot receive new bulk awards', () => {
  const { state, request, a } = fixture(); a.lines.push({ ...a.lines[0], id: 'a-alternative', unitPrice: 90 });
  assert.equal(selectedMaterialOffer(a, 'x', {}), undefined);
  const unresolved = wholeSupplierProposal(state, request, a, {}, {});
  assert.equal(unresolved.rows[0].assigned, 0); assert.match(unresolved.rows[0].note, /Choose a comparison offer/);
  const selected = wholeSupplierProposal(state, request, a, {}, { a: { x: 'a-alternative' } });
  assert.equal(selected.edits['a-alternative'], '10');
  state.pos.push({ id: 'existing', mrfId: request.id, quoteId: a.id, supplierId: a.supplierId, status: 'draft', lines: [] });
  assert.match(offerAwardError(state, a), /active PO/); assert.equal(wholeSupplierProposal(state, request, a, {}, {}).changedCount, 0);
});

test('saved split awards are replaced atomically and become separate supplier PO drafts only on explicit generation', () => {
  const { state, request, a, b } = fixture();
  let result = applyCommand(state, { type: 'replaceMaterialAwardBatch', requestId: request.id, materials: [{ itemId: 'x', awards: [{ quoteId: a.id, quoteLineId: 'a-x', quantity: 4 }, { quoteId: b.id, quoteLineId: 'b-x', quantity: 6 }] }, { itemId: 'y', awards: [{ quoteId: b.id, quoteLineId: 'b-y', quantity: 10 }] }] }, context);
  assert.equal(result.ok, true, result.message); assert.equal(result.snapshot.pos.length, 0);
  assert.equal(awardInputValue(result.snapshot, request.id, 'b-x', {}), '6');
  const saved = result.snapshot;
  result = applyCommand(saved, { type: 'replaceMaterialAwardBatch', requestId: request.id, materials: [{ itemId: 'x', awards: [] }, { itemId: 'y', awards: [{ quoteId: a.id, quoteLineId: 'a-y', quantity: 11 }] }] }, context);
  assert.equal(result.ok, false); assert.equal(saved.pendingAwards.length, 3);
  result = applyCommand(saved, { type: 'generateAwardPOs', requestId: request.id, reasons: {} }, context);
  assert.equal(result.ok, true, result.message); assert.equal(result.snapshot.pos.length, 2); assert.equal(result.snapshot.pendingAwards.length, 0);
});

test('current supplier columns use one current revision while stale saved awards remain discoverable', () => {
  const { state, a } = fixture(); state.quotes.push({ ...structuredClone(a), id: 'a-new', version: 2 });
  assert.deepEqual(currentComparisonQuotes(state, state.requests[0].id).map(q => q.id), ['a-new', 'b', 'c']);
});

test('revision 4 PDF and Excel share VAT-inclusive amounts and preserve revision 2/3 arithmetic', async () => {
  const { state, a } = fixture(); a.lines[0].discountType = 'percentage'; a.lines[0].discountValue = 10;
  const report = reportFor(state); assert.equal(validBidReport(report), true);
  const book = buildBidWorkbook(report), sheet = book.worksheets[0];
  const row = sheet.getRows(1, sheet.rowCount).find(row => row.getCell(2).value === 'Material x');
  assert.equal(row.getCell(6).value, 100.8); assert.equal(row.getCell(7).result, 1008); assert.match(row.getCell(7).formula, /^ROUND/);
  const values = []; sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.value).replace(/\s+/g, ' ').trim())));
  assert.equal(values.includes('Quotation Coverage'), false); assert.ok(values.includes('MATERIAL SUBTOTAL'));
  const pdf = await PDFDocument.load(await generateBidPdf(report));
  const text = pdf.getPages().flatMap(page => pageText(pdf, page).map(line => line.text)).join(' ');
  assert.match(text, /1,008.00/); assert.match(text, /VAT included/); assert.doesNotMatch(text, /Quotation Coverage/);
  for (const revision of [2, 3]) {
    const old = { ...report, comparisonRevision: revision };
    const oldRow = buildBidWorkbook(old).worksheets[0].getRows(1, 30).find(row => row.getCell(2).value === 'Material x');
    assert.equal(oldRow.getCell(6).value, 100); assert.equal(oldRow.getCell(7).result, 1000);
  }
});

test('new report creation requires VAT review, historical reports still validate and retries retain their frozen basis', () => {
  const { state } = fixture(); const old = reportFor(state, 3); delete old.data.offers[0].quote.financial;
  assert.equal(validBidReport(old), true); assert.equal(validBidReport({ ...old, comparisonRevision: 4 }), false);
  delete state.quotes[0].financial;
  assert.match(normalizedBidReportReadiness(state, state.requests[0].id), /Review VAT/);
  assert.equal(applyCommand(state, { type: 'createBidReport', requestId: state.requests[0].id }, context).ok, false);
});

test('an invalid selected offer cannot create an unusable normalized report', () => {
  const { state, request } = fixture(); state.quotes[0].lines[0].unitPrice = 0;
  const before = structuredClone(state);
  const result = applyCommand(state, { type: 'createBidReport', requestId: request.id }, context);
  assert.equal(result.ok, false); assert.match(result.message, /material price/); assert.deepEqual(state, before);
});
