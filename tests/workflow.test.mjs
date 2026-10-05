import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { budgetFor, paidTotal, poTotal, stockFor } from '../src/domain/selectors.ts';
import { accountingNextAction, releaseBlocker } from '../src/domain/workflow.ts';
import { tasksFor, dashboardMetrics } from '../src/domain/queues.ts';
import { validBidReport } from '../src/domain/bid-reports.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { ROLES } from '../src/domain/types.ts';

let sequence = 0;
const context = { now: () => '2026-10-05T09:00:00.000Z', id: prefix => `${prefix}-flow-${++sequence}` };
const run = (state, command) => { const result = applyCommand(state, command, context); assert.equal(result.ok, true, result.message); return result.snapshot; };
const as = (state, role) => run(state, { type: 'setRole', role });
const fail = (state, command, pattern) => { const original = structuredClone(state); const result = applyCommand(state, command, context); assert.equal(result.ok, false); if (pattern) assert.match(result.message, pattern); assert.deepEqual(state, original, 'Failed commands must preserve the source snapshot'); };

function submittedPO() {
  let state = as(blankWorkspace(), 'Administrator');
  state = run(state, { type: 'addSite', name: 'Client project', location: 'Pasig', budget: 10000 });
  const siteId = state.sites[0].id;
  state = run(state, { type: 'setProjectDriveFolder', siteId, folderId: 'project-folder' });
  state = as(state, 'Site Personnel');
  state = run(state, { type: 'saveRequest', intent: 'submit', siteId, ref: 'MRF-CLIENT-001', requestDate: '2026-10-05', requestedBy: 'Site user', approvedBy: 'Signatory', purchaser: 'Buyer', financeOfficer: 'Finance', documents: [{ name: 'Supporting.pdf', type: 'Supporting PDF', fileId: 'support' }], items: [{ id: 'cement', name: 'Cement', unit: 'bag', quantity: 10, neededDate: '2026-10-06', purpose: '', location: 'Pasig', remarks: '' }] });
  const request = state.requests[0];
  fail(as(state, 'Management'), { type: 'reviewRequest', id: request.id, decision: 'approve' }, /Procurement/);
  state = as(state, 'Procurement');
  state = run(state, { type: 'reviewRequest', id: request.id, decision: 'approve' });
  state = run(state, { type: 'completeRequestArchive', id: request.id, formFileId: 'form', supportFileId: 'support', formUrl: 'https://drive.google.com/file/d/form/view', supportUrl: 'https://drive.google.com/file/d/support/view' });
  state = run(state, { type: 'saveQuoteDraft', quote: { id: 'offer', mrfId: request.id, supplierId: '', ref: 'QT-001', currency: 'PHP', prices: {}, available: 'In stock', leadDays: 1, terms: 'Agreed supplier terms', extraction: 'manual', reviewStatus: 'draft', supplierDetails: { name: 'Supplier', address: 'Pasig', tin: '', contactName: '', email: '', phone: '' }, documents: [{ name: 'Quote.pdf', type: 'application/pdf', fileId: 'quotation' }], adjustments: [], lines: [{ id: 'offer-cement', requestItemId: 'cement', description: 'Cement', quantity: 10, unit: 'bag', unitPrice: 100, conversionFactor: 1, brand: '', specification: '', varianceReason: '', matchConfirmed: true }] } });
  state = run(state, { type: 'finalizeQuote', id: 'offer' });
  state = run(state, { type: 'completeQuoteArchive', id: 'offer', files: [{ localFileId: 'quotation', driveFileId: 'quote-drive', url: 'https://drive.google.com/file/d/quote-drive/view', name: 'Quote.pdf' }] });
  state = run(state, { type: 'createBidReport', requestId: request.id });
  assert.equal(state.pos.length, 0, 'Comparison must precede PO creation');
  assert.equal(validBidReport(state.bidReports[0]), true);
  state = run(state, { type: 'createAwardPO', requestId: request.id, quoteId: 'offer', lines: [{ itemId: 'cement', quoteLineId: 'offer-cement', quantity: 10, unitPrice: 100 }], tax: 0, freight: 0, discount: 0, reason: 'Confirmed supplier offer', notes: '' });
  state = run(state, { type: 'savePO', id: state.pos[0].id, quoteId: 'offer', notes: '', finalize: true });
  assert.equal(state.pos[0].status, 'submitted');
  return as(state, 'Accounting / Auditing');
}
function approve(state, mode = 'upfront') {
  const po = state.pos[0];
  state = run(state, { type: 'saveAccountingPO', id: po.id, paymentMode: mode, financial: { ...po.financial, reviewed: true } });
  return run(state, { type: 'reviewPO', id: po.id, decision: 'approve' });
}
const archive = state => run(state, { type: 'completePOArchive', id: state.pos[0].id, fileId: 'po-drive', url: 'https://drive.google.com/file/d/po-drive/view' });
function requestPayment(state, amount = poTotal(state, state.pos[0]) - paidTotal(state, state.pos[0].id)) {
  return run(as(state, 'Accounting / Auditing'), { type: 'savePaymentRequest', poId: state.pos[0].id, amount, note: 'Supplier payment', submit: true });
}
function pay(state) {
  const id = state.paymentRequests.at(-1).id;
  state = as(state, 'Finance');
  state = run(state, { type: 'reviewPaymentRequest', id, decision: 'approve' });
  return run(state, { type: 'recordPayment', paymentRequestId: id, method: 'Bank', reference: 'BANK-001', date: '2026-10-05' });
}

