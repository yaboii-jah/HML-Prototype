import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { requestSourcing, sourceStockAvailable, sourceStockOnHand, transferReservedFor, transferUnscheduled } from '../src/domain/stock-transfers.ts';
import { validTransferState } from '../src/domain/transfer-document.ts';
import { materialId } from '../src/domain/ids.ts';
import { materialAwardStatus } from '../src/domain/comparative-awards.ts';
import { budgetFor } from '../src/domain/selectors.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';

let nextId = 0;
function setup() {
  let state = seedDemo();
  state.pos = []; state.pendingAwards = []; state.batches = []; state.movements = []; state.payments = []; state.paymentRequests = [];
  const request = state.requests[0], source = state.sites.find(site => site.id !== request.siteId);
  request.status = 'approved'; delete request.archive; delete request.correction;
  request.items = [{ ...request.items[0], id: 'cement', name: 'Cement', unit: 'bag', quantity: 100 }];
  state.movements.push({ id: 'opening', siteId: source.id, itemName: 'CEMENT STOCK', unit: 'BAG', quantity: 80, kind: 'opening', reason: 'Opening stock', actor: 'Site Personnel', at: '2026-10-12T00:00:00Z' });
  const command = (role, input, sites = []) => {
    const context = { now: () => '2026-10-12T02:00:00Z', id: prefix => prefix + '-' + ++nextId, siteIds: sites, actor: { name: role + ' person', email: role.replaceAll(' ', '-') + '@example.com', role } };
    const result = applyCommand(state, input, context);
    if (result.ok) state = result.snapshot;
    return result;
  };
  const propose = quantity => command('Procurement', { type: 'proposeStockTransfer', requestId: request.id, sourceSiteId: source.id, note: 'Use spare stock', lines: [{ itemId: 'cement', sourceName: 'CEMENT STOCK', unit: 'BAG', quantity, suitabilityConfirmed: true }] });
  const approve = (transfer, quantity) => command('Site Personnel', { type: 'reviewStockTransfer', id: transfer.id, decision: 'approve', quantities: { [transfer.lines[0].id]: quantity }, reason: 'Spare stock available' }, [source.id]);
  const schedule = (transfer, quantity) => command('Logistics', { type: 'scheduleTransferDelivery', transferId: transfer.id, scheduledDate: '2026-10-13', evidence: 'Transfer receipt pending', quantities: { [transfer.lines[0].id]: quantity } });
  return { get state() { return state; }, request, source, command, propose, approve, schedule };
}
test('proposals reserve posted source stock and MRF demand without changing physical stock or budgets', () => {
  const f = setup(), budgets = f.state.sites.map(site => budgetFor(f.state, site.id));
  assert.equal(f.propose(40).ok, true);
  assert.equal(sourceStockOnHand(f.state, f.source.id, 'CEMENT STOCK', 'bag'), 80);
  assert.equal(sourceStockAvailable(f.state, f.source.id, ' CEMENT STOCK ', 'bag'), 40);
  assert.equal(requestSourcing(f.state, f.request, f.request.items[0]).purchase, 60);
  assert.deepEqual(f.state.sites.map(site => budgetFor(f.state, site.id)), budgets);
  assert.equal(f.propose(50).ok, false);
  assert.equal(f.state.stockTransfers.length, 1);
  assert.equal(validTransferState(f.state), true);
});
test('reservations protect usage/adjustments and site assignments protect source approval', () => {
  const f = setup(); f.propose(40); const transfer = f.state.stockTransfers[0], before = structuredClone(f.state);
  assert.equal(f.command('Site Personnel', { type: 'reviewStockTransfer', id: transfer.id, decision: 'approve', quantities: { [transfer.lines[0].id]: 40 }, reason: '' }, [f.request.siteId]).ok, false);
  assert.equal(f.command('Site Personnel', { type: 'recordMovement', siteId: f.source.id, itemName: 'CEMENT STOCK', unit: 'BAG', kind: 'usage', quantity: 50, reason: 'Concrete work' }, [f.source.id]).ok, false);
  assert.equal(f.command('Accounting / Auditing', { type: 'recordMovement', siteId: f.source.id, itemName: 'CEMENT STOCK', unit: 'BAG', kind: 'adjustment', quantity: -50, reason: 'Stock correction' }).ok, false);
  assert.deepEqual(f.state, before);
  assert.equal(f.command('Site Personnel', { type: 'recordMovement', siteId: f.source.id, itemName: 'CEMENT STOCK', unit: 'BAG', kind: 'usage', quantity: 1, reason: 'Concrete work' }, []).ok, false);
});
test('partial source approval, multiple trips and shortages preserve stock conservation and reopen demand', () => {
  const f = setup(); f.propose(40); let transfer = f.state.stockTransfers[0];
  assert.equal(f.approve(transfer, 25).ok, true); transfer = f.state.stockTransfers[0];
  assert.equal(sourceStockAvailable(f.state, f.source.id, 'CEMENT STOCK', 'BAG'), 55);
  assert.equal(f.schedule(transfer, 20).ok, true);
  const delivery = f.state.transferDeliveries[0], lineId = transfer.lines[0].id;
  assert.equal(f.schedule(transfer, 6).ok, false);
  assert.equal(f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id }).ok, true);
  assert.equal(f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id }).ok, false);
  assert.equal(sourceStockOnHand(f.state, f.source.id, 'CEMENT STOCK', 'BAG'), 60);
  assert.equal(transferReservedFor(f.state, f.source.id, materialId('CEMENT STOCK', 'BAG')), 5);
  assert.equal(f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [lineId]: { accepted: 18, issue: 'Two bags damaged' } } }, [f.source.id]).ok, false);
  assert.equal(f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [lineId]: { accepted: 18, issue: 'Two bags damaged' } } }, [f.request.siteId]).ok, true);
  assert.equal(requestSourcing(f.state, f.request, f.request.items[0]).purchase, 77);
  assert.equal(sourceStockOnHand(f.state, f.request.siteId, 'Cement', 'bag'), 0);
  assert.equal(f.command('Site Personnel', { type: 'postTransferDelivery', id: delivery.id, quantities: { [lineId]: 18 }, reason: '' }, [f.request.siteId]).ok, true);
  assert.equal(f.command('Site Personnel', { type: 'postTransferDelivery', id: delivery.id, quantities: { [lineId]: 18 }, reason: '' }, [f.request.siteId]).ok, false);
  assert.equal(sourceStockOnHand(f.state, f.request.siteId, 'Cement', 'bag'), 18);
  assert.equal(transferUnscheduled(f.state, f.state.stockTransfers[0], lineId), 5);
  assert.equal(validTransferState(f.state), true);
});
test('trip cancellation retains stock for rescheduling; allocation cancellation releases only undispatched stock', () => {
  const f = setup(); f.propose(40); let transfer = f.state.stockTransfers[0]; f.approve(transfer, 40); transfer = f.state.stockTransfers[0];
  f.schedule(transfer, 20);
  assert.equal(f.command('Logistics', { type: 'cancelTransferDelivery', id: f.state.transferDeliveries[0].id, reason: 'Vehicle unavailable' }).ok, true);
  assert.equal(sourceStockAvailable(f.state, f.source.id, 'CEMENT STOCK', 'BAG'), 40);
  f.schedule(transfer, 10); const delivery = f.state.transferDeliveries[1];
  f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id });
  assert.equal(f.command('Procurement', { type: 'cancelStockTransfer', id: transfer.id, reason: 'Cancel remaining allocation' }).ok, true);
  assert.equal(sourceStockOnHand(f.state, f.source.id, 'CEMENT STOCK', 'BAG'), 70);
  assert.equal(sourceStockAvailable(f.state, f.source.id, 'CEMENT STOCK', 'BAG'), 70);
  assert.equal(requestSourcing(f.state, f.request, f.request.items[0]).purchase, 90);
  assert.equal(validTransferState(f.state), true);
});
test('saved supplier awards prevent overlapping proposals and committed transfers reduce purchasing capacity', () => {
  const f = setup();
  f.state.pendingAwards.push({ id: 'award', requestId: f.request.id, itemId: 'cement', quoteId: 'q', quoteLineId: 'l', quantity: 80 });
  assert.equal(f.propose(30).ok, false);
  assert.equal(f.propose(20).ok, true);
  assert.equal(materialAwardStatus(f.state, f.request, f.request.items[0], {}).remainingToOrder, 80);
});
test('MRF links and current transfer receipt snapshots survive a repository reload', () => {
  const f = setup(); f.propose(40); let transfer = f.state.stockTransfers[0]; f.approve(transfer, 40); transfer = f.state.stockTransfers[0]; f.schedule(transfer, 40);
  const delivery = f.state.transferDeliveries[0], lineId = transfer.lines[0].id;
  f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id });
  f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [lineId]: { accepted: 40, issue: '' } } }, [f.request.siteId]);
  const store = new Map([['hml-constructsync-demo-v12', JSON.stringify(f.state)]]);
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage; globalThis.window = { addEventListener() {} }; globalThis.localStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }; const repository = new LocalDemoRepository();
  assert.equal(repository.getSnapshot().status, 'ready');
  assert.equal(repository.getSnapshot().snapshot.transferDeliveries[0].receiptVersions[0].data.request.ref, f.request.ref); globalThis.window = previousWindow; globalThis.localStorage = previousStorage;
});


