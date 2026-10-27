import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { exactStockMatch, validStockReviews } from '../src/domain/stock-suitability.ts';
import { requestSourcing, sourceStockAvailable, transferQuantityFor } from '../src/domain/stock-transfers.ts';
import { validTransferState } from '../src/domain/transfer-document.ts';
import { tasksFor } from '../src/domain/queues.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { validBidReport } from '../src/domain/bid-reports.ts';
import { directPoError } from '../src/domain/po-review.ts';
import { requestMonitoring } from '../src/domain/request-monitoring.ts';
import { requestLifecycle } from '../src/domain/request-lifecycle.ts';

let sequence = 0;
function setup() {
  let state = seedDemo();
  state.pos = []; state.pendingAwards = []; state.movements = []; state.batches = []; state.paymentRequests = []; state.payments = []; state.stockTransfers = []; state.stockSuitabilityReviews = []; state.transferDeliveries = []; state.bidReports = [];
  const request = state.requests[0], source = state.sites.find(site => site.id !== request.siteId);
  request.status = 'approved'; delete request.archive; delete request.correction;
  request.items = [{ ...request.items[0], id: 'glass', name: 'Glass 800 x 2100', unit: 'PCS', quantity: 18 }];
  for (const [name, quantity] of [['Glass 800 x 2100',6],['Glass 900 x 2100',8]]) state.movements.push({ id: name, siteId: source.id, itemName: name, unit: 'PCS', quantity, kind: 'opening', reason: 'Opening stock', actor: 'Site Personnel', at: '2026-10-13T00:00:00Z' });
  const command = (role, input, sites = []) => {
    const result = applyCommand(state, input, { now: () => '2026-10-13T01:00:00Z', id: prefix => prefix + '-' + ++sequence, siteIds: sites, actor: { name: role + ' person', email: role.replaceAll(' ','-') + '@example.test', role } });
    if (result.ok) state = result.snapshot;
    return result;
  };
  const selection = (name, quantity, review = false) => ({ itemId:'glass',sourceSiteId:source.id,sourceName:name,unit:'PCS',quantity,matchConfirmed:!review,needsReview:review,explanation:review ? 'Can the wider panel be cut to the requested width?' : '' });
  const send = (selections = [selection('Glass 800 x 2100',6),selection('Glass 900 x 2100',8,true)]) => command('Procurement',{ type:'submitStockSourcingPlan',requestId:request.id,note:'Use existing site stock',selections });
  return { get state() { return state; }, request, source, command, selection, send };
}
function quoteFor(f) {
  const quote = f.state.quotes.find(value => value.mrfId === f.request.id);
  quote.reviewStatus = 'finalized'; quote.currency = 'PHP'; quote.archive = { status:'complete',files:[] }; quote.financial = { vatStatus:'VAT',priceBasis:'exclusive',vatRate:12,reviewed:true };
  quote.lines = [{ id:'glass-offer',requestItemId:'glass',description:'Glass 800 x 2100',quantity:18,unit:'PCS',unitPrice:100,conversionFactor:1,matchConfirmed:true,brand:'',specification:'',varianceReason:'',discountType:'none',discountValue:0 }];
  f.state.quotes = [quote]; return quote;
}

