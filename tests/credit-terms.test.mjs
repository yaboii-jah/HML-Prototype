import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace } from '../src/mock/blank-workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { validBidReport } from '../src/domain/bid-reports.ts';
import { ACCOUNT_FIXTURES } from '../src/app-state/demo-session.ts';
import { isExternalCredit } from '../src/domain/full-disbursement.ts';
import { coordinatedPOs, coordinationStatus, coordinationWarning } from '../src/domain/payment-coordination.ts';
import { creditOverdue, philippineDate } from '../src/domain/credit-terms.ts';
import { budgetFor, paidTotal, paymentStatus, poTotal } from '../src/domain/selectors.ts';
import { releaseBlocker, accountingNextAction } from '../src/domain/workflow.ts';
import { tasksFor } from '../src/domain/queues.ts';
import { requestMonitoring } from '../src/domain/request-monitoring.ts';
import { requestLifecycle } from '../src/domain/request-lifecycle.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
let sequence=0;
const context={ now:()=> '2026-10-09T09:00:00.000Z', id:prefix=> `${prefix}-credit-${++sequence}` };
const run=(state,command)=>{const result=applyCommand(state,command,{...context,actor:ACCOUNT_FIXTURES.find(account=>account.role===state.role)});assert.equal(result.ok,true,result.message);return result.snapshot;};
const as=(state,role)=>run(state,{type:'setRole',role});
const fail=(state,command,pattern)=>{const before=structuredClone(state);const result=applyCommand(state,command,{...context,actor:ACCOUNT_FIXTURES.find(account=>account.role===state.role)});assert.equal(result.ok,false);if(pattern)assert.match(result.message,pattern);assert.deepEqual(state,before);};
function submittedPO() {
  let state = as(blankWorkspace(), 'Administrator');
  state = run(state, { type: 'addSite', documentCode: 'CLIENT-PROJECT', name: 'Client project', location: 'Pasig', budget: 10000 });
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
  return as(state, 'Accounting');
}
function approved() {
  let state=submittedPO(),po=state.pos[0];
  state=run(state,{type:'saveAccountingPO',id:po.id,paymentMode:'credit',paymentDueDate:'2026-10-08',financial:{...po.financial,reviewed:true}});
  state=run(state,{type:'reviewPO',id:po.id,decision:'approve'});
  return run(state,{type:'completePOArchive',id:po.id,fileId:'po-credit-drive',url:'https://drive.google.com/file/d/po-credit-drive/view'});
}
function issued() {let state=approved();return as(run(as(state,'Procurement'),{type:'issuePO',id:state.pos[0].id}),'Accounting');}
const record=(state,amount=400,reference='BANK-1',paymentId='credit-payment-1')=>({type:'recordCreditPayment',poId:state.pos[0].id,paymentId,amount,reference,method:'Bank',date:'2026-10-09',proofIds:[state.pos[0].paymentProofs.at(-1).id]});
function proof(state,index=1,archive=true) {
  state=run(state,{type:'attachPaymentProofs',poId:state.pos[0].id,documents:[{name:`Proof-${index}.pdf`,mime:'application/pdf',size:20,localFileId:`proof-local-${index}`,sha256:index.toString(16).padStart(64,'0')}]});
  return archive?run(state,{type:'completePaymentProofArchive',poId:state.pos[0].id,documentId:state.pos[0].paymentProofs.at(-1).id,fileId:`credit-proof-${index}`,url:`https://drive.google.com/file/d/credit-proof-${index}/view`}):state;
}

test('partial payments use net payable cents and stale amounts above the remaining balance are rejected', () => {
  let state = proof(issued());
  state.pos[0].financial = { ...state.pos[0].financial, vatStatus: 'VAT', priceBasis: 'inclusive', ewtMode: 'manual', ewtGoodsManual: true, ewtGoods: 19.99 };
  assert.equal(poTotal(state, state.pos[0]), 980.01);
  state = run(state, record(state, 400));
  assert.equal(paidTotal(state, state.pos[0].id), 400);
  assert.equal(coordinationStatus(state, state.pos[0]), 'Pending');
  const first = structuredClone(state.pos[0].creditPayments[0]);
  state = proof(state, 2);
  fail(state, record(state, 980.01, 'STALE', 'stale-payment'), /unpaid balance/);
  state = run(state, record(state, 580.01, 'REMAINDER', 'remainder-payment'));
  assert.equal(paidTotal(state, state.pos[0].id), 980.01);
  assert.equal(coordinationStatus(state, state.pos[0]), 'Settled');
  assert.deepEqual(state.pos[0].creditPayments[0], first);
});