function stockQuote(f, index = 0) {
  const quote = f.state.quotes[index];
  quote.currency = 'PHP'; quote.reviewStatus = 'finalized'; quote.archive = { status: 'complete', files: [] };
  quote.financial = { vatStatus: 'VAT', priceBasis: 'exclusive', vatRate: 12, reviewed: true };
  quote.lines = [{ id: quote.id + '-cement', requestItemId: 'cement', description: 'Cement', quantity: 100, unit: 'bag', unitPrice: 100, conversionFactor: 1, matchConfirmed: true, brand: '', specification: '', varianceReason: '', discountType: 'none', discountValue: 0 }];
  return quote;
}
function receiveTrip(f, amount = 40, accepted = amount) {
  assert.equal(f.propose(amount).ok, true); let transfer = f.state.stockTransfers.at(-1);
  assert.equal(f.approve(transfer, amount).ok, true); transfer = f.state.stockTransfers.at(-1);
  assert.equal(f.schedule(transfer, amount).ok, true); const delivery = f.state.transferDeliveries.at(-1), line = transfer.lines[0].id;
  assert.equal(f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id }).ok, true);
  assert.equal(f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [line]: { accepted, issue: accepted === amount ? '' : 'Damaged in transit' } } }, [f.request.siteId]).ok, true);
  return { transfer, delivery, line };
}