test('18 requested / 6 release / 8 suitability review leaves 4 to buy and reserves only exact stock', () => {
  const f = setup(); assert.equal(f.send().ok,true);
  assert.deepEqual(requestSourcing(f.state,f.request,f.request.items[0]),{ requested:18,ordered:0,transfers:6,staged:0,suitability:8,purchase:4,unassigned:4 });
  assert.equal(sourceStockAvailable(f.state,f.source.id,'Glass 800 x 2100','PCS'),0);
  assert.equal(sourceStockAvailable(f.state,f.source.id,'Glass 900 x 2100','PCS'),8);
  assert.equal(transferQuantityFor(f.state,f.request.id,'glass','served'),0);
  assert.equal(validStockReviews(f.state),true); assert.equal(validTransferState(f.state),true);
  const state = { ...f.state,role:'Site Personnel',siteFilter:'all' };
  assert.equal(tasksFor(state,[f.request.siteId]).some(task => task.title.startsWith('Review alternative stock')),true);
  assert.equal(tasksFor(state,[f.source.id]).some(task => task.title.startsWith('Review alternative stock')),false);
});
test('different specifications cannot bypass technical approval via the old proposal command', () => {
  const f = setup(), before = structuredClone(f.state);
  const result = f.command('Procurement',{ type:'proposeStockTransfer',requestId:f.request.id,sourceSiteId:f.source.id,note:'',lines:[{ itemId:'glass',sourceName:'Glass 900 x 2100',unit:'PCS',quantity:8,suitabilityConfirmed:true }] });
  assert.equal(result.ok,false); assert.match(result.message,/approval/); assert.deepEqual(f.state,before);
  assert.equal(exactStockMatch(f.request.items[0],'  GLASS   800 x 2100  ','pcs'),true);
  assert.equal(exactStockMatch(f.request.items[0],'Glass 900 x 2100','PCS'),false);
});
test('multi-project submission is atomic, including invalid selections without partial saves', () => {
  const f = setup();
  const other = { ...f.source,id:'second-source',name:'Second source' }; f.state.sites.push(other);
  f.state.movements.push({ ...f.state.movements[0],id:'other-stock',siteId:other.id,quantity:6 });
  const choices = [f.selection('Glass 800 x 2100',3),{ ...f.selection('Glass 800 x 2100',3),sourceSiteId:other.id }];
  const project = f.state.sites.find(site => site.id === f.request.siteId); delete project.documentCode;
  const before = structuredClone(f.state); assert.equal(f.send(choices).ok,false); assert.deepEqual(f.state,before);
  project.documentCode = 'GLASS'; assert.equal(f.send(choices).ok,true); assert.equal(f.state.stockTransfers.length,2);
});
test('shared stock and aggregate request demand cannot be overallocated within a combined plan', () => {
  const f = setup(); f.request.items.push({ ...f.request.items[0],id:'glass-two' });
  const before = structuredClone(f.state);
  assert.equal(f.send([f.selection('Glass 800 x 2100',4),{ ...f.selection('Glass 800 x 2100',4),itemId:'glass-two' }]).ok,false);
  assert.deepEqual(f.state,before);
  assert.equal(f.send([f.selection('Glass 900 x 2100',8,true),f.selection('Glass 900 x 2100',8,true)]).ok,false);
});
test('destination approval can reduce quantity; release rechecks availability and consumes the hold once', () => {
  const f = setup(); f.send(); let review = f.state.stockSuitabilityReviews[0];
  const input = { type:'reviewStockSuitability',specificationsConfirmed:true,id:review.id,decision:'approve',quantity:6,reason:'Only six can be cut safely' };
  assert.equal(f.command('Site Personnel',input,[f.source.id]).ok,false);
  assert.equal(f.command('Procurement',input,[f.request.siteId]).ok,false);
  assert.equal(f.command('Site Personnel',input,[f.request.siteId]).ok,true);
  assert.equal(requestSourcing(f.state,f.request,f.request.items[0]).purchase,6);
  assert.equal(sourceStockAvailable(f.state,f.source.id,review.sourceName,review.unit),8);
  assert.equal(f.command('Site Personnel',{ type:'recordMovement',siteId:f.source.id,itemName:review.sourceName,unit:'PCS',kind:'usage',quantity:4,reason:'Used by source project' },[f.source.id]).ok,true);
  const before = structuredClone(f.state);
  assert.equal(f.command('Procurement',{ type:'requestApprovedStockRelease',id:review.id,quantity:6 }).ok,false); assert.deepEqual(f.state,before);
  assert.equal(f.command('Procurement',{ type:'requestApprovedStockRelease',id:review.id,quantity:4 }).ok,true);
  assert.equal(requestSourcing(f.state,f.request,f.request.items[0]).purchase,8);
  assert.equal(requestSourcing(f.state,f.request,f.request.items[0]).suitability,0);
  assert.equal(f.state.stockSuitabilityReviews[0].released,4);
  assert.equal(f.command('Procurement',{ type:'requestApprovedStockRelease',id:review.id,quantity:4 }).ok,false);
  assert.equal(validStockReviews(f.state),true); assert.equal(validTransferState(f.state),true);
});
test('rejection and explicit cancellation return demand without touching source stock', () => {
  for (const reject of [true,false]) {
    const f = setup(); f.send(); const review = f.state.stockSuitabilityReviews[0];
    const result = reject ? f.command('Site Personnel',{ type:'reviewStockSuitability',specificationsConfirmed:true,id:review.id,decision:'reject',quantity:0,reason:'Cannot meet required dimensions' },[f.request.siteId]) : f.command('Procurement',{ type:'cancelStockSuitability',id:review.id,reason:'Purchase instead due to urgency' });
    assert.equal(result.ok,true); assert.equal(requestSourcing(f.state,f.request,f.request.items[0]).purchase,12);
    assert.equal(sourceStockAvailable(f.state,f.source.id,review.sourceName,review.unit),8); assert.equal(validStockReviews(f.state),true);
  }
});
test('supplier awards and all PO paths respect technical-review demand', () => {
  const f = setup(), quote = quoteFor(f); f.send();
  const line = { itemId:'glass',quoteLineId:'glass-offer',quantity:5,unitPrice:100 };
  assert.equal(f.command('Procurement',{ type:'stageAward',requestId:f.request.id,quoteId:quote.id,quoteLineId:'glass-offer',quantity:5 }).ok,false);
  assert.equal(f.command('Procurement',{ type:'replaceMaterialAwards',requestId:f.request.id,itemId:'glass',awards:[{ quoteId:quote.id,quoteLineId:'glass-offer',quantity:5 }] }).ok,false);
  const make = quantity => f.command('Procurement',{ type:'createAwardPO',requestId:f.request.id,quoteId:quote.id,lines:[{ ...line,quantity }],tax:0,freight:0,discount:0,reason:'Competitive quote',notes:'' });
  assert.equal(make(5).ok,false); const made = make(4); assert.equal(made.ok,true,made.message);
  const po = f.state.pos.find(value => value.id === made.recordId);
  assert.equal(f.command('Procurement',{ type:'savePO',id:po.id,quoteId:quote.id,lines:[line],notes:'',finalize:false }).ok,false);
  assert.match(directPoError(f.state,po,[line],quote.supplierId),/exceed/);
  po.status = 'submitted'; assert.equal(f.command('Accounting / Auditing',{ type:'saveAccountingPO',id:po.id,paymentMode:'upfront',financial:po.financial,lines:[line] }).ok,false);
  const g = setup(), second = quoteFor(g); g.send([g.selection('Glass 900 x 2100',8,true)]);
  assert.equal(g.command('Procurement',{ type:'createPO',requestId:g.request.id,quoteId:second.id,reason:'Competitive quote',notes:'' }).ok,false);
});
test('frozen reports include review demand and preserve quantities after rejection', () => {
  const f = setup(); quoteFor(f); f.state.sites.find(site => site.id === f.request.siteId).driveFolderId = 'test-folder'; f.send();
  const result = f.command('Procurement',{ type:'createBidReport',requestId:f.request.id }); assert.equal(result.ok,true,result.message);
  const report = f.state.bidReports[0]; assert.equal(report.data.sourcing.glass.purchase,4); assert.equal(report.data.sourcing.glass.suitability,8); assert.equal(validBidReport(report),true);
  const legacy = structuredClone(report); delete legacy.data.sourcing.glass.suitability; legacy.data.sourcing.glass.purchase = 12; assert.equal(validBidReport(legacy),true);
  f.command('Procurement',{ type:'cancelStockSuitability',id:f.state.stockSuitabilityReviews[0].id,reason:'Purchase instead' });
  assert.equal(report.data.sourcing.glass.purchase,4); assert.equal(validBidReport(f.state.bidReports[0]),true);
});
test('reviews alone never mark the MRF served or make supplier payment not applicable', () => {
  const f = setup(); f.state.movements[1].quantity = 18; f.send([f.selection('Glass 900 x 2100',18,true)]);
  assert.equal(requestSourcing(f.state,f.request,f.request.items[0]).purchase,0);
  assert.notEqual(requestMonitoring(f.state,f.request.id).finance.state,'inactive');
  assert.equal(transferQuantityFor(f.state,f.request.id,'glass','served'),0);
  assert.ok(requestLifecycle(f.state,f.request.id));
});
test('corrected specifications invalidate active approvals and release their demand', () => {
  const f = setup(); f.send([f.selection('Glass 900 x 2100',8,true)]); const review = f.state.stockSuitabilityReviews[0];
  f.state.quotes = []; const request = f.state.requests.find(r => r.id === f.request.id); request.correction = { status:'requested',scope:'full',reason:'Correct panel width' };
  const result = f.command('Site Personnel',{ type:'saveRequest',id:request.id,intent:'draft',siteId:request.siteId,scopeId:request.scopeId,ref:request.ref,requestDate:request.requestDate,requestedBy:request.requestedBy,approvedBy:request.approvedBy,purchaser:request.purchaser,financeOfficer:request.financeOfficer,items:[{ ...request.items[0],name:'Glass 750 x 2100' }],documents:request.documents },[request.siteId]);
  assert.equal(result.ok,true,result.message); assert.equal(f.state.stockSuitabilityReviews[0].status,'stale'); assert.equal(requestSourcing(f.state,f.state.requests[0],f.state.requests[0].items[0]).suitability,0);
  assert.equal(f.command('Site Personnel',{ type:'reviewStockSuitability',specificationsConfirmed:true,id:review.id,decision:'approve',quantity:8,reason:'' },[request.siteId]).ok,false);
  assert.equal(validStockReviews(f.state),true);
});
test('old v12 workspaces and active/used reviews reload; malformed provenance is rejected', async () => {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  try {
    const f = setup(); f.send(); const storage = new Map([['hml-constructsync-demo-v12',JSON.stringify(f.state)]]);
    globalThis.localStorage = initializedWorkspaceStorage({ getItem:key => storage.get(key) || null,setItem:(key,value) => storage.set(key,value),removeItem:key => storage.delete(key) }); globalThis.window = { addEventListener(){} };
    const repository = new LocalDemoRepository(); repository.getSnapshot(); assert.equal(repository.getSnapshot().status,'ready'); assert.equal(repository.getSnapshot().snapshot.stockSuitabilityReviews.length,1);
    const bad = structuredClone(f.state); bad.stockSuitabilityReviews[0].proposed = 100; assert.equal(validStockReviews(bad),false);
    const old = structuredClone(f.state); old.stockSuitabilityReviews = undefined; assert.equal(validStockReviews(old),true); assert.equal(validTransferState(old),true);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});
