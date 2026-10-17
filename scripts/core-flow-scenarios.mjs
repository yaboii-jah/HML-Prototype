import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildShowcase } from '../src/mock/fixtures/showcase.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { ACCOUNT_FIXTURES } from '../src/app-state/account-fixtures.ts';
import { localArchiveUrl } from '../src/domain/archive-destination.ts';
import { inventoryFor, paidTotal, poTotal } from '../src/domain/selectors.ts';
import { materialId } from '../src/domain/ids.ts';

/** Connected, command-validated snapshots for paper figures; never edits a user's workspace. */
export function coreFlowScenarios() {
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const due = new Date(now.getTime() + 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const built = buildShowcase('paper-core-flow', now);
  let state = built.snapshot, sequence = 0;
  const documents = built.documents, checkpoints = [], commands = [];
  const site = state.sites[0], source = state.sites[1];
  const id = prefix => `paper-${prefix}-${++sequence}`;
  const actor = role => {
    const { name, email } = ACCOUNT_FIXTURES.find(account => account.role === role);
    return { name, email, role };
  };
  const run = (role, command) => {
    const result = applyCommand(state, command, { now: () => new Date(now.getTime() + sequence * 1000).toISOString(), id, actor: actor(role), siteIds: state.sites.map(s => s.id) });
    assert.ok(result.ok, `${command.type}: ${result.message}`);
    state = result.snapshot;
    commands.push({ role, type: command.type });
    return result.recordId;
  };
  const file = (name, lines) => {
    const fileId = `local-paper-core-flow-${++sequence}`;
    documents.push({ id: fileId, name, lines });
    return fileId;
  };
  const checkpoint = (title, role, route, setup = [], importance = 'core', purpose = '', refs = {}) => {
    checkpoints.push({ number: checkpoints.length + 1, title, role, route, setup, importance, purpose, refs, snapshot: structuredClone(state) });
  };
  const approval = requestId => {
    run('Project Manager', { type: 'reviewRequest', id: requestId, decision: 'approve' });
    const request = state.requests.find(r => r.id === requestId);
    const form = file(`${request.ref}.pdf`, [request.ref, site.name, 'Approved material request', ...request.items.map(i => `${i.name}: ${i.quantity} ${i.unit}`)]);
    const support = request.documents[0].fileId;
    run('Project Manager', { type: 'completeRequestArchive', id: requestId, formFileId: form, supportFileId: support, formUrl: localArchiveUrl(form), supportUrl: localArchiveUrl(support) });
  };
  const request = (name, quantity, unit, intent = 'submit') => {
    const item = { id: id('item'), name, quantity, unit, neededDate: today, purpose: 'Approved construction work package', location: site.location, remarks: 'Verify delivered specification and physical quantity.' };
    const support = file('Material request and key plan.pdf', [site.name, 'Civil Works', `${name}: ${quantity} ${unit}`, 'Work area: ground floor construction zone', 'Demonstration supporting request and key plan.']);
    run('Site Personnel', { type: 'saveRequest', intent, siteId: site.id, scopeId: state.scopes.find(s => s.siteId === site.id && s.name === 'Civil Works').id, ref: '', requestDate: today, requestedBy: actor('Site Personnel').name, approvedBy: actor('Project Manager').name, purchaser: actor('Procurement').name, financeOfficer: actor('Finance').name, items: [item], documents: [{ name: 'Material request and key plan.pdf', type: 'Supporting PDF', fileId: support }] });
    return { requestId: state.requests.at(-1).id, item };
  };
  const quotes = (requestId, item, capture = false) => {
    const refs = { mrf: state.requests.find(r => r.id === requestId).ref };
    const all = [];
    for (let n = 0; n < 3; n++) {
      const supplier = state.suppliers[n];
      const original = file(`${supplier.name} quotation.pdf`, [supplier.name, refs.mrf, `${item.name}: ${item.quantity} ${item.unit}`, `PHP ${265 + n * 15} per ${item.unit}`, 'VAT inclusive. Delivery within three working days.']);
      const quote = { id: id('quote'), mrfId: requestId, supplierId: supplier.id, ref: `QT-PAPER-${sequence}`, prices: {}, available: 'Available for delivery', leadDays: 3 + n, terms: 'Payment according to approved purchase order', documents: [{ name: `${supplier.name} quotation.pdf`, type: 'application/pdf', fileId: original }], currency: 'PHP', extraction: 'manual', reviewStatus: 'draft', supplierDetails: { name: supplier.name, address: supplier.location, tin: '', contactName: 'Sales desk', email: 'sales@example.com', phone: '' }, financial: { vatStatus: 'VAT', priceBasis: 'inclusive', vatRate: 12, reviewed: true }, adjustments: [], lines: [{ id: id('offer'), description: item.name, quantity: item.quantity, unit: item.unit, unitPrice: 265 + n * 15, requestItemId: item.id, conversionFactor: 1, matchConfirmed: true, brand: 'As specified', specification: item.name, varianceReason: '' }] };
      run('Procurement', { type: 'saveQuoteDraft', quote });
      if (capture && n === 0) checkpoint('Supplier Quotation Review and Material Matching', 'Procurement', `/requests/${requestId}/quotes`, [{ step: 2 }, { selector: '.quote-editor-panel' }], 'core', 'Review the supplier offer, linked requested material, quantity, price and VAT treatment.', refs);
      run('Procurement', { type: 'finalizeQuote', id: quote.id });
      run('Procurement', { type: 'completeQuoteArchive', id: quote.id, files: [{ localFileId: original, driveFileId: original, url: localArchiveUrl(original), name: `${supplier.name} quotation.pdf` }] });
      all.push(quote);
    }
    if (capture) checkpoint('Comparison of Three Supplier Quotations', 'Procurement', `/requests/${requestId}/quotes`, [{ step: 3 }, { heading: 'Compare & award' }], 'core', 'Compare compliant supplier prices and lead times for the same requested material.', refs);
    if (capture) checkpoint('Supplier Comparison Remaining Columns and Award Choices', 'Procurement', `/requests/${requestId}/quotes`, [{ step: 3 }, { heading: 'Compare & award' }, { horizontal: '.comparative-bid-scroll' }], 'supporting', 'Show the remaining supplier prices and award controls beyond the first comparison view.', refs);
    const chosen = all[0];
    run('Procurement', { type: 'replaceMaterialAwards', requestId, itemId: item.id, awards: [{ quoteId: chosen.id, quoteLineId: chosen.lines[0].id, quantity: item.quantity }] });
    if (capture) checkpoint('Saved Supplier Award and Purchase Quantity', 'Procurement', `/requests/${requestId}/quotes`, [{ step: 3 }, { click: 'Review saved awards' }], 'supporting', 'Show the saved supplier allocation before creating a purchase order.', refs);
    run('Procurement', { type: 'generateAwardPOs', requestId, reasons: { [chosen.supplierId]: 'Lowest compliant quotation with confirmed delivery availability.' } });
    return state.pos.at(-1).id;
  };
  const approvePO = (poId, mode) => {
    const po = state.pos.find(p => p.id === poId);
    run('Accounting / Auditing', { type: 'saveAccountingPO', id: poId, paymentMode: mode, paymentDueDate: mode === 'credit' ? due : undefined, financial: { ...po.financial, reviewed: true } });
    run('Accounting / Auditing', { type: 'reviewPO', id: poId, decision: 'approve' });
    const document = file(`${po.ref}.pdf`, [po.ref, site.name, `Payment arrangement: ${mode}`, `Net supplier payable PHP ${poTotal(state, state.pos.find(p => p.id === poId))}`, 'Accounting-approved purchase order']);
    run('Accounting / Auditing', { type: 'completePOArchive', id: poId, fileId: document, url: localArchiveUrl(document) });
  };
  const proof = (poId, suffix) => {
    const po = state.pos.find(p => p.id === poId);
    const document = file(`${po.ref} ${suffix} payment confirmation.pdf`, [po.ref, 'Demonstration supplier payment confirmation', `Reference PAPER-${suffix}`, today]);
    run('Accounting / Auditing', { type: 'attachPaymentProofs', poId, documents: [{ name: `${suffix} payment confirmation.pdf`, mime: 'application/pdf', size: 100, localFileId: document, sha256: createHash('sha256').update(document).digest('hex') }] });
    const evidence = state.pos.find(p => p.id === poId).paymentProofs.at(-1);
    run('Accounting / Auditing', { type: 'completePaymentProofArchive', poId, documentId: evidence.id, fileId: document, url: localArchiveUrl(document) });
    return evidence.id;
  };
  const archiveReceipts = batchId => {
    const batch = state.batches.find(b => b.id === batchId);
    for (const receipt of batch.receiptVersions || []) {
      const document = file(`${batch.ref} generated receipt.pdf`, [batch.ref, site.name, ...batch.lines.map(l => `Expected ${l.expected}; accepted ${l.accepted}`)]);
      run('Site Personnel', { type: 'completeDeliveryReceiptArchive', batchId, receiptId: receipt.id, fileId: document, url: localArchiveUrl(document) });
    }
  };
  const accountingFile = (poId, kind, batchId) => {
    const document = file(`${kind}.pdf`, [state.pos.find(p => p.id === poId).ref, kind, 'Demonstration document acknowledged by the responsible personnel.']);
    const role = kind === 'Signed delivery receipt' ? 'Site Personnel' : 'Accounting / Auditing';
    run(role, { type: 'attachAccountingDocuments', poId, batchId, documents: [{ name: `${kind}.pdf`, kind, mime: 'application/pdf', size: 100, localFileId: document, sha256: '0'.repeat(64) }] });
    const attached = state.accounting.find(a => a.poId === poId).documents.at(-1);
    run(role, { type: 'completeAccountingArchive', poId, documentId: attached.id, fileId: document, url: localArchiveUrl(document) });
  };

  checkpoint('Project Budget and Scope Allocations', 'Project Manager', `/projects/${site.id}`, [], 'core', 'Establish the project and scope budgets governing purchasing.', { project: site.name });
  const upfront = request('Portland cement 40kg', 20, 'bag', 'draft');
  const mrfRoute = `/requests/${upfront.requestId}`;
  checkpoint('Material Request Project and Signatories', 'Site Personnel', `${mrfRoute}/edit`, [], 'supporting', 'Identify the project, work scope and responsible personnel.');
  checkpoint('Requested Material Specifications and Quantity', 'Site Personnel', `${mrfRoute}/edit`, [{ click: 'Next', partial: true }], 'core', 'Specify the required cement quantity and delivery location.');
  checkpoint('Supporting PDF and Material Request Submission', 'Site Personnel', `${mrfRoute}/edit`, [{ click: 'Next', partial: true }, { click: 'Next', partial: true }], 'core', 'Review the attached supporting PDF before submitting the request.');
  const draft = state.requests.find(r => r.id === upfront.requestId);
  run('Site Personnel', { type: 'saveRequest', ...Object.fromEntries(['siteId', 'scopeId', 'ref', 'requestDate', 'requestedBy', 'approvedBy', 'purchaser', 'financeOfficer', 'items', 'documents'].map(k => [k, draft[k]])), id: draft.id, intent: 'submit' });
  const refs = { mrf: state.requests.find(r => r.id === upfront.requestId).ref };
  checkpoint('Project Manager Material Request Approval', 'Project Manager', mrfRoute, [{ button: 'Approve request' }], 'core', 'Review the submitted quantities and approve the MRF.', refs);
  approval(upfront.requestId);
  checkpoint('Procurement Check of Available Site Stock', 'Procurement', `${mrfRoute}/quotes`, [{ step: 1 }, { selector: '.stock-sourcing' }], 'core', 'Check existing project stock before sourcing the remaining material requirement.', refs);
  const upfrontPO = quotes(upfront.requestId, upfront.item, true);
  refs.po = state.pos.find(p => p.id === upfrontPO).ref;
  checkpoint('Purchase Order Preparation from Awarded Quotation', 'Procurement', `/purchase-orders/${upfrontPO}/edit`, [{ heading: 'Supplier and materials', optional: true }], 'core', 'Prepare the PO using the saved supplier award.', refs);
  run('Procurement', { type: 'savePO', id: upfrontPO, quoteId: state.pos.find(p => p.id === upfrontPO).quoteId, notes: 'Deliver cement to the ground floor stock area.', finalize: true });
  checkpoint('Accounting Review of Purchase Order Taxes', 'Accounting / Auditing', `/accounting/${upfrontPO}`, [{ heading: 'VAT and withholding', partial: true }], 'supporting', 'Review VAT and withholding before approving the supplier payable.', refs);
  checkpoint('Accounting Budget Check and Purchase Order Approval', 'Accounting / Auditing', `/accounting/${upfrontPO}`, [{ fill: 'select[name=paymentMode]', value: 'upfront' }, { collapse: '.accounting-po-review details' }, { heading: 'PO charges and deductions', offset: 350 }], 'core', 'Check the supplier payable and available project and scope budgets before PO approval.', refs);
  approvePO(upfrontPO, 'upfront');
  checkpoint('Approved Purchase Order Issuance to Supplier', 'Procurement', `/purchase-orders/${upfrontPO}`, [{ heading: 'Supplier issuance', partial: true, optional: true }], 'core', 'Issue the approved and archived PO to the selected supplier.', refs);
  run('Procurement', { type: 'issuePO', id: upfrontPO });
  run('Finance', { type: 'savePaymentCoordination', poId: upfrontPO, revision: 0, priority: 'High', status: 'Scheduled', plannedDate: today, note: 'Supplier payment scheduled before delivery clearance.' });
  checkpoint('Finance Coordination of Supplier Payment', 'Finance', `/finance/${upfrontPO}`, [], 'core', 'Set payment priority, status, planned date and coordination notes.', refs);
  proof(upfrontPO, 'UPFRONT');
  checkpoint('Accounting Payment Proof and Full Payment Verification', 'Accounting / Auditing', `/accounting/${upfrontPO}`, [{ fill: '.external-payment-panel select[name=method]', value: 'Bank' }, { fill: '.external-payment-panel input[name=reference]', value: 'PAPER-UPFRONT-001' }, { selector: '.external-payment-panel' }], 'core', 'Check archived proof before verifying full net payment.', refs);
  run('Accounting / Auditing', { type: 'verifyExternalPayment', poId: upfrontPO, method: 'Bank', reference: 'PAPER-UPFRONT-001', date: today });
  checkpoint('Verified Full Payment and Delivery Clearance', 'Accounting / Auditing', `/accounting/${upfrontPO}`, [{ selector: '.external-payment-panel' }], 'core', 'Show full payment verification and the remaining delivery-clearance action.', refs);
  run('Accounting / Auditing', { type: 'releasePO', id: upfrontPO });
  checkpoint('Supplier Delivery Scheduling', 'Logistics', `/deliveries/new?poId=${upfrontPO}`, [{ fill: 'input[name=evidence]', value: 'DR-PAPER-UPFRONT-001' }], 'core', 'Schedule the supplier-to-site delivery and expected material quantity.', refs);
  run('Logistics', { type: 'createBatch', poId: upfrontPO, leg: 'supplier-site', scheduledDate: today, evidence: 'DR-PAPER-UPFRONT-001', delayReason: '', expected: { [upfront.item.id]: 20 } });
  const batchId = state.batches.at(-1).id;
  refs.delivery = state.batches.at(-1).ref;
  checkpoint('Scheduled Delivery and Dispatch Action', 'Logistics', `/deliveries/${batchId}`, [{ button: 'Record dispatch', optional: true }], 'core', 'Record when the scheduled shipment leaves the supplier.', refs);
  run('Logistics', { type: 'dispatchBatch', id: batchId });
  checkpoint('Site Receiving and Accepted Quantities', 'Site Personnel', `/deliveries/${batchId}`, [{ heading: 'Confirm received quantities' }], 'core', 'Confirm actual accepted quantities at the destination site.', refs);
  run('Site Personnel', { type: 'confirmBatch', id: batchId, lines: { [upfront.item.id]: { accepted: 20, issue: '' } } });
  archiveReceipts(batchId);
  checkpoint('Received Delivery and Site Stock Posting', 'Site Personnel', `/deliveries/${batchId}`, [{ button: 'Post', partial: true, optional: true }], 'core', 'Post the accepted material quantity into site inventory.', refs);
  run('Site Personnel', { type: 'postBatch', id: batchId, accepted: { [upfront.item.id]: 20 }, reason: 'Counted and stored in the project cement stock area.' });
  archiveReceipts(batchId);
  accountingFile(upfrontPO, 'Signed delivery receipt', batchId);
  accountingFile(upfrontPO, 'Invoice');
  run('Accounting / Auditing', { type: 'saveDocuments', poId: upfrontPO, invoiceRef: 'INV-PAPER-UPFRONT-001', receiptRef: refs.delivery, review: 'Complete', note: 'Invoice and signed delivery receipt agree with accepted and posted quantities.' });
  checkpoint('Completed Accounting Review of Delivery Documents', 'Accounting / Auditing', `/accounting/${upfrontPO}`, [{ heading: 'Document review' }], 'core', 'Review the supplier invoice and archived receiving evidence.', refs);
  run('Site Personnel', { type: 'recordMovement', siteId: site.id, itemName: upfront.item.name, unit: upfront.item.unit, kind: 'usage', quantity: 5, reason: 'Cement used for the ground floor concrete work package.' });
  checkpoint('Site Inventory Usage and Stock Movement History', 'Site Personnel', `/inventory/${site.id}/${materialId(upfront.item.name, upfront.item.unit)}`, [], 'core', 'Trace the delivery posting and subsequent material usage.', refs);

  const credit = request('Portland cement 40kg', 10, 'bag'); approval(credit.requestId);
  const creditPO = quotes(credit.requestId, credit.item);
  const creditRefs = { mrf: state.requests.find(r => r.id === credit.requestId).ref, po: state.pos.find(p => p.id === creditPO).ref };
  run('Procurement', { type: 'savePO', id: creditPO, quoteId: state.pos.find(p => p.id === creditPO).quoteId, notes: 'Thirty-day supplier credit arrangement.', finalize: true });
  run('Accounting / Auditing', { type: 'saveAccountingPO', id: creditPO, paymentMode: 'credit', paymentDueDate: due, financial: { ...state.pos.find(p => p.id === creditPO).financial, reviewed: true } });
  checkpoint('Credit Terms and Agreed Payment Due Date', 'Accounting / Auditing', `/accounting/${creditPO}`, [{ collapse: '.accounting-po-review details' }, { selector: '.accounting-po-review' }], 'core', 'Set credit terms and the agreed due date instead of upfront payment.', creditRefs);
  approvePO(creditPO, 'credit'); run('Procurement', { type: 'issuePO', id: creditPO });
  checkpoint('Credit Delivery Clearance with an Unpaid Balance', 'Accounting / Auditing', `/accounting/${creditPO}`, [{ selector: '.credit-payment-panel' }], 'core', 'Show that credit delivery can be cleared before settlement.', creditRefs);
  run('Accounting / Auditing', { type: 'releasePO', id: creditPO });
  const total = poTotal(state, state.pos.find(p => p.id === creditPO));
  const first = Math.round(total * 50) / 100;
  const p1 = proof(creditPO, 'CREDIT-01');
  run('Accounting / Auditing', { type: 'recordCreditPayment', poId: creditPO, paymentId: id('installment'), proofIds: [p1], amount: first, method: 'Bank', reference: 'PAPER-CREDIT-001', date: today });
  checkpoint('Verified Credit Installment and Remaining Balance', 'Accounting / Auditing', `/accounting/${creditPO}`, [{ selector: '.credit-payment-panel' }], 'core', 'Show a verified installment while an outstanding balance remains.', creditRefs);
  const p2 = proof(creditPO, 'CREDIT-02');
  run('Accounting / Auditing', { type: 'recordCreditPayment', poId: creditPO, paymentId: id('installment'), proofIds: [p2], amount: Math.round((total - first) * 100) / 100, method: 'Bank', reference: 'PAPER-CREDIT-002', date: today });
  checkpoint('Fully Settled Credit Purchase and Payment History', 'Accounting / Auditing', `/accounting/${creditPO}`, [{ selector: '.credit-payment-panel' }], 'core', 'Show the two verified installments and zero remaining balance.', creditRefs);

  const stock = request('Marine plywood 18mm', 10, 'sheet'); approval(stock.requestId);
  const stockRefs = { mrf: state.requests.find(r => r.id === stock.requestId).ref, source: source.name, destination: site.name };
  checkpoint('Matching Source Stock for an Interproject Transfer', 'Procurement', `/requests/${stock.requestId}/quotes`, [{ step: 1 }, { fill: '[aria-label="Source project"]', value: source.id }, { fill: '[aria-label="Stock for Marine plywood 18mm"]', value: materialId(stock.item.name, stock.item.unit) }, { fill: '[aria-label^="Quantity from "]', value: 10 }, { click: 'Review selections' }, { clickSelector: '.stock-final-verification input' }], 'core', 'Verify the source project, matching material and ten-sheet transfer quantity before sending the release request.', stockRefs);
  run('Procurement', { type: 'proposeStockTransfer', requestId: stock.requestId, sourceSiteId: source.id, note: 'Matching plywood specification and unit confirmed before release.', lines: [{ itemId: stock.item.id, sourceName: stock.item.name, unit: stock.item.unit, quantity: 10, suitabilityConfirmed: true }] });
  const transfer = state.stockTransfers.at(-1), transferRoute = `/stock-transfers/${transfer.id}`;
  stockRefs.transfer = transfer.ref;
  checkpoint('Source Site Review and Stock Release Approval', 'Site Personnel', transferRoute, [], 'core', 'The source site confirms the quantity it can release.', stockRefs);
  run('Site Personnel', { type: 'reviewStockTransfer', id: transfer.id, decision: 'approve', quantities: { [transfer.lines[0].id]: 10 }, reason: 'Physically checked matching stock is available for release.' });
  checkpoint('Scheduling the Approved Site Stock Transfer', 'Logistics', transferRoute, [{ selector: '.transfer-schedule' }], 'supporting', 'Schedule a transfer trip for the approved stock quantity.', stockRefs);
  run('Logistics', { type: 'scheduleTransferDelivery', transferId: transfer.id, scheduledDate: today, evidence: 'TR-PAPER-001', quantities: { [transfer.lines[0].id]: 10 } });
  const trip = state.transferDeliveries.at(-1);
  checkpoint('Transfer Dispatch and Source Stock Deduction', 'Logistics', transferRoute, [{ selector: '.transfer-trip' }], 'core', 'Dispatch the scheduled trip; source stock is deducted at this step.', stockRefs);
  const beforeSource = inventoryFor(state, source.id).find(i => i.id === materialId(stock.item.name, stock.item.unit)).onHand;
  run('Logistics', { type: 'dispatchTransferDelivery', id: trip.id });
  checkpoint('Destination Receiving of Transferred Materials', 'Site Personnel', transferRoute, [{ selector: '.transfer-trip' }], 'core', 'Confirm the material quantity accepted by the destination site.', stockRefs);
  run('Site Personnel', { type: 'receiveTransferDelivery', id: trip.id, lines: { [transfer.lines[0].id]: { accepted: 10, issue: '' } } });
  for (const receipt of state.transferDeliveries.find(t => t.id === trip.id).receiptVersions) {
    const f = file(`${trip.ref} receipt.pdf`, [trip.ref, source.name, site.name, 'Marine plywood 18mm: 10 sheets accepted']);
    run('Site Personnel', { type: 'completeTransferReceiptArchive', deliveryId: trip.id, receiptId: receipt.id, fileId: f, url: localArchiveUrl(f) });
  }
  checkpoint('Posting Transferred Stock into Destination Inventory', 'Site Personnel', transferRoute, [{ selector: '.transfer-trip' }], 'core', 'Post accepted stock at the destination without supplier payment.', stockRefs);
  const beforeDestination = inventoryFor(state, site.id).find(i => i.id === materialId(stock.item.name, stock.item.unit)).onHand;
  run('Site Personnel', { type: 'postTransferDelivery', id: trip.id, quantities: { [transfer.lines[0].id]: 10 }, reason: 'Counted and stored in the destination plywood area.' });
  const currentTrip = state.transferDeliveries.find(t => t.id === trip.id);
  const signed = file(`${trip.ref} signed transfer receipt.pdf`, [trip.ref, 'Acknowledged by source and destination site personnel', 'Ten sheets received and posted.']);
  run('Site Personnel', { type: 'attachTransferEvidence', transferId: transfer.id, documents: [{ id: id('evidence'), deliveryId: trip.id, receiptVersion: currentTrip.receiptVersions.at(-1).version, name: 'Signed transfer receipt.pdf', kind: 'Signed delivery receipt', mime: 'application/pdf', size: 100, localFileId: signed, sha256: '0'.repeat(64), archive: { status: 'pending' } }] });
  const evidence = state.stockTransfers.find(t => t.id === transfer.id).documents.at(-1);
  run('Site Personnel', { type: 'completeTransferEvidenceArchive', transferId: transfer.id, documentId: evidence.id, fileId: signed, url: localArchiveUrl(signed) });
  run('Accounting / Auditing', { type: 'reviewTransferDocuments', id: transfer.id, status: 'Complete', note: 'Signed transfer receipt agrees with the dispatched, received and posted quantity.' });
  checkpoint('Accounting Review of Completed Stock Transfer Documents', 'Accounting / Auditing', transferRoute, [{ selector: '.transfer-accounting-review' }], 'core', 'Verify transfer evidence without an invoice or supplier payment.', stockRefs);
  checkpoint('Management Report of Project Purchasing and Budgets', 'Project Manager', '/reports', [{ fill: '[aria-label="Report project"]', value: site.id }], 'core', 'Review the project budget and purchasing outcome.', { project: site.name });
  checkpoint('Management Report of Current Site Stock', 'Project Manager', '/reports', [{ fill: '[aria-label="Report project"]', value: site.id }, { selector: '.report-site-stock' }], 'supporting', 'Review current stock after delivery, transfer and material usage.', { project: site.name });

  assert.equal(checkpoints.length, 36);
  for (const checkpoint of checkpoints) {
    const requestId = /^\/requests\/([^/?]+)/.exec(checkpoint.route)?.[1];
    const linkedRequest = checkpoint.snapshot.requests.find(r => r.id === requestId);
    if (linkedRequest) checkpoint.refs.mrf ||= linkedRequest.ref;
  }
  assert.equal(paidTotal(state, upfrontPO), poTotal(state, state.pos.find(p => p.id === upfrontPO)));
  assert.equal(Math.round(paidTotal(state, creditPO) * 100), Math.round(total * 100));
  assert.equal(inventoryFor(state, source.id).find(i => i.id === materialId(stock.item.name, stock.item.unit)).onHand, beforeSource - 10);
  assert.equal(inventoryFor(state, site.id).find(i => i.id === materialId(stock.item.name, stock.item.unit)).onHand, beforeDestination + 10);
  assert.equal(state.batches.find(b => b.id === batchId).status, 'posted');
  assert.equal(state.accounting.find(a => a.poId === upfrontPO).review, 'Complete');
  return { checkpoints, documents, commands, final: state, verified: { upfront: refs, credit: creditRefs, transfer: stockRefs, sourceDeduction: 10, destinationPosting: 10, upfrontReceived: 20, upfrontUsage: 5 } };
}
