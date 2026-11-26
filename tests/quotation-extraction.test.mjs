import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyQuoteBody, emptyQuoteLine, parseQuoteCommand } from '../src/domain/quotations/drafts.ts';
import { fillQuotation, parseQuoteExtraction, undoQuotationFill } from '../src/domain/quotations/extraction.ts';

const pdf = { id: crypto.randomUUID(), pages: 2 };
const image = { id: crypto.randomUUID(), pages: 1 };
const fixture = () => ({
  header: {
    supplierName: { file: 1, page: 1, value: 'Fixture Materials' },
    printedTax: { file: 2, page: 1, value: '0' },
    printedTotal: { file: 2, page: 1, value: '12345678901234567890.12345678901234567890' },
    date: { file: 1, page: 1, value: '2026-02-30' },
    currency: { file: 3, page: 1, value: 'PHP' },
  },
  lines: [
    { file: 1, page: 2, description: '  Plain Cement ', quantity: '12.12500', unit: 'bag', unitPrice: '0.00', conversionFactor: '99' },
    { file: 2, page: 1, description: 'Plain cement', quantity: '12.125', unit: 'bag', unitPrice: '2.00', printedTotal: '24.250' },
  ],
  adjustments: [{ file: 2, page: 1, label: 'Freight', value: '0.000', sourceDetails: 'Local delivery' }],
  notes: [{ file: 2, page: 1, text: 'Check the   printed discount.' }],
});

test('quotation extraction keeps exact printed decimals and physical original locations', () => {
  const { body, notes } = parseQuoteExtraction(fixture(), [pdf, image]);
  assert.equal(body.printedTax, '0');
  assert.equal(body.printedTotal, '12345678901234567890.12345678901234567890');
  assert.equal(body.date, '');
  assert.equal(body.currency, '');
  assert.equal(body.lines[0].quantity, '12.12500');
  assert.equal(body.lines[0].sourcePage, '2');
  assert.equal(body.lines[0].sourceFileId, pdf.id);
  assert.equal(body.lines[0].conversionFactor, '');
  assert.equal(body.lines[1].sourceFileId, image.id);
  assert.equal(body.adjustments[0].value, '0.000');
  assert.ok(notes.some(note => note.sourceFileId === image.id && note.text === 'Check the printed discount.'));
  const invalid = fixture();
  invalid.lines[1].page = 2;
  assert.equal(parseQuoteExtraction(invalid, [pdf, image]), null);
});

test('quotation autofill preserves edits and deduplicates complete printed rows without human mapping or provenance', () => {
  const proposal = parseQuoteExtraction(fixture(), [pdf, image]).body;
  const saved = { ...emptyQuoteBody(), supplierName: 'Saved Name', lines: [{ ...emptyQuoteLine(), description: 'plain  CEMENT', unit: 'BAG', quantity: '012.125', unitPrice: '-0', conversionFactor: '1', requestItemId: crypto.randomUUID() }] };
  const current = { ...saved, notes: 'Current note', printedTotal: '123', lines: [...saved.lines] };
  const after = fillQuotation(current, saved, proposal, new Set(['printedTax']));
  assert.deepEqual(after.lines[0], current.lines[0]);
  assert.equal(after.lines.length, 2);
  assert.equal(after.lines[1].unitPrice, '2.00');
  assert.equal(after.supplierName, 'Saved Name');
  assert.equal(after.printedTax, '');
  assert.equal(after.printedTotal, '123');
  assert.equal(after.notes, 'Current note');
  assert.deepEqual(fillQuotation(after, saved, proposal, new Set(['printedTax'])), after);
});

test('undo removes unchanged extraction values and preserves subsequent field and row edits', () => {
  const proposed = parseQuoteExtraction(fixture(), [pdf, image]).body;
  const before = emptyQuoteBody();
  const after = fillQuotation(before, before, proposed, new Set());
  const newRow = { ...emptyQuoteLine(), description: 'Manual line' };
  const current = { ...after, notes: 'Typed later', supplierName: 'Corrected supplier', lines: [after.lines[0], { ...after.lines[1], notes: 'Typed on row' }, newRow] };
  const undone = undoQuotationFill(current, { before, after });
  assert.equal(undone.notes, 'Typed later');
  assert.equal(undone.supplierName, 'Corrected supplier');
  assert.equal(undone.printedTax, '');
  assert.equal(undone.adjustments.length, 0);
  assert.equal(undone.lines.length, 2);
  assert.equal(undone.lines[0].notes, 'Typed on row');
  assert.equal(undone.lines[0].sourceFileId, null);
  assert.deepEqual(undone.lines[1], newRow);
});

test('quotation save parses an optional extraction proof and rejects malformed proofs', () => {
  const manual = { type: 'save', requestId: crypto.randomUUID(), quoteId: crypto.randomUUID(), expectedVersion: '1', body: emptyQuoteBody() };
  const guarded = { ...manual, extractionProposalId: crypto.randomUUID() };
  assert.deepEqual(parseQuoteCommand(manual), manual);
  assert.deepEqual(parseQuoteCommand(guarded), guarded);
  assert.equal(parseQuoteCommand({ ...manual, extractionProposalId: '' }), null);
});
