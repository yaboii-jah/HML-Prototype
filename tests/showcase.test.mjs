import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShowcase } from '../src/mock/fixtures/showcase.ts';
import { parseCurrent } from '../src/mock/repository.ts';
import { budgetFor, inventoryFor } from '../src/domain/selectors.ts';
import { tasksFor } from '../src/domain/queues.ts';
import { ROLES } from '../src/domain/types.ts';
import { validArchiveFileLink, localArchiveUrl } from '../src/domain/archive-destination.ts';
import { operationFingerprint } from '../src/domain/operations.ts';
import { localArchiveFiles } from '../src/domain/local-files.ts';
import { createReadAccess } from '../src/domain/read-access.ts';

const { snapshot: state, documents } = buildShowcase('showcase-test-install', new Date('2026-10-15T08:00:00Z'));
test('showcase has a linked current-workflow dataset and passes persisted validation', () => {
  assert.equal(state.sites.length, 5); assert.equal(state.requests.length, 30); assert.equal(state.pos.length, 45);
  assert.equal(state.batches.length, 37); assert.equal(state.suppliers.length, 10);
  assert.ok(state.requests.every(r => r.workflow === 'pm-external-v1'));
  assert.ok(state.sites.every(s => !s.driveFolderId && s.localArchiveId === state.showcase.installationId));
  assert.ok(parseCurrent(JSON.stringify(state)));
  assert.ok(state.batches.some(b => b.leg === 'supplier-warehouse'));
  assert.ok(state.batches.some(b => b.leg === 'warehouse-site'));
  assert.equal(state.stockTransfers.length, 4);
});
test('showcase budgets, stock balances and department queues remain actionable', () => {
  assert.equal(state.sites.reduce((n,s) => n + inventoryFor(state,s.id).length,0), 60);
  for (const site of state.sites) { assert.ok(budgetFor(state,site.id).available >= 0); assert.ok(inventoryFor(state,site.id).every(i => i.onHand >= 0)); }
  for (const role of ROLES) assert.ok(tasksFor({...state,role},state.sites.map(s=>s.id)).length > 0,role+' needs actionable tasks');
  assert.ok(state.pos.some(p=>p.creditPayments?.length));
  assert.ok(state.pos.some(p=>p.externalPayment));
  assert.ok(state.pos.some(p=>p.paymentCoordination?.status==='Delayed'));
  assert.ok(state.accounting.some(record=>record.review==='Complete'));
  assert.ok(state.sites.some(site=>inventoryFor(state,site.id).some(item=>item.onHand===0)));
});
test('local archive URLs are constrained to an explicit installation', () => {
  const file=documents[0].id;
  assert.ok(validArchiveFileLink(state,localArchiveUrl(file),file));
  assert.equal(validArchiveFileLink({...state,showcase:undefined},localArchiveUrl(file),file),false);
  assert.equal(validArchiveFileLink(state,localArchiveUrl(file)+'?other=1',file),false);
  assert.equal(validArchiveFileLink(state,localArchiveUrl('local-other-file'),'local-other-file'),false);
  assert.ok(validArchiveFileLink(state,'https://drive.google.com/file/d/real-file/view','real-file'));
  const corrupted=structuredClone(state);corrupted.sites[0].localArchiveId='another-install';assert.equal(parseCurrent(JSON.stringify(corrupted)),null);
});
test('document ownership limits local file access and stale operation acknowledgements', () => {
  const files=localArchiveFiles(state),source=state.sites[0],file=files.find(f=>f.projectId===source.id);
  assert.ok(file);
  const allowed=createReadAccess(state,'Site Personnel',[source.id]),denied=createReadAccess(state,'Site Personnel',[]);
  assert.ok(allowed.canOpen(localArchiveUrl(file.id)));assert.equal(denied.canOpen(localArchiveUrl(file.id)),false);
  const quote=files.find(file=>file.projectId===source.id&&file.purchasingOnly);
  assert.ok(quote);assert.equal(allowed.canOpen(localArchiveUrl(quote.id)),false);
  const target={kind:'request',id:state.requests[0].id};
  assert.notEqual(operationFingerprint(state,target),operationFingerprint({...state,showcase:{...state.showcase,installationId:'replacement-install'}},target));
  const withImage=structuredClone(state),imageId='local-'+state.showcase.installationId+'-uploaded-image';
  withImage.accounting.push({poId:state.pos[0].id,invoiceRef:'',receiptRef:'',review:'Incomplete',note:'',documents:[{id:'new-image',name:'Receiving photo.PNG',kind:'Other',mime:'image/png',size:100,localFileId:imageId,sha256:'0'.repeat(64),uploadedAt:state.showcase.seededAt,uploadedBy:'Accounting / Auditing',archive:{status:'complete',fileId:imageId,url:localArchiveUrl(imageId)}}]});
  assert.equal(localArchiveFiles(withImage).find(file=>file.id===imageId).name,'Receiving photo.PNG','Image evidence keeps its original download extension');
});
