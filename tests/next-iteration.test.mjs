import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from './fixtures/workspace.ts';
import { businessDate, businessRangeError, inBusinessRange } from '../src/domain/business-dates.ts';
import { consumptionRows, consumptionCsv } from '../src/domain/consumption.ts';
import { workflowActions, canActOnWorkflowAction } from '../src/domain/workflow-actions.ts';
import { tasksFor } from '../src/domain/queues.ts';
import { materialId } from '../src/domain/ids.ts';
import { createReadAccess } from '../src/domain/read-access.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';

test('business dates agree across Philippine midnight and morning boundaries, independent of host timezone', () => {
  for (const [timestamp, expected] of [['2026-10-15T15:59:59Z','2026-10-15'],['2026-10-15T16:00:00Z','2026-10-16'],['2026-10-15T23:59:59Z','2026-10-16'],['2026-10-16T00:00:00Z','2026-10-16']]) assert.equal(businessDate(timestamp), expected);
  assert.equal(businessDate('2026-10-16'), '2026-10-16'); assert.equal(businessDate('missing'), '');
  assert.equal(inBusinessRange('2026-10-15T16:00:00Z', '2026-10-16', '2026-10-16'), true);
  assert.equal(inBusinessRange('2026-10-16T16:00:00Z', '2026-10-16', '2026-10-16'), false);
  assert.ok(businessRangeError('2026-02-30', '2026-03-01')); assert.ok(businessRangeError('2026-10-17', '2026-10-16'));
});

function stockFixture() {
  const state = seedDemo(), siteId = state.sites[0].id;
  const movement = (id, kind, quantity, at, extra = {}) => ({ id, siteId, itemName: 'Cement', unit: 'bag', kind, quantity, at, actor: 'Site Personnel', reason: 'Test stock movement', ...extra });
  state.movements = [movement('before','opening',10,'2026-09-30T15:59:59Z'), movement('opening','opening',2,'2026-09-30T16:00:00Z'), movement('receipt','receipt',5,'2026-10-01T01:00:00Z'), movement('transfer-in','transfer-in',3,'2026-10-01T02:00:00Z'), movement('old-use','usage',-0.5,'2026-10-01T02:30:00Z'), movement('use','usage',-1.5,'2026-10-01T03:00:00Z',{usageEntryId:'usage-new'}), movement('adjust','adjustment',-0.25,'2026-10-01T04:00:00Z'), movement('transfer-out','transfer-out',-2,'2026-10-01T05:00:00Z'), movement('after','usage',-5,'2026-10-31T16:00:00Z')];
  state.usageEntries = [{ id:'usage-new', movementIds:['use'] }];
  return { state, siteId, movement, filters: { from:'2026-10-01', to:'2026-10-31', projectIds:[siteId] } };
}
test('consumption reconciles every movement kind and counts grouped and legacy usage once without mutation', () => {
  const f=stockFixture(), before=structuredClone(f.state), rows=consumptionRows(f.state,f.filters), r=rows[0];
  assert.equal(rows.length,1); assert.equal(r.opening,10); assert.equal(r.added,10); assert.equal(r.used,2); assert.equal(r.transferredOut,2); assert.equal(r.adjustments,-.25); assert.equal(r.closing,15.75);
  assert.deepEqual([r.openingEntries,r.receipts,r.transfersIn],[2,5,3]); assert.equal(r.movements.length,7); assert.deepEqual(f.state,before);
});
test('consumption separates units and projects, ignores future entries and reservations, and scopes exports to readable rows', () => {
  const f=stockFixture(), other=f.state.sites[1].id;
  f.state.movements.push(f.movement('other-unit','receipt',2,'2026-10-01T01:00:00Z',{unit:'tonne'}),f.movement('private','receipt',99,'2026-10-01T01:00:00Z',{siteId:other}));
  f.state.stockTransfers=[{ sourceSiteId:f.siteId,status:'pending',lines:[{sourceMaterialId:materialId('Cement','bag'),proposed:9}] }];
  const rows=consumptionRows(f.state,f.filters); assert.equal(rows.length,2); assert.equal(rows.find(r=>r.unit==='bag').closing,15.75);
  const csv=consumptionCsv(rows,f.filters.from,f.filters.to); assert.equal(csv.split('\r\n').length,3); assert.ok(!csv.includes('99'));
  assert.equal(consumptionRows(f.state,{...f.filters,unit:'TONNE'}).length,1); assert.equal(consumptionRows(f.state,{...f.filters,search:'missing'}).length,0);
  assert.equal(consumptionRows(f.state,{...f.filters,from:'2026-11-01',to:'2026-10-01'}).length,0);
});
test('undated movements make balances incomplete without inventing dates, and CSV escapes spreadsheet text', () => {
  const f=stockFixture(); f.state.movements.push(f.movement('undated','usage',-1,undefined));
  const r=consumptionRows(f.state,f.filters)[0]; assert.equal(r.opening,null);assert.equal(r.closing,null);assert.equal(r.used,2);assert.equal(r.undated,1);
  const csv=consumptionCsv([{...r,name:'=SUM(A1:A2)',project:'Quoted "Project", north'}],f.filters.from,f.filters.to);
  assert.ok(csv.includes('"\'=SUM(A1:A2)"'));assert.ok(csv.includes('"Quoted ""Project"", north"'));assert.ok(csv.includes('Incomplete: 1 undated movements'));
});

