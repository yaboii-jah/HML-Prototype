import test from 'node:test';
import assert from 'node:assert/strict';
import { localArchiveFixture } from './fixtures/local-archive.ts';
import { parseCurrent } from '../src/mock/repository.ts';
import { validArchiveFileLink, localArchiveUrl } from '../src/domain/archive-destination.ts';
import { operationFingerprint } from '../src/domain/operations.ts';
import { localArchiveFiles } from '../src/domain/local-files.ts';
import { createReadAccess } from '../src/domain/read-access.ts';

const { snapshot: state, documents } = localArchiveFixture('showcase-test-install', new Date('2026-10-15T08:00:00Z'));
test('synthetic local archive remains valid after persistence', () => {
  assert.ok(parseCurrent(JSON.stringify(state)));
  assert.ok(state.sites.every(site => !site.driveFolderId && site.localArchiveId === state.showcase.installationId));
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