test('upfront flow waits for full actual disbursement, then delivers, posts and records usage', () => {
  let state = archive(approve(submittedPO())); const id = state.pos[0].id, siteId = state.sites[0].id;
  fail(state, { type: 'releasePO', id }, /Full Finance disbursement/);
  fail(as(state, 'Logistics'), { type: 'createBatch', poId: id, scheduledDate: '2026-10-06', evidence: 'DR-1', delayReason: '', expected: { cement: 10 } });
  state = requestPayment(state);
  const paymentRequestId = state.paymentRequests[0].id;
  const committed = budgetFor(state, siteId);
  state = run(as(state, 'Finance'), { type: 'reviewPaymentRequest', id: paymentRequestId, decision: 'approve' });
  assert.equal(paidTotal(state, id), 0); assert.deepEqual(budgetFor(state, siteId), committed);
  fail(as(state, 'Accounting / Auditing'), { type: 'releasePO', id }, /Full Finance disbursement/);
  state = run(state, { type: 'recordPayment', paymentRequestId, method: 'Bank', reference: 'BANK-1', date: '2026-10-05' });
  assert.equal(state.accounting.length, 0, 'Upfront disbursement does not require delivery receipts');
  assert.equal(budgetFor(state, siteId).available, committed.available); assert.equal(budgetFor(state, siteId).spent, 1000);
  state = run(as(state, 'Accounting / Auditing'), { type: 'releasePO', id });
  state = run(as(state, 'Logistics'), { type: 'createBatch', poId: id, scheduledDate: '2026-10-06', evidence: 'DR-1', delayReason: '', expected: { cement: 6 } });
  const batchId = state.batches[0].id;
  state = run(as(state, 'Site Personnel'), { type: 'confirmBatch', id: batchId, lines: { cement: { accepted: 5, issue: 'One damaged bag' } } });
  assert.equal(stockFor(state, siteId, 'Cement', 'bag'), 0);
  state = run(state, { type: 'postBatch', id: batchId, accepted: { cement: 5 }, reason: '' });
  fail(state, { type: 'postBatch', id: batchId, accepted: { cement: 5 }, reason: '' });
  state = run(state, { type: 'recordMovement', siteId, itemName: 'Cement', unit: 'bag', kind: 'usage', quantity: 2, reason: 'Site concrete work' });
  assert.equal(stockFor(state, siteId, 'Cement', 'bag'), 3);
  assert.equal(state.pos[0].releasedBy, 'Accounting / Auditing'); assert.equal(state.payments[0].actor, 'Finance');
});

test('credit releases with no payment request and Finance can pay after delivery starts', () => {
  let state = archive(approve(submittedPO(), 'credit')); const id = state.pos[0].id;
  assert.deepEqual(state.paymentRequests, []); assert.equal(releaseBlocker(state, state.pos[0]), '');
  state = run(state, { type: 'releasePO', id });
  state = run(as(state, 'Logistics'), { type: 'createBatch', poId: id, scheduledDate: '2026-10-06', evidence: 'DR-credit', delayReason: '', expected: { cement: 10 } });
  state = pay(requestPayment(state));
  assert.equal(state.pos[0].status, 'released'); assert.equal(state.batches[0].status, 'expected'); assert.equal(paidTotal(state, id), 1000);
});