function actionFixture() {
  const state=seedDemo(), request=state.requests.find(r=>r.id==='m1'), po=state.pos.find(p=>p.mrfId===request.id);
  state.requests=[request];state.pos=[po];state.batches=[];state.accounting=[];state.paymentRequests=[];state.payments=[];state.stockTransfers=[];state.transferDeliveries=[];
  request.status='approved';request.workflow='pm-external-v1';request.archive={status:'complete',versions:[]};delete request.correction;
  po.workflow='pm-external-v1';po.externalCredit=true;po.paymentMode='credit';po.status='released';po.issuance={at:'2026-10-01T00:00:00Z',by:{}};po.archive={status:'complete',fileId:'po',url:'https://example.test/po'};po.paymentDueDate='2099-01-01';po.creditPayments=[];
  return {state,request,po};
}
test('credit payment coordination and verification coexist with Logistics and independent split POs', () => {
  const f=actionFixture(), split={...structuredClone(f.po),id:'split',ref:'SPLIT',status:'submitted'};f.state.pos.push(split);
  const before=structuredClone(f.state), actions=workflowActions(f.state,f.request.id);
  assert.ok(actions.some(a=>a.recordId===f.po.id&&a.department==='Finance'&&a.state==='ready'));
  assert.ok(actions.some(a=>a.recordId===f.po.id&&a.department==='Accounting'&&a.state==='ready'));
  assert.ok(actions.some(a=>a.recordId===f.po.id&&a.department==='Logistics'&&a.state==='ready'));
  assert.ok(actions.some(a=>a.recordId==='split'&&a.department==='Accounting'));
  assert.deepEqual(f.state,before);assert.equal(new Set(actions.map(a=>a.id)).size,actions.length);
  for(const role of ['Finance','Logistics']) for(const task of tasksFor({...f.state,role,siteFilter:'all'})) assert.ok(actions.some(a=>a.department===role&&a.href===task.href&&a.state==='ready'));
});
test('upfront clearance identifies its blocker while proof capture and Finance coordination remain actionable', () => {
  const f=actionFixture();f.po.status='approved';f.po.paymentMode='upfront';delete f.po.externalCredit;
  const actions=workflowActions(f.state,f.request.id), clearance=actions.find(a=>a.id.startsWith('clear-delivery/'));
  assert.equal(clearance.state,'blocked');assert.match(clearance.blocker,/full external payment/i);assert.equal(canActOnWorkflowAction(clearance,'Accounting',[]),false);
  assert.ok(actions.some(a=>a.department==='Finance'&&a.state==='ready'));assert.ok(actions.some(a=>a.id.startsWith('verify-payment/')&&a.state==='ready'));
  assert.equal(actions.some(a=>a.department==='Logistics'&&a.state==='ready'),false);
});
test('source and destination transfer actions retain endpoint permissions and cancelled trips create no work', () => {
  const f=actionFixture(), source=f.state.sites.find(s=>s.id!==f.request.siteId).id;
  f.state.stockTransfers=[{id:'transfer',ref:'TRF',requestId:f.request.id,sourceSiteId:source,destinationSiteId:f.request.siteId,status:'pending',origin:{name:'Source'},destination:{name:'Destination'},lines:[],updatedAt:f.request.updatedAt}];
  let action=workflowActions(f.state,f.request.id).find(a=>a.id==='release-stock/transfer');
  assert.equal(canActOnWorkflowAction(action,'Site Personnel',[f.request.siteId]),false);assert.equal(canActOnWorkflowAction(action,'Site Personnel',[source]),true);
  f.state.stockTransfers[0].status='approved';f.state.transferDeliveries=[{id:'trip',ref:'TRIP',transferId:'transfer',status:'dispatched',origin:f.state.stockTransfers[0].origin,destination:f.state.stockTransfers[0].destination,lines:[],updatedAt:f.request.updatedAt}];
  action=workflowActions(f.state,f.request.id).find(a=>a.id==='receive-transfer/trip');assert.equal(canActOnWorkflowAction(action,'Site Personnel',[source]),false);assert.equal(canActOnWorkflowAction(action,'Site Personnel',[f.request.siteId]),true);
  f.state.transferDeliveries[0].status='cancelled';assert.equal(workflowActions(f.state,f.request.id).some(a=>a.recordId==='trip'),false);
});
test('returned requests expose revision and block dependent work; completed/rejected records drop actions', () => {
  const f=actionFixture();f.request.correction={status:'requested',scope:'full',reason:'Revise the quantities'};
  let actions=workflowActions(f.state,f.request.id);assert.ok(actions.some(a=>a.id.startsWith('revise-request/')&&a.state==='ready'));assert.ok(actions.some(a=>a.department==='Logistics'&&a.state==='blocked'));
  f.request.status='rejected';assert.deepEqual(workflowActions(f.state,f.request.id),[]);
});
test('all roles have consistent Reports and Administration section visibility without losing inventory reads', () => {
  const f=actionFixture();
  for(const role of ['Finance','Procurement','Logistics','Accounting','Project Manager','Administrator']) {
    const access=createReadAccess(f.state,role);assert.equal(access.canOpen('/admin'),role==='Administrator');assert.equal(access.canOpen('/reports'),role!=='Site Personnel');assert.equal(access.canOpen('/inventory'),true);assert.equal(access.canOpen('https://outside.example/admin'),false);
  }
});
test('setup retry is nondestructive, deduplicates concurrent retries and keeps corrupt data in recovery', async t => {
  const previous={window:globalThis.window,storage:globalThis.localStorage,indexedDB:globalThis.indexedDB};
  t.after(()=>{globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.indexedDB=previous.indexedDB;});
  const raw=JSON.stringify(seedDemo()),store=new Map([['hml-constructsync-demo-v12',raw],['hml-constructsync-showcase-installed-v1','installed'],['constructsync-usage-draft-v1/private','retain']]);
  globalThis.window={addEventListener(){}};globalThis.indexedDB={};globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
  let attempts=0,finish;
  const repo=new LocalDemoRepository(async()=>{attempts++;if(attempts===1)throw new Error('Temporary document failure');await new Promise(resolve=>{finish=resolve;});});
  assert.equal((await repo.load()).status,'setup-error');assert.equal(store.get('hml-constructsync-demo-v12'),raw);
  const first=repo.retrySetup(),second=repo.retrySetup();finish();assert.equal((await first).status,'ready');assert.equal((await second).status,'ready');assert.equal(attempts,2);assert.equal(store.get('constructsync-usage-draft-v1/private'),'retain');
  store.set('hml-constructsync-demo-v12','broken');const corrupt=new LocalDemoRepository(async()=>{});assert.equal((await corrupt.load()).status,'recovery');assert.equal((await corrupt.retrySetup()).status,'recovery');assert.equal(store.get('hml-constructsync-demo-v12'),'broken');
});