test('new credit approvals require an agreed valid due date and enable external credit only on approval',()=>{
  let state=submittedPO(),po=state.pos[0];
  state=run(state,{type:'saveAccountingPO',id:po.id,paymentMode:'credit',financial:{...po.financial,reviewed:true}});
  assert.equal(isExternalCredit(state.pos[0]),false);
  fail(state,{type:'reviewPO',id:po.id,decision:'approve'},/due date/);
  fail(state,{type:'saveAccountingPO',id:po.id,paymentMode:'credit',paymentDueDate:'2026-02-30',financial:{...po.financial,reviewed:true}},/due date/);
  state=run(state,{type:'saveAccountingPO',id:po.id,paymentMode:'credit',paymentDueDate:'2026-10-30',financial:{...po.financial,reviewed:true}});
  state=run(state,{type:'reviewPO',id:po.id,decision:'approve'}); assert.equal(isExternalCredit(state.pos[0]),true);
});

test('issuance gates credit delivery but payment never blocks scheduling, receipt or stock posting',()=>{
  let state=approved(),po=state.pos[0];
  assert.match(releaseBlocker(state,po),/issue/); fail(state,{type:'releasePO',id:po.id},/issue/);
  state=issued(); po=state.pos[0]; assert.equal(releaseBlocker(state,state.pos[0]),'');
  state=run(state,{type:'releasePO',id:po.id}); assert.equal(paidTotal(state,po.id),0);
  state=run(as(state,'Logistics'),{type:'createBatch',poId:po.id,scheduledDate:'2026-10-09',evidence:'Credit delivery',delayReason:'',expected:{cement:10}});
  state=run(state,{type:'dispatchBatch',id:state.batches[0].id});
  state=run(as(state,'Site Personnel'),{type:'confirmBatch',id:state.batches[0].id,lines:{cement:{accepted:10,issue:''}}});
  state=run(state,{type:'postBatch',id:state.batches[0].id,accepted:{cement:10},reason:'Verified quantities'});
  const deliveries=structuredClone(state.batches),movements=structuredClone(state.movements);
  state=proof(as(state,'Accounting'));state=run(state,record(state));
  assert.deepEqual(state.batches,deliveries); assert.deepEqual(state.movements,movements);
  assert.equal(requestMonitoring(state,state.requests[0].id).delivered.state,'complete');
  assert.equal(paymentStatus(state,state.pos[0]),'Partly Paid');
});

test('partial, final and voided payments preserve proof snapshots, balances, budgets and delivery clearance',()=>{
  let state=issued(),po=state.pos[0],siteId=state.sites[0].id;
  state=run(state,{type:'releasePO',id:po.id});
  state=proof(state);state=run(state,record(state));
  const original=structuredClone(state.pos[0].creditPayments[0]);
  assert.equal(paidTotal(state,po.id),400);assert.equal(budgetFor(state,siteId).committed,600);assert.equal(budgetFor(state,siteId).spent,400);
  assert.match(accountingNextAction(state,state.pos[0]),/overdue/);
  assert.equal(tasksFor(as(state,'Finance')).length,1, 'Remaining balance requires Finance coordination');
  fail(state,record(state),/already/);
  state=proof(state,2);state=run(state,record(state,600,'BANK-2','credit-payment-2'));
  assert.equal(paymentStatus(state,state.pos[0]),'Paid');assert.equal(creditOverdue(state,state.pos[0]),false);
  assert.equal(budgetFor(state,siteId).available,9000);assert.equal(budgetFor(state,siteId).committed,0);
  fail(state,{type:'removePaymentProof',poId:po.id,documentId:original.proofs[0].id},/locked/);
  state=run(state,{type:'voidCreditPayment',poId:po.id,paymentId:'credit-payment-2',reason:'Incorrect amount entered'});
  assert.equal(paidTotal(state,po.id),400);assert.equal(state.pos[0].status,'released');
  assert.deepEqual(state.pos[0].creditPayments[0],original);
  assert.equal(state.pos[0].creditPayments[1].voided.by.role,'Accounting');
  assert.equal(state.pos[0].creditPayments[1].proofs.length,1);
  state=proof(state,3);state=run(state,record(state,600,'BANK-2','credit-payment-3'));
  assert.equal(paidTotal(state,po.id),1000);assert.equal(state.pos[0].creditPayments.length,3);
  const lifecycle=requestLifecycle(state,state.requests[0].id);assert.match(lifecycle.stages.find(stage=>stage.name==='Payment').progress,/1,000/);
});

