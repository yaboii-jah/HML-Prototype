import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from './fixtures/workspace.ts';
import { parseCurrent } from '../src/mock/repository.ts';
import { retireStockMatchingSamples, withoutStockMatchingSamples } from '../src/mock/retire-stock-matching-samples.ts';

const source='stock-matching-samples-v1-source',destination='stock-matching-samples-v1-destination';
const currentKey='hml-constructsync-demo-v12',usersKey='hml-constructsync-users-v1',pendingKey='hml-constructsync-retired-stock-samples-files-v1';
const sampleFile='local-stock-matching-samples-v1-stock-matching-v1-1';
function fixture(){
  const base=seedDemo();
  base.requests[0].documents.push({name:'Original shared document',type:'Supporting PDF',fileId:'original-shared-file'});
  const state=structuredClone(base);
  state.showcase={installationId:'stock-matching-samples-v1',seededAt:new Date().toISOString(),revision:1};
  for(const [id,code]of[[source,'TSSRC'],[destination,'TSDST']]){
    state.sites.push({id,documentCode:code,name:'TEST '+id,location:'Test site',budget:100000,personnel:'',localArchiveId:state.showcase.installationId});
    state.scopes.push({id:id+'-scope',siteId:id,name:'TEST scope',budget:100000});
    state.movements.push({id:id+'-opening',siteId:id,itemName:'Sample cement',unit:'bag',kind:'opening',quantity:20,reason:'TEST opening',actor:'Administrator',at:'2026-10-24T00:00:00Z'});
  }
  state.requests.push({...structuredClone(base.requests[0]),id:'stock-matching-samples-v1-mrf-1',siteId:destination,scopeId:destination+'-scope',ref:'TSDST-MRF-0001',sourceRef:'TEST-STOCK-MATCH-CEMENT',documents:[{name:'Sample PDF',fileId:sampleFile,type:'Supporting PDF'},{name:'Shared PDF',fileId:'original-shared-file',type:'Supporting PDF'}]});
  state.activity.push({id:'stock-matching-samples-v1-act-1',entity:destination,projectId:destination,action:'Loaded samples',actor:'Administrator',at:'2026-10-24T00:00:00Z'});
  state.siteFilter=destination;
  assert.ok(parseCurrent(JSON.stringify(state)));
  return{base,state};
}
function storageFor(state){
  const directory={version:1,users:[{id:'tester',name:'Tester',email:'tester@example.test',role:'Site Personnel',revision:3,active:true,siteIds:['site-a',source,destination],credential:{salt:'original-salt',hash:'original-hash'}},{id:'admin',role:'Administrator',revision:2,siteIds:[],credential:{salt:'admin-salt',hash:'admin-hash'}}],activity:[{id:'account-history',action:'User updated'}]};
  const entries=new Map([[currentKey,JSON.stringify(state)],[usersKey,JSON.stringify(directory)],['constructsync-stock-draft-v1/tester/stock-matching-samples-v1-mrf-1','sample draft'],['constructsync-usage-draft-v1/tester/'+destination,'sample usage'],['constructsync-stock-draft-v1/tester/m1','real draft'],['hml-constructsync-session-v2','original session'],['theme','dark']]);
  return{directory,entries,storage:{get length(){return entries.size;},key:index=>[...entries.keys()][index]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)}};
}

test('removing the sample pack preserves unrelated records and shared document references',()=>{
  const{base,state}=fixture(),original=structuredClone(state),cleaned=withoutStockMatchingSamples(state);
  assert.deepEqual(state,original);
  assert.deepEqual(cleaned.snapshot,base);
  assert.deepEqual(cleaned.fileIds,[sampleFile]);
  assert.ok(parseCurrent(JSON.stringify(cleaned.snapshot)));
  assert.equal(withoutStockMatchingSamples(cleaned.snapshot).changed,false);
});