test('PO edits count saved awards while conversion consumes only the awards being converted', () => {
  const f = setup(), quote = stockQuote(f), other = stockQuote(f, 1); f.propose(40);
  const line = { itemId: 'cement', quoteLineId: quote.lines[0].id, quantity: 40, unitPrice: 100 };
  const made = f.command('Procurement', { type: 'createAwardPO', requestId: f.request.id, quoteId: quote.id, lines: [line], tax: 0, freight: 0, discount: 0, reason: 'Competitive price', notes: '' });
  assert.equal(made.ok, true, made.message); const poId = made.recordId;
  assert.equal(f.command('Procurement', { type: 'stageAward', requestId: f.request.id, quoteId: other.id, quoteLineId: other.lines[0].id, quantity: 20 }).ok, true);
  const before = structuredClone(f.state);
  assert.equal(f.command('Procurement', { type: 'savePO', id: poId, quoteId: quote.id, lines: [{ ...line, quantity: 60 }], notes: '', finalize: false }).ok, false);
  assert.deepEqual(f.state, before);
  f.state.pos.find(po => po.id === poId).status = 'submitted';
  const po = f.state.pos.find(po => po.id === poId);
  assert.equal(f.command('Accounting / Auditing', { type: 'saveAccountingPO', id: poId, paymentMode: 'upfront', financial: po.financial, lines: [{ ...line, quantity: 60 }] }).ok, false);
  const converted = f.command('Procurement', { type: 'generateAwardPOs', requestId: f.request.id, reasons: { [other.supplierId]: 'Available stock' } });
  assert.equal(converted.ok, true, converted.message); assert.equal(f.state.pendingAwards.length, 0); assert.equal(validTransferState(f.state), true);
});