test('payment verification rejects unarchived, reused, duplicate and cross-PO proof and invalid payments atomically',()=>{
  let state=proof(issued(),1,false),command=record(state);
  fail(state,command,/archived/);state=run(state,{type:'completePaymentProofArchive',poId:state.pos[0].id,documentId:state.pos[0].paymentProofs[0].id,fileId:'proof-1',url:'https://drive.google.com/file/d/proof-1/view'});
  for(const patch of [{amount:0},{amount:-1},{amount:1001},{amount:1.234},{date:'2026-02-30'},{date:'2026-10-10'},{reference:''},{proofIds:[]},{proofIds:['foreign']},{proofIds:[...command.proofIds,...command.proofIds]}])fail(state,{...command,...patch});
  fail(as(state,'Finance'),command,/Accounting/);
  state=run(state,command);command={...command,paymentId:'second',reference:'SECOND'};fail(state,command,/unused/);
  fail(state,{type:'attachPaymentProofs',poId:state.pos[0].id,documents:[{name:'Duplicate.pdf',mime:'application/pdf',size:20,localFileId:'different-local',sha256:'1'.padStart(64,'0')}]},/content/);
  state=proof(state,2);fail(state,record(state,400,'BANK-1','second'),/reference/);
  fail(state,{type:'voidCreditPayment',poId:state.pos[0].id,paymentId:'credit-payment-1',reason:'x'});
  fail(as(state,'Administrator'),{type:'voidCreditPayment',poId:state.pos[0].id,paymentId:'credit-payment-1',reason:'Correction'},/Accounting/);
  fail(state,{type:'savePaymentRequest',poId:state.pos[0].id,amount:100,note:'',submit:true},/external/);
  fail(state,{type:'verifyExternalPayment',poId:state.pos[0].id,method:'Bank',reference:'FULL',date:'2026-10-09'});
});

test('overdue uses Philippine calendar boundaries, persists payments and never migrates previous credit approvals',async()=>{
  const state=issued(),po=state.pos[0];po.paymentDueDate='2026-10-09';
  assert.equal(philippineDate(new Date('2026-10-09T16:00:00Z')),'2026-10-10');
  assert.equal(creditOverdue(state,po,new Date('2026-10-09T15:59:59Z')),false);
  assert.equal(creditOverdue(state,po,new Date('2026-10-09T16:00:00Z')),true);
  let paid=proof(state);paid=run(paid,record(paid));
  const originalWindow=globalThis.window, originalStorage=globalThis.localStorage, saved=new Map([['hml-constructsync-demo-v12',JSON.stringify(paid)]]);
  globalThis.window={addEventListener(){}};globalThis.localStorage=initializedWorkspaceStorage({getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)});
  try {
    const loaded=await new LocalDemoRepository().load();assert.equal(loaded.status,'ready');assert.deepEqual(loaded.snapshot,JSON.parse(JSON.stringify(paid)));
    const legacy=structuredClone(paid);delete legacy.pos[0].externalCredit;delete legacy.pos[0].creditPayments;delete legacy.pos[0].paymentDueDate;legacy.pos[0].issuance=undefined;
    saved.set('hml-constructsync-demo-v12',JSON.stringify(legacy));const before=saved.get('hml-constructsync-demo-v12');
    const existing=await new LocalDemoRepository().load();assert.equal(isExternalCredit(existing.snapshot.pos[0]),false);assert.equal(saved.get('hml-constructsync-demo-v12'),before);
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage;}
});