test('later test actions and their evidence are removed with the sample projects',()=>{
  const{state}=fixture(),requestId=state.requests.at(-1).id;
  state.stockTransfers=[{id:'test-transfer',requestId,sourceSiteId:source,destinationSiteId:destination}];
  state.transferDeliveries=[{id:'test-trip',transferId:'test-transfer',documents:[{localFileId:'test-receiving-upload'}]}];
  state.stockSuitabilityReviews=[{id:'test-review',requestId,sourceSiteId:source,destinationSiteId:destination}];
  state.usageEntries=[{id:'test-usage',siteId:destination}];
  state.quotes.push({id:'test-quote',mrfId:requestId});state.pos.push({id:'test-po',mrfId:requestId});state.batches.push({id:'test-batch',poId:'test-po'});
  state.pendingAwards.push({id:'test-award',requestId});state.bidReports.push({id:'test-report',requestId});
  state.payments.push({id:'test-payment',poId:'test-po'});state.paymentRequests.push({id:'test-payment-request',poId:'test-po'});state.accounting.push({poId:'test-po'});
  state.activity.push({id:'later-action',entity:'test-trip',action:'Posted test stock'});
  const result=withoutStockMatchingSamples(state);
  for(const key of['stockTransfers','transferDeliveries','stockSuitabilityReviews','usageEntries'])assert.equal(result.snapshot[key].length,0);
  assert.equal(result.snapshot.pos.some(value=>value.id==='test-po'),false);assert.equal(result.snapshot.activity.some(value=>value.id==='later-action'),false);
  assert.ok(result.fileIds.includes('test-receiving-upload'));
  assert.ok(parseCurrent(JSON.stringify(result.snapshot)));
});

test('unrelated local archive metadata is retained and cross-project links prevent an unsafe automatic cleanup',()=>{
  const{state}=fixture();state.showcase.installationId='previous-installation';for(const site of state.sites.filter(site=>[source,destination].includes(site.id)))site.localArchiveId='previous-installation';
  assert.deepEqual(withoutStockMatchingSamples(state).snapshot.showcase,state.showcase);
  state.stockTransfers=[{id:'cross-project',requestId:'m1',sourceSiteId:source,destinationSiteId:'site-a'}];
  const original=structuredClone(state);assert.throws(()=>withoutStockMatchingSamples(state),/linked to another project/);assert.deepEqual(state,original);
});

test('cleanup removes test assignments, documents and drafts while preserving credentials, account history and the current session',async()=>{
  const{base,state}=fixture(),{directory,entries,storage}=storageFor(state),deleted=[];
  assert.equal(await retireStockMatchingSamples(storage,async ids=>deleted.push(...ids)),true);
  assert.deepEqual(JSON.parse(storage.getItem(currentKey)),base);assert.deepEqual(deleted,[sampleFile]);
  const saved=JSON.parse(storage.getItem(usersKey));assert.deepEqual(saved.activity,directory.activity);assert.deepEqual(saved.users[1],directory.users[1]);
  assert.deepEqual(saved.users[0],{...directory.users[0],siteIds:['site-a'],revision:4});
  assert.equal(entries.has('constructsync-usage-draft-v1/tester/'+destination),false);assert.equal(entries.has('constructsync-stock-draft-v1/tester/stock-matching-samples-v1-mrf-1'),false);
  assert.equal(storage.getItem('constructsync-stock-draft-v1/tester/m1'),'real draft');assert.equal(storage.getItem('hml-constructsync-session-v2'),'original session');assert.equal(storage.getItem('theme'),'dark');
  const before=[...entries];assert.equal(await retireStockMatchingSamples(storage,async()=>assert.fail('No repeated file deletion')),false);assert.deepEqual([...entries],before);
});

test('failed document cleanup can retry after records and assignments have already been removed',async()=>{
  const{state}=fixture(),{storage}=storageFor(state);
  await assert.rejects(retireStockMatchingSamples(storage,async()=>{throw new Error('Files unavailable');}),/Files unavailable/);
  assert.equal(JSON.parse(storage.getItem(currentKey)).sites.some(site=>site.id===source),false);assert.deepEqual(JSON.parse(storage.getItem(pendingKey)),[sampleFile]);
  const deleted=[];assert.equal(await retireStockMatchingSamples(storage,async ids=>deleted.push(...ids)),true);assert.deepEqual(deleted,[sampleFile]);assert.equal(storage.getItem(pendingKey),null);
  assert.equal(JSON.parse(storage.getItem(usersKey)).users[0].revision,4);
});

test('snapshot or account write failures restore existing storage before deleting any files',async()=>{
  for(const key of[currentKey,usersKey]){
    const{state}=fixture(),{storage,entries}=storageFor(state),before=[...entries],save=storage.setItem;let fail=true;
    storage.setItem=(target,value)=>{if(fail&&target===key){fail=false;throw new Error('Storage unavailable');}save(target,value);};
    await assert.rejects(retireStockMatchingSamples(storage,async()=>assert.fail('Files must be retained')),/Storage unavailable/);assert.deepEqual([...entries],before);
  }
});