test('quantity boundaries reject excess fractions and all successful trips remain reloadable', () => {
  const f = setup(); f.propose(40); let transfer = f.state.stockTransfers[0];
  assert.equal(f.approve(transfer, 40.0000005).ok, false);
  assert.equal(f.approve(transfer, 40).ok, true); transfer = f.state.stockTransfers[0];
  assert.equal(f.schedule(transfer, 40.0000005).ok, false);
  assert.equal(f.command('Logistics', { type: 'scheduleTransferDelivery', transferId: transfer.id, scheduledDate: '2026-02-30', evidence: 'Test', quantities: { [transfer.lines[0].id]: 40 } }).ok, false);
  assert.equal(f.schedule(transfer, 0.1).ok, true); const delivery = f.state.transferDeliveries[0], line = transfer.lines[0].id;
  f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id });
  assert.equal(f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [line]: { accepted: 0.1000005, issue: '' } } }, [f.request.siteId]).ok, false);
  assert.equal(f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [line]: { accepted: 0.1, issue: '' } } }, [f.request.siteId]).ok, true);
  assert.equal(validTransferState(f.state), true);
});

test('reload rejects missing or foreign stock debits and credits', () => {
  const f = setup(), { delivery, line } = receiveTrip(f);
  assert.equal(validTransferState(f.state), true);
  const noDebit = structuredClone(f.state); noDebit.movements = noDebit.movements.filter(value => value.kind !== 'transfer-out'); assert.equal(validTransferState(noDebit), false);
  f.command('Site Personnel', { type: 'postTransferDelivery', id: delivery.id, quantities: { [line]: 40 }, reason: '' }, [f.request.siteId]);
  const noCredit = structuredClone(f.state); noCredit.movements = noCredit.movements.filter(value => value.kind !== 'transfer-in'); assert.equal(validTransferState(noCredit), false);
  const foreign = structuredClone(f.state); foreign.movements.find(value => value.kind === 'transfer-in').siteId = f.source.id; assert.equal(validTransferState(foreign), false);
});

import { requestMonitoring } from '../src/domain/request-monitoring.ts';
import { requestLifecycle } from '../src/domain/request-lifecycle.ts';
import { comparisonItems } from '../src/domain/comparison-report.ts';
import { buildBidWorkbook } from '../src/server/bid-workbook.ts';
import { generateTransferReceiptPdf } from '../src/server/transfer-receipt-pdf.ts';
import { PDFDocument } from 'pdf-lib';
import { pageText } from './helpers/pdf-text.mjs';

test('new reports freeze remaining purchase quantities while historical report quantities stay intact', () => {
  const f = setup(); stockQuote(f); f.state.quotes = [f.state.quotes[0]]; f.state.sites.find(site => site.id === f.request.siteId).driveFolderId = 'transfer-reports-folder';
  const before = f.command('Procurement', { type: 'createBidReport', requestId: f.request.id }); assert.equal(before.ok, true, before.message);
  const historical = structuredClone(f.state.bidReports[0]); historical.comparisonRevision = 4; delete historical.data.sourcing;
  f.propose(40);
  const result = f.command('Procurement', { type: 'createBidReport', requestId: f.request.id }); assert.equal(result.ok, true, result.message);
  const report = f.state.bidReports.at(-1); assert.equal(report.comparisonRevision, 5); assert.equal(comparisonItems(report)[0].quantity, 60);
  const sheet = buildBidWorkbook(report).worksheets[0]; const row = sheet.getRows(1, sheet.rowCount).find(value => value.getCell(2).value === 'Cement');
  assert.equal(row.getCell(3).value, 60); assert.match(row.getCell(5).value, /Transfers\s*:\s*40/);
  f.command('Procurement', { type: 'cancelStockTransfer', id: f.state.stockTransfers[0].id, reason: 'Purchase instead' });
  assert.equal(comparisonItems(report)[0].quantity, 60); assert.equal(comparisonItems(historical)[0].quantity, 100);
});

