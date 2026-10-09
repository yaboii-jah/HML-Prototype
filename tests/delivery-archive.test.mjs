import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { deliveryDocumentIssues } from '../src/domain/delivery-archive.ts';
import { validDeliveryReceipt } from '../src/domain/delivery-document.ts';
import { operationAllows, operationError, operationFingerprint } from '../src/domain/operations.ts';
import { ACCOUNT_FIXTURES } from '../src/app-state/demo-session.ts';

let sequence = 0;
const execute = (state, command, role = 'Site Personnel') => {
  const account = ACCOUNT_FIXTURES.find(value => value.role === role);
  return applyCommand(state, command, { now: () => '2026-10-09T08:00:00Z', id: prefix => `${prefix}-${++sequence}`, actor: { name: account.name, email: account.email, role } });
};
const run = (state, command, role) => { const result = execute(state, command, role); assert.equal(result.ok, true, result.message); return result.snapshot; };
const doc = (name = 'signed') => ({ name: `${name}.pdf`, kind: 'Signed delivery receipt', mime: 'application/pdf', size: 1024, sha256: 'a'.repeat(64), localFileId: name });
function received(leg = 'supplier-site') {
  let state = seedDemo(); state.batches = []; state.movements = []; state.accounting = [];
  state = run(state, { type: 'createBatch', poId: 'po1', leg, scheduledDate: '2026-10-09', evidence: 'DR', delayReason: '', expected: { 'm1-i1': 10 }, ...(leg === 'supplier-warehouse' ? { destination: { name: 'Depot', address: 'Pasig' } } : {}) }, 'Logistics');
  const batchId = state.batches[0].id;
  state = run(state, { type: 'dispatchBatch', id: batchId }, 'Logistics');
  state = run(state, { type: 'confirmBatch', id: batchId, lines: { 'm1-i1': { accepted: 10, issue: '' } } }, leg === 'supplier-warehouse' ? 'Procurement' : 'Site Personnel');
  return state;
}
const complete = { type: 'saveDocuments', poId: 'po1', invoiceRef: 'INV', receiptRef: 'DR', review: 'Complete', note: 'Verified' };
const archive = (state, batch = state.batches[0], role = 'Accounting / Auditing') => run(state, { type: 'completeDeliveryReceiptArchive', batchId: batch.id, receiptId: batch.receiptVersions.at(-1).id, fileId: 'generated-file', url: 'https://drive.google.com/file/d/generated-file/view' }, role);
const signed = (state, batch = state.batches[0], name = 'signed') => {
  state = run(state, { type: 'attachAccountingDocuments', poId: batch.poId, batchId: batch.id, documents: [doc(name)] }, 'Accounting / Auditing');
  const document = state.accounting.find(value => value.poId === batch.poId).documents.at(-1);
  return run(state, { type: 'completeAccountingArchive', poId: batch.poId, documentId: document.id, fileId: `signed-${name}`, url: `https://drive.google.com/file/d/signed-${name}/view` }, 'Accounting / Auditing');
};

test('receipt confirmation captures immutable data and corrections create a separate version', () => {
  let state = received(), original = structuredClone(state.batches[0].receiptVersions[0]);
  assert.equal(original.data.batch.lines[0].accepted, 10);
  assert.equal(original.data.batch.receiptVersions, undefined);
  assert.ok(validDeliveryReceipt(original.data));
  state = run(state, { type: 'failDeliveryReceiptArchive', batchId: state.batches[0].id, receiptId: original.id, error: 'Drive unavailable' });
  assert.equal(state.batches[0].status, 'confirmed');
  state = run(state, { type: 'postBatch', id: state.batches[0].id, accepted: { 'm1-i1': 8 }, reason: 'Two damaged units excluded' });
  assert.equal(state.movements[0].quantity, 8);
  assert.equal(state.batches[0].receiptVersions.length, 2);
  assert.deepEqual(state.batches[0].receiptVersions[0].data, original.data);
  assert.equal(state.batches[0].receiptVersions[1].data.batch.lines[0].accepted, 8);
  assert.ok(validDeliveryReceipt(state.batches[0].receiptVersions[1].data));
});

test('unchanged stock posting creates no duplicate receipt and completed archives ignore late failures', () => {
  let state = received(); state = archive(state);
  const batch = state.batches[0];
  state = run(state, { type: 'failDeliveryReceiptArchive', batchId: batch.id, receiptId: batch.receiptVersions[0].id, error: 'Late failure' });
  assert.equal(state.batches[0].receiptVersions[0].archive.status, 'complete');
  state = run(state, { type: 'postBatch', id: batch.id, accepted: { 'm1-i1': 10 }, reason: '' });
  assert.equal(state.batches[0].receiptVersions.length, 1);
});

test('Accounting requires archived current generated and signed receipts, and preserves review history', () => {
  let state = received();
  assert.equal(deliveryDocumentIssues(state, 'po1').length, 2);
  assert.equal(execute(state, complete, 'Accounting / Auditing').ok, false);
  state = archive(state); state = signed(state);
  assert.deepEqual(deliveryDocumentIssues(state, 'po1'), []);
  state = run(state, complete, 'Accounting / Auditing');
  state = run(state, { type: 'postBatch', id: state.batches[0].id, accepted: { 'm1-i1': 9 }, reason: 'One damaged unit removed' });
  assert.equal(state.accounting[0].review, 'Under Review');
  assert.equal(state.accounting[0].reviewHistory[0].review, 'Complete');
  assert.equal(state.accounting[0].reviewHistory[0].by.role, 'Accounting / Auditing');
  assert.equal(deliveryDocumentIssues(state, 'po1').length, 2);
  state = archive(state); assert.equal(execute(state, complete, 'Accounting / Auditing').ok, false);
  state = signed(state, state.batches[0], 'corrected');
  state = run(state, complete, 'Accounting / Auditing');
  assert.equal(state.accounting[0].review, 'Complete');
});