test('partial payment requests retain history and upfront release waits for the balance', () => {
  let state = archive(approve(submittedPO())); const id = state.pos[0].id;
  state = pay(requestPayment(state, 400));
  fail(as(state, 'Accounting / Auditing'), { type: 'releasePO', id }, /Full Finance disbursement/);
  state = pay(requestPayment(state, 600));
  assert.equal(state.paymentRequests.length, 2); assert.ok(state.paymentRequests.every(value => value.status === 'disbursed'));
  state = run(as(state, 'Accounting / Auditing'), { type: 'releasePO', id }); assert.equal(paidTotal(state, id), 1000);
});

test('payment hold, return, resubmission and rejection preserve the approved PO', () => {
  let state = requestPayment(archive(approve(submittedPO()))); const request = state.paymentRequests[0], po = structuredClone(state.pos[0]);
  fail(as(state, 'Finance'), { type: 'reviewPaymentRequest', id: request.id, decision: 'return', reason: 'No' });
  state = run(as(state, 'Finance'), { type: 'reviewPaymentRequest', id: request.id, decision: 'hold', reason: 'Confirm supplier details' });
  state = run(state, { type: 'reviewPaymentRequest', id: request.id, decision: 'return', reason: 'Correct payment note' });
  state = run(as(state, 'Accounting / Auditing'), { type: 'savePaymentRequest', id: request.id, poId: po.id, amount: 500, note: 'Corrected note', submit: true });
  assert.equal(state.paymentRequests[0].id, request.id); assert.equal(state.paymentRequests[0].reason, undefined);
  state = run(as(state, 'Finance'), { type: 'reviewPaymentRequest', id: request.id, decision: 'reject', reason: 'Supplier payment cancelled' });
  state = requestPayment(state); assert.equal(state.paymentRequests.length, 2); assert.equal(state.paymentRequests[0].status, 'rejected');
  assert.deepEqual(state.pos[0], po); assert.equal(paidTotal(state, po.id), 0);
});

test('one open payment request, amount bounds and duplicate disbursement are enforced', () => {
  let state = archive(approve(submittedPO())); const poId = state.pos[0].id;
  for (const amount of [0, -1, NaN, Infinity, 1000.01, 0.001]) fail(state, { type: 'savePaymentRequest', poId, amount, note: '', submit: true });
  state = requestPayment(state, 300); const id = state.paymentRequests[0].id;
  fail(state, { type: 'savePaymentRequest', poId, amount: 200, note: '', submit: false }, /open payment request/);
  fail(as(state, 'Finance'), { type: 'recordPayment', paymentRequestId: id, method: 'Bank', reference: 'REF', date: '2026-10-05' });
  state = run(as(state, 'Finance'), { type: 'reviewPaymentRequest', id, decision: 'approve' });
  for (const patch of [{ reference: '' }, { date: '2026-02-30' }, { method: 'Invalid' }]) fail(state, { type: 'recordPayment', paymentRequestId: id, method: 'Bank', reference: 'REF', date: '2026-10-05', ...patch });
  state = run(state, { type: 'recordPayment', paymentRequestId: id, method: 'Bank', reference: 'REF', date: '2026-10-05' });
  fail(state, { type: 'recordPayment', paymentRequestId: id, method: 'Bank', reference: 'REF', date: '2026-10-05' });
  assert.equal(state.payments.length, 1); assert.equal(paidTotal(state, poId), 300);
});

test('Accounting budget approval covers both arrangements, locks prices and preserves purchasing fields', () => {
  for (const paymentMode of ['upfront', 'credit']) {
    let state = submittedPO(); const po = structuredClone(state.pos[0]);
    const command = { type: 'saveAccountingPO', id: po.id, paymentMode, financial: { ...po.financial, priceBasis: 'exclusive', ewtGoods: 20, reviewed: true }, adjustments: [{ id: 'freight', label: 'Freight', kind: 'shipping', calculation: 'fixed', value: 100, included: true, confirmed: true, taxable: false }] };
    state = run(state, command);
    assert.equal(poTotal(state, state.pos[0]), 1200); assert.deepEqual(state.pos[0].lines, po.lines); assert.deepEqual(state.pos[0].document, po.document);
    state.sites[0].budget = 1199; fail(state, { type: 'reviewPO', id: po.id, decision: 'approve' }, /budget/);
    state.sites[0].budget = 1200; state = run(state, { type: 'reviewPO', id: po.id, decision: 'approve' });
    assert.equal(budgetFor(state, state.sites[0].id).available, 0); fail(state, command, /locked/);
  }
});