test('monitoring and lifecycle include transfer-only transit, receipt, posting and financial exemption', () => {
  const f = setup(); f.state.movements[0].quantity = 100; f.propose(100); let transfer = f.state.stockTransfers[0];
  assert.match(requestMonitoring(f.state, f.request.id).logistics.detail, /source Site Personnel/);
  f.approve(transfer, 100); transfer = f.state.stockTransfers[0]; f.schedule(transfer, 100); const delivery = f.state.transferDeliveries[0], line = transfer.lines[0].id;
  assert.match(requestMonitoring(f.state, f.request.id).logistics.detail, /1 to dispatch/);
  f.command('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id });
  assert.match(requestMonitoring(f.state, f.request.id).logistics.detail, /1 legs/); assert.equal(requestMonitoring(f.state, f.request.id).finance.label, 'Not applicable');
  f.command('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [line]: { accepted: 100, issue: '' } } }, [f.request.siteId]);
  f.command('Site Personnel', { type: 'postTransferDelivery', id: delivery.id, quantities: { [line]: 100 }, reason: '' }, [f.request.siteId]);
  assert.equal(requestMonitoring(f.state, f.request.id).delivered.label, 'Delivered'); assert.equal(requestMonitoring(f.state, f.request.id).stock.label, 'Stock posted');
  assert.match(requestLifecycle(f.state, f.request.id).stages.find(stage => stage.name === 'Delivery').progress, /1 posted/);
});

test('Accounting completion needs archived current receipt evidence; corrected stock preserves earlier receipts', async () => {
  const f = setup(), { transfer, delivery, line } = receiveTrip(f, 40, 18);
  const receipt = f.state.transferDeliveries[0].receiptVersions[0], frozen = structuredClone(receipt.data);
  const evidence = { id: 'signed-v1', deliveryId: delivery.id, receiptVersion: 1, kind: 'Signed delivery receipt', name: 'Signed.pdf', mime: 'application/pdf', size: 1024, localFileId: 'signed-local', sha256: 'a'.repeat(64), uploadedAt: '', uploadedBy: 'Site Personnel', archive: { status: 'pending' } };
  assert.equal(f.command('Site Personnel', { type: 'attachTransferEvidence', transferId: transfer.id, documents: [evidence] }, [f.request.siteId]).ok, true);
  for (const command of [{ type: 'completeTransferReceiptArchive', deliveryId: delivery.id, receiptId: receipt.id }, { type: 'completeTransferEvidenceArchive', transferId: transfer.id, documentId: evidence.id }]) assert.equal(f.command('Accounting / Auditing', { ...command, fileId: 'receipt-file', url: 'https://drive.google.com/file/d/receipt-file/view' }).ok, true);
  assert.equal(f.command('Accounting / Auditing', { type: 'reviewTransferDocuments', id: transfer.id, status: 'Complete', note: '' }).ok, true);
  assert.equal(f.command('Site Personnel', { type: 'postTransferDelivery', id: delivery.id, quantities: { [line]: 17 }, reason: 'One additional bag unusable' }, [f.request.siteId]).ok, true);
  assert.deepEqual(f.state.transferDeliveries[0].receiptVersions[0].data, frozen); assert.equal(f.state.transferDeliveries[0].receiptVersions.length, 2);
  assert.equal(f.command('Accounting / Auditing', { type: 'reviewTransferDocuments', id: transfer.id, status: 'Complete', note: '' }).ok, false);
  const pdf = await PDFDocument.load(await generateTransferReceiptPdf(f.state.transferDeliveries[0].receiptVersions[1].data));
  const text = pdf.getPages().flatMap(page => pageText(pdf, page)).map(value => value.text).join(' ');
  assert.match(text, /STOCK TRANSFER RECEIPT/); assert.match(text, /CEMENT STOCK/); assert.match(text, /Cement/); assert.equal(validTransferState(f.state), true);
});

test('unassigned site accounts cannot start legacy receipt or evidence cloud operations', () => {
  const state = seedDemo(), batch = state.batches.find(value => value.status !== 'expected'), po = state.pos.find(value => value.id === batch.poId);
  po.status = 'released';
  const account = { name: 'Unassigned', email: 'unassigned@example.test', role: 'Site Personnel' };
  for (const target of [{ kind: 'attachment', poId: po.id, batchId: batch.id }, { kind: 'delivery-receipt', batchId: batch.id, receiptId: 'receipt' }, { kind: 'evidence', poId: po.id, documentId: 'proof' }]) {
    const result = applyCommand(state, { type: 'startOperation', id: 'op', target }, { now: () => '2026-10-12T02:00:00Z', id: prefix => prefix + '-test', actor: account, siteIds: [] });
    assert.equal(result.ok, false); assert.match(result.message, /assign your account/);
  }
});
