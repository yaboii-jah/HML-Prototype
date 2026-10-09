import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { coordinatedPOs, coordinationStatus } from '../src/domain/payment-coordination.ts';
import { budgetFor, paidTotal, poTotal } from '../src/domain/selectors.ts';
import { releaseBlocker } from '../src/domain/workflow.ts';
import { tasksFor } from '../src/domain/queues.ts';
import { validBidReport } from '../src/domain/bid-reports.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { requestMonitoring } from '../src/domain/request-monitoring.ts';
import { ACCOUNT_FIXTURES } from '../src/app-state/demo-session.ts';

let sequence = 0;
const context = { now: () => '2026-10-05T09:00:00.000Z', id: prefix => `${prefix}-flow-${++sequence}` };
const run = (state, command) => { const result = applyCommand(state, command, { ...context, actor: ACCOUNT_FIXTURES.find(account => account.role === state.role) }); assert.equal(result.ok, true, result.message); return result.snapshot; };
const as = (state, role) => run(state, { type: 'setRole', role });
const fail = (state, command, pattern) => { const original = structuredClone(state); const result = applyCommand(state, command, { ...context, actor: ACCOUNT_FIXTURES.find(account => account.role === state.role) }); assert.equal(result.ok, false); if (pattern) assert.match(result.message, pattern); assert.deepEqual(state, original, 'Failed commands must preserve the source snapshot'); };