test('Finance coordination validates ownership, status, dates and stale updates without changing money or delivery',()=>{
  let state=as(issued(),'Finance'),po=state.pos[0];
  const command={type:'savePaymentCoordination',poId:po.id,revision:0,priority:'Urgent',status:'Scheduled',plannedDate:'2026-10-12',note:'Bank processing planned'};
  const before={budget:budgetFor(state,state.requests[0].siteId),paid:paidTotal(state,po.id),status:po.status,due:po.paymentDueDate};
  for(const role of ['Administrator','Project Manager','Accounting','Procurement','Site Personnel','Logistics'])fail(as(state,role),command,/Finance/);
  for(const patch of [{status:'Paid'},{priority:'Low'},{plannedDate:'2026-02-30'},{plannedDate:''},{status:'Delayed',note:'x'},{revision:8}])fail(state,{...command,...patch});
  const unissued=structuredClone(state);delete unissued.pos[0].issuance;fail(unissued,command,/issued/);
  state=run(state,command);po=state.pos[0];
  assert.deepEqual({budget:budgetFor(state,state.requests[0].siteId),paid:paidTotal(state,po.id),status:po.status,due:po.paymentDueDate},before);
  assert.equal(po.paymentCoordination.revision,1);assert.equal(po.coordinationHistory[0].by.role,'Finance');
  assert.equal(state.activity[0].eventType,'payment.coordination.changed');
  fail(state,command,/changed/);
  const unchanged=run(state,{...command,revision:1});assert.equal(unchanged.activity.length,state.activity.length);assert.equal(unchanged.pos[0].coordinationHistory.length,1);
  assert.ok(tasksFor(state).some(task=>task.href===`/finance/${po.id}`));
});

test('Finance plans retain immutable history and priority across partial, full and voided verification',()=>{
  let state=as(issued(),'Finance'),po=state.pos[0];
  state=run(state,{type:'savePaymentCoordination',poId:po.id,revision:0,priority:'High',status:'Awaiting Accounting verification',plannedDate:'2026-10-10',note:'External transfer reported'});
  const snapshot=structuredClone(state.pos[0].coordinationHistory[0]);
  state=proof(as(state,'Accounting'));state=run(state,record(state));po=state.pos[0];
  assert.equal(po.paymentCoordination.priority,'High');assert.equal(po.paymentCoordination.status,'Pending');assert.equal(po.paymentCoordination.plannedDate,'');
  assert.deepEqual(po.coordinationHistory[0],snapshot);assert.equal(po.coordinationHistory[1].by.role,'Accounting');
  state=proof(state,2);state=run(state,record(state,600,'BANK-2','credit-payment-2'));
  assert.equal(coordinatedPOs(state).length,0);assert.equal(coordinationStatus(state,state.pos[0]),'Settled');
  fail(as(state,'Finance'),{type:'savePaymentCoordination',poId:po.id,revision:state.pos[0].paymentCoordination.revision,priority:'High',status:'Pending',plannedDate:'',note:''},/unpaid/);
  state=run(state,{type:'voidCreditPayment',poId:po.id,paymentId:'credit-payment-2',reason:'Wrong transfer confirmed'});
  assert.equal(coordinatedPOs(state).length,1);assert.equal(coordinationStatus(state,state.pos[0]),'Pending');assert.equal(state.pos[0].paymentCoordination.priority,'High');assert.equal(state.pos[0].coordinationHistory.length,4);
});

test('coordination derives defaults, respects Philippine date boundaries and excludes legacy credit',()=>{
  const state=issued(),po=state.pos[0];
  assert.equal(coordinationStatus(state,po),'Pending');assert.equal(po.paymentCoordination,undefined);
  po.paymentDueDate='2026-10-20';po.paymentCoordination={priority:'Normal',status:'Scheduled',plannedDate:'2026-10-09',note:'',revision:1};
  assert.equal(coordinationWarning(state,po,new Date('2026-10-09T15:59:59Z')),'');
  assert.match(coordinationWarning(state,po,new Date('2026-10-09T16:00:00Z')),/missed/);
  delete po.externalCredit;assert.equal(coordinatedPOs(state,true).length,0);
});