test('warehouse evidence belongs to Procurement or Accounting and every delivery leg is checked', () => {
  let state = received('supplier-warehouse'), parent = state.batches[0];
  const attach = { type: 'attachAccountingDocuments', poId: 'po1', batchId: parent.id, documents: [doc()] };
  assert.equal(execute(state, attach).ok, false);
  assert.equal(execute(state, attach, 'Procurement').ok, true);
  assert.equal(execute(state, attach, 'Accounting / Auditing').ok, true);
  state = run(state, { type: 'createBatch', poId: 'po1', leg: 'warehouse-site', parentBatchId: parent.id, scheduledDate: '2026-10-09', evidence: 'ONWARD', delayReason: '', expected: { 'm1-i1': 5 } }, 'Logistics');
  const onward = state.batches.at(-1);
  state = run(state, { type: 'dispatchBatch', id: onward.id }, 'Logistics');
  state = run(state, { type: 'confirmBatch', id: onward.id, lines: { 'm1-i1': { accepted: 5, issue: '' } } });
  assert.ok(validDeliveryReceipt(state.batches.at(-1).receiptVersions[0].data));
  assert.equal(deliveryDocumentIssues(state, 'po1').length, 4);
  const other = { ...attach, batchId: onward.id };
  assert.equal(execute(state, other, 'Procurement').ok, false);
  assert.equal(execute(state, other).ok, true);
});

test('Accounting can attach PO invoices before delivery; signed receipts require a received batch', () => {
  const state = received(); state.batches = []; state.pos.find(po => po.id === 'po1').status = 'approved';
  const command = { type: 'attachAccountingDocuments', poId: 'po1', documents: [{ ...doc(), kind: 'Invoice' }] };
  assert.equal(execute(state, command, 'Accounting / Auditing').ok, true);
  for (const role of ['Site Personnel', 'Procurement', 'Finance', 'Administrator']) assert.equal(execute(state, command, role).ok, false);
  assert.equal(execute(state, { ...command, documents: [doc()] }, 'Accounting / Auditing').ok, false);
  assert.equal(execute(state, { ...command, batchId: 'foreign-batch' }, 'Accounting / Auditing').ok, false);
});

test('historical receipts are captured only explicitly, while generic evidence requires classification', () => {
  let state = received(); delete state.batches[0].receiptVersions;
  state = run(state, { type: 'captureDeliveryReceipt', id: state.batches[0].id }, 'Accounting / Auditing');
  const receipt = structuredClone(state.batches[0].receiptVersions[0]);
  state = run(state, { type: 'captureDeliveryReceipt', id: state.batches[0].id }, 'Accounting / Auditing');
  assert.deepEqual(state.batches[0].receiptVersions, [receipt]);
  state = archive(state);
  state = run(state, { type: 'attachAccountingDocuments', poId: 'po1', batchId: state.batches[0].id, documents: [{ ...doc(), kind: 'Delivery receipt' }] });
  const document = state.accounting[0].documents[0];
  state = run(state, { type: 'completeAccountingArchive', poId: 'po1', documentId: document.id, fileId: 'signed-file', url: 'https://drive.google.com/file/d/signed-file/view' }, 'Accounting / Auditing');
  assert.equal(deliveryDocumentIssues(state, 'po1').length, 1);
  assert.equal(execute(state, { type: 'classifyAccountingDocument', poId: 'po1', documentId: document.id, batchId: document.batchId, kind: 'Signed delivery receipt' }).ok, false);
  state = run(state, { type: 'classifyAccountingDocument', poId: 'po1', documentId: document.id, batchId: document.batchId, kind: 'Signed delivery receipt' }, 'Accounting / Auditing');
  assert.deepEqual(deliveryDocumentIssues(state, 'po1'), []);
});

test('receipt operations bind to a specific snapshot and reject unrelated acknowledgments', () => {
  const state = received(), batch = state.batches[0], receipt = batch.receiptVersions[0];
  const target = { kind: 'delivery-receipt', batchId: batch.id, receiptId: receipt.id };
  assert.equal(operationError(state, target, 'Site Personnel'), '');
  assert.ok(operationError(state, target, 'Finance'));
  assert.ok(operationError(state, target, 'Procurement'));
  assert.ok(operationAllows(target, { type: 'failDeliveryReceiptArchive', batchId: batch.id, receiptId: receipt.id, error: 'Offline' }));
  assert.equal(operationAllows(target, { type: 'failDeliveryReceiptArchive', batchId: 'other', receiptId: receipt.id, error: 'Offline' }), false);
  const corrected = structuredClone(state); corrected.batches[0].receiptVersions[0].data.batch.lines[0].accepted = 9;
  assert.notEqual(operationFingerprint(state, target), operationFingerprint(corrected, target));
});