test('Accounting PO holds and returns reopen Procurement editing without committing budget', () => {
  let state = submittedPO(); const id = state.pos[0].id;
  state = run(state, { type: 'reviewPO', id, decision: 'hold', reason: 'Confirm tax treatment' });
  assert.equal(budgetFor(state, state.sites[0].id).committed, 0);
  state = run(state, { type: 'reviewPO', id, decision: 'return', reason: 'Revise supplier schedule' });
  state = run(as(state, 'Procurement'), { type: 'savePO', id, quoteId: 'offer', notes: 'Corrected schedule', finalize: true });
  assert.equal(state.pos[0].status, 'submitted'); assert.equal(state.pos[0].reviewReason, undefined);
  state = run(as(state, 'Accounting / Auditing'), { type: 'reviewPO', id, decision: 'reject', reason: 'Order no longer required' });
  assert.equal(budgetFor(state, state.sites[0].id).committed, 0);
});

test('department permissions reject crossed handoffs and Management has oversight only', () => {
  const submitted = submittedPO(), approved = archive(approve(submitted)), requested = requestPayment(approved), disbursable = run(as(requested, 'Finance'), { type: 'reviewPaymentRequest', id: requested.paymentRequests[0].id, decision: 'approve' });
  const checks = [
    [submitted, { type: 'reviewPO', id: submitted.pos[0].id, decision: 'approve' }, 'Accounting / Auditing'],
    [approved, { type: 'savePaymentRequest', poId: approved.pos[0].id, amount: 100, note: '', submit: true }, 'Accounting / Auditing'],
    [requested, { type: 'reviewPaymentRequest', id: requested.paymentRequests[0].id, decision: 'approve' }, 'Finance'],
    [disbursable, { type: 'recordPayment', paymentRequestId: requested.paymentRequests[0].id, method: 'Bank', reference: 'REF', date: '2026-10-05' }, 'Finance'],
    [approved, { type: 'releasePO', id: approved.pos[0].id }, 'Accounting / Auditing'],
  ];
  for (const [state, command, owner] of checks) for (const role of ROLES) if (role !== owner) fail(as(state, role), command, /Switch/);
  assert.deepEqual(tasksFor(as(submitted, 'Management')), []);
});

test('archive failures block Logistics while allowing independent payment preparation', () => {
  let state = approve(submittedPO(), 'credit'); const id = state.pos[0].id;
  state = run(state, { type: 'failPOArchive', id, error: 'Drive unavailable' });
  fail(state, { type: 'releasePO', id }, /Archive/);
  state = requestPayment(state); assert.equal(state.paymentRequests[0].status, 'submitted');
  state = archive(state); assert.equal(releaseBlocker(state, state.pos[0]), '');
  state = run(state, { type: 'releasePO', id }); assert.equal(state.pos[0].status, 'released');
});

test('role queues distinguish Accounting release from Finance review and disbursement', () => {
  let state = submittedPO(); assert.equal(dashboardMetrics(state).accountingReviews, 1); assert.equal(dashboardMetrics(state).financeReviews, 0);
  state = archive(approve(state, 'credit')); assert.equal(accountingNextAction(state, state.pos[0]), 'Release to Logistics');
  state = requestPayment(state); assert.equal(tasksFor(as(state, 'Finance'))[0].href, `/finance/${state.pos[0].id}`);
  state = run(as(state, 'Finance'), { type: 'reviewPaymentRequest', id: state.paymentRequests[0].id, decision: 'approve' });
  assert.match(tasksFor(state)[0].title, /Disburse/); assert.equal(dashboardMetrics(state).financeReviews, 1);
});

test('v11 is preserved until explicit reset; current payment and release history survives reload', async () => {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  const old = JSON.stringify({ ...submittedPO(), version: 11 }); const saved = new Map([['hml-constructsync-demo-v11', old]]);
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  try {
    const repo = new LocalDemoRepository(); assert.equal((await repo.load()).status, 'recovery'); assert.equal(saved.get('hml-constructsync-demo-v11'), old);
    assert.equal(saved.has('hml-constructsync-demo-v12'), false); await repo.reset(); assert.equal(saved.has('hml-constructsync-demo-v11'), false);
    let state = pay(requestPayment(archive(approve(submittedPO())))); state = run(as(state, 'Accounting / Auditing'), { type: 'releasePO', id: state.pos[0].id });
    saved.set('hml-constructsync-demo-v12', JSON.stringify(state)); assert.deepEqual((await new LocalDemoRepository().load()).snapshot, JSON.parse(JSON.stringify(state)));
    const malformed = structuredClone(state); malformed.pos[0].status = 'served'; saved.set('hml-constructsync-demo-v12', JSON.stringify(malformed)); assert.equal((await new LocalDemoRepository().load()).status, 'recovery');
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});