function submittedPO() {
  let state = as(blankWorkspace(), 'Administrator');
  state = run(state, { type: 'addSite', name: 'Client project', location: 'Pasig', budget: 10000 });
  const siteId = state.sites[0].id;
  state = run(state, { type: 'setProjectDriveFolder', siteId, folderId: 'project-folder' });
  state = run(state, { type: 'saveProjectScope', siteId, name: 'Structural', budget: 10000 });
  state = as(state, 'Site Personnel');
  state = run(state, { type: 'saveRequest', intent: 'submit', siteId, scopeId: state.scopes[0].id, ref: 'MRF-CLIENT-001', requestDate: '2026-10-05', requestedBy: 'Site user', approvedBy: 'Signatory', purchaser: 'Buyer', financeOfficer: 'Finance', documents: [{ name: 'Supporting.pdf', type: 'Supporting PDF', fileId: 'support' }], items: [{ id: 'cement', name: 'Cement', unit: 'bag', quantity: 10, neededDate: '2026-10-06', purpose: '', location: 'Pasig', remarks: '' }] });
  const request = state.requests[0];
  fail(as(state, 'Logistics'), { type: 'reviewRequest', id: request.id, decision: 'approve' }, /Project Manager/);
  state = as(state, 'Project Manager');
  state = run(state, { type: 'reviewRequest', id: request.id, decision: 'approve' });
  state = run(state, { type: 'completeRequestArchive', id: request.id, formFileId: 'form', supportFileId: 'support', formUrl: 'https://drive.google.com/file/d/form/view', supportUrl: 'https://drive.google.com/file/d/support/view' });
  state = as(state, 'Procurement');
  state = run(state, { type: 'saveQuoteDraft', quote: { financial: { vatStatus: 'NON-VAT', priceBasis: 'inclusive', vatRate: 12, reviewed: true }, id: 'offer', mrfId: request.id, supplierId: '', ref: 'QT-001', currency: 'PHP', prices: {}, available: 'In stock', leadDays: 1, terms: 'Agreed supplier terms', extraction: 'manual', reviewStatus: 'draft', supplierDetails: { name: 'Supplier', address: 'Pasig', tin: '', contactName: '', email: '', phone: '' }, documents: [{ name: 'Quote.pdf', type: 'application/pdf', fileId: 'quotation' }], adjustments: [], lines: [{ id: 'offer-cement', requestItemId: 'cement', description: 'Cement', quantity: 10, unit: 'bag', unitPrice: 100, conversionFactor: 1, brand: '', specification: '', varianceReason: '', matchConfirmed: true }] } });
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
  state = run(state, { type: 'saveAccountingPO', id: po.id, paymentMode: mode, paymentDueDate: mode === 'credit' ? '2026-10-30' : undefined, financial: { ...po.financial, reviewed: true } });
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


const proofCommand = poId => ({ type: 'attachPaymentProofs', poId, documents: [{ name: 'Bank proof.pdf', mime: 'application/pdf', size: 100, localFileId: 'bank-proof', sha256: 'a'.repeat(64) }] });
const verifyCommand = poId => ({ type: 'verifyExternalPayment', poId, method: 'Bank', date: '2026-10-05', reference: 'BANK-FULL-001' });
function issued(withVat = false) { let state = submittedPO(); if (withVat) state = run(state, { type: "saveAccountingPO", id: state.pos[0].id, paymentMode: "upfront", financial: { ...state.pos[0].financial, vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, ewtMode: "automatic", reviewed: true } }); state = archive(approve(state)); return run(as(state, 'Procurement'), { type: 'issuePO', id: state.pos[0].id }); }
function withProof(state) { state = run(as(state, 'Accounting / Auditing'), proofCommand(state.pos[0].id)); return run(state, { type: 'completePaymentProofArchive', poId: state.pos[0].id, documentId: state.pos[0].paymentProofs[0].id, fileId: 'proof-drive', url: 'https://drive.google.com/file/d/proof-drive/view' }); }

test('new MRFs require PM review, inherit flow on PO, and supplier issuance marks Served before delivery clearance', () => {
  let state = approve(submittedPO()), po = state.pos[0];
  assert.equal(state.requests[0].workflow, 'pm-external-v1'); assert.equal(po.workflow, 'pm-external-v1');
  assert.equal(requestMonitoring(state, po.mrfId).served.state, 'pending');
  fail(as(state, 'Procurement'), { type: 'issuePO', id: po.id }, /archives/);
  state = archive(state);
  fail(state, { type: 'issuePO', id: po.id }, /Procurement/);
  fail(state, { type: 'savePaymentRequest', poId: po.id, amount: 1000, note: 'External', submit: true }, /external/);
  fail(state, proofCommand(po.id), /issuance/);
  fail(state, { type: 'releasePO', id: po.id }, /issue/);
  state = run(as(state, 'Procurement'), { type: 'issuePO', id: po.id });
  assert.equal(requestMonitoring(state, po.mrfId).served.state, 'complete');
  assert.equal(requestMonitoring(state, po.mrfId).logistics.label, 'Awaiting release');
  assert.equal(state.pos[0].issuance.by.role, 'Procurement');
  fail(state, { type: 'issuePO', id: po.id });
  assert.equal(tasksFor(as(state, 'Finance')).length, 1, 'Issued PO requires Finance coordination');
});

test('Accounting requires archived proof and complete details, verifies computed net after EWT, then clears delivery separately', () => {
  let state = as(issued(true), 'Accounting / Auditing'); const poId = state.pos[0].id, siteId = state.sites[0].id;
  fail(state, verifyCommand(poId), /proof/);
  state = run(state, proofCommand(poId));
  fail(state, verifyCommand(poId), /proof/);
  state = run(state, { type: 'failPaymentProofArchive', poId, documentId: state.pos[0].paymentProofs[0].id, error: 'Drive unavailable' });
  fail(state, verifyCommand(poId), /proof/);
  state = run(state, { type: 'completePaymentProofArchive', poId, documentId: state.pos[0].paymentProofs[0].id, fileId: 'proof-drive', url: 'https://drive.google.com/file/d/proof-drive/view' });
  for (const patch of [{ date: '2026-02-30' }, { reference: ' ' }, { method: 'Invalid' }]) fail(state, { ...verifyCommand(poId), ...patch }, /valid/);
  fail(as(state, 'Finance'), verifyCommand(poId), /Accounting/);
  const prior = budgetFor(state, siteId);
  state = run(state, { ...verifyCommand(poId), amount: 0.01 });
  assert.equal(state.pos[0].externalPayment.amount, poTotal(state,state.pos[0])); assert.ok(state.pos[0].externalPayment.amount < 1000, 'EWT is deducted from verified net'); assert.equal(state.payments.length, 0);
  assert.equal(state.pos[0].status, 'approved'); assert.equal(state.batches.length, 0);
  assert.equal(budgetFor(state,siteId).available, prior.available); assert.equal(budgetFor(state,siteId).spent, poTotal(state,state.pos[0]));
  assert.equal(state.pos[0].externalPayment.verifiedBy.role, 'Accounting / Auditing');
  fail(state, { type: 'removePaymentProof', poId, documentId: state.pos[0].paymentProofs[0].id });
  fail(as(state, 'Finance'), { type: 'releasePO', id: poId });
  state = run(state, { type: 'releasePO', id: poId });
  assert.equal(state.pos[0].releasedBy, 'Accounting / Auditing');
  fail(state, { type: 'reopenPaymentVerification', poId, reason: 'Wrong bank reference' });
  state = run(as(state, 'Logistics'), { type: 'createBatch', poId, scheduledDate: '2026-10-06', evidence: 'Delivery', delayReason: '', expected: { cement: 10 } });
  assert.equal(state.batches.length, 1);
  const stored = JSON.stringify(state), oldStorage=globalThis.localStorage, oldWindow=globalThis.window;
  globalThis.window={addEventListener(){}}; globalThis.localStorage={getItem:key=>key==='hml-constructsync-demo-v12'?stored:null,setItem(){}};
  try { assert.deepEqual(new LocalDemoRepository().getSnapshot().snapshot, JSON.parse(stored)); } finally { globalThis.localStorage=oldStorage; globalThis.window=oldWindow; }
});

test('reopening verification restores commitment and preserves frozen proof and verification history', () => {
  let state = withProof(issued()); const poId = state.pos[0].id;
  state = run(state, verifyCommand(poId));
  const prior = structuredClone(state.pos[0].externalPayment);
  fail(state, { type: 'reopenPaymentVerification', poId, reason: 'No' });
  state = run(state, { type: 'reopenPaymentVerification', poId, reason: 'Correct bank reference' });
  assert.equal(paidTotal(state,poId), 0); assert.equal(state.pos[0].verificationHistory[0].reference, prior.reference);
  assert.deepEqual(state.pos[0].verificationHistory[0].proofs, prior.proofs);
  assert.match(releaseBlocker(state,state.pos[0]), /verify/);
  state = run(state, { type: 'removePaymentProof', poId, documentId: state.pos[0].paymentProofs[0].id });
  assert.equal(state.pos[0].verificationHistory[0].proofs.length, 1);
  fail(state, verifyCommand(poId), /proof/);
});

test('costing recheck retains prior approval, invalidates commitment/archive, renews Accounting review and locks after issuance', () => {
  let state = archive(approve(submittedPO())); const poId = state.pos[0].id;
  state = run(as(state,'Procurement'), { type: 'reopenPOReview', id: poId, reason: 'Supplier corrected costing' });
  assert.equal(state.pos[0].status,'returned'); assert.equal(state.pos[0].archive,undefined); assert.equal(state.pos[0].financial.reviewed,false);
  assert.equal(state.pos[0].approvalHistory[0].archive.fileId,'po-drive'); assert.equal(budgetFor(state,state.sites[0].id).committed,0);
  state = run(state,{type:'savePO',id:poId,quoteId:'offer',notes:'Costing rechecked',lines:state.pos[0].lines.map(line=>({...line,unitPrice:120})),finalize:true});
  assert.equal(poTotal(state,state.pos[0]),1200); assert.equal(state.quotes[0].lines[0].unitPrice,100,'Recheck retains original quotation');
  state = approve(as(state,'Accounting / Auditing')); state = archive(state);
  state = run(as(state,'Procurement'),{type:'issuePO',id:poId});
  fail(state,{type:'reopenPOReview',id:poId,reason:'Change issued financials'});
  fail(as(state,'Accounting / Auditing'),{type:'saveAccountingPO',id:poId,paymentMode:'credit',financial:state.pos[0].financial});
});

test('previously approved credit arrangements keep their Finance workflow without migration', () => {
  let state = archive(approve(submittedPO(),'credit')); const poId=state.pos[0].id;
  // Represent a PO approved before external credit was introduced.
  delete state.pos[0].externalCredit; delete state.pos[0].paymentDueDate;
  state = run(state,{type:'releasePO',id:poId}); state=requestPayment(state); state=pay(state);
  assert.equal(paidTotal(state,poId),1000); assert.equal(state.pos[0].externalPayment,undefined);
  fail(as(state,'Procurement'),{type:'issuePO',id:poId});
});

test('proof validation rejects oversize, invalid hashes, duplicates and cross-PO archive identities', () => {
  const state=as(issued(),'Accounting / Auditing'), poId=state.pos[0].id;
  for (const patch of [{size:21*1024*1024},{mime:'text/plain'},{sha256:'invalid'}]) fail(state,{...proofCommand(poId),documents:[{...proofCommand(poId).documents[0],...patch}]});
  const attached=run(state,proofCommand(poId));
  fail(attached,proofCommand(poId));
  fail(attached,{type:'completePaymentProofArchive',poId:'foreign-po',documentId:attached.pos[0].paymentProofs[0].id,fileId:'drive',url:'https://drive.google.com/file/d/drive/view'});
  fail(attached,{type:'completePaymentProofArchive',poId,documentId:attached.pos[0].paymentProofs[0].id,fileId:'drive',url:'https://example.com/proof'});
});


test('PM owns documents-only correction reapproval after purchasing starts, preserving scope even when committed', () => {
  let state=archive(approve(submittedPO())); const request=state.requests[0];
  state=run(as(state,'Procurement'),{type:'reopenApprovedRequest',id:request.id,reason:'Replace signed supporting PDF'});
  assert.equal(state.requests[0].correction.scope,'documents');
  state=run(as(state,'Site Personnel'),{type:'saveRequest',id:request.id,intent:'submit',siteId:request.siteId,scopeId:request.scopeId,ref:request.ref,requestDate:request.requestDate,requestedBy:request.requestedBy,approvedBy:request.approvedBy,purchaser:request.purchaser,financeOfficer:request.financeOfficer,items:request.items,documents:[{type:'Supporting PDF',name:'Corrected supporting.pdf',fileId:'corrected-support'}]});
  fail(as(state,'Procurement'),{type:'reviewRequest',id:request.id,decision:'approve'},/Project Manager/);
  assert.ok(tasksFor(as(state,'Project Manager')).some(task=>task.href===`/requests/${request.id}`));
  state=run(as(state,'Project Manager'),{type:'reviewRequest',id:request.id,decision:'approve'});
  assert.equal(state.requests[0].archive.status,'pending'); assert.equal(state.requests[0].scopeId,request.scopeId);
  state=run(state,{type:'completeRequestArchive',id:request.id,formFileId:'corrected-form',supportFileId:'corrected-support',formUrl:'https://drive.google.com/file/d/corrected-form/view',supportUrl:'https://drive.google.com/file/d/corrected-support/view'});
  assert.equal(state.requests[0].archive.versions.length,2);assert.equal(state.activity[0].actor,'Project Manager');
});


test('upfront Finance coordination cannot clear delivery and reopens after Accounting corrects full verification',()=>{
 let state=as(issued(),'Finance'),po=state.pos[0];
 state=run(state,{type:'savePaymentCoordination',poId:po.id,revision:0,priority:'Urgent',status:'Processing',plannedDate:'2026-10-06',note:'Bank transfer pending'});
 assert.equal(paidTotal(state,po.id),0);assert.match(releaseBlocker(state,state.pos[0]),/payment/i);
 state=withProof(state);state=run(state,verifyCommand(po.id));
 assert.equal(coordinationStatus(state,state.pos[0]),'Settled');assert.equal(coordinatedPOs(state).length,0);
 state=run(state,{type:'reopenPaymentVerification',poId:po.id,reason:'Wrong bank reference confirmed'});
 assert.equal(coordinationStatus(state,state.pos[0]),'Pending');assert.equal(coordinatedPOs(state).length,1);
 assert.equal(state.pos[0].paymentCoordination.priority,'Urgent');assert.equal(state.pos[0].paymentCoordination.plannedDate,'');assert.equal(state.pos[0].coordinationHistory.length,3);
});
