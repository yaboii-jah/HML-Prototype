import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier === 'google-auth-library') return { url: 'data:text/javascript,' + encodeURIComponent('export class OAuth2Client { setCredentials() {} async getAccessToken() { return {token:"test-only-token"}; } } export class GoogleAuth {}'), shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { prepareRequestArchive, prepareBidFile, prepareAccountingFile, downloadAccountingFile } = await import('../src/server/drive.ts');

function driveFixture(t) {
  const previousFetch = globalThis.fetch, previousEnv = { ...process.env };
  Object.assign(process.env, { GOOGLE_DRIVE_ROOT_FOLDER_ID:'company-root-12345', GOOGLE_DRIVE_OAUTH_CLIENT_ID:'test', GOOGLE_DRIVE_OAUTH_CLIENT_SECRET:'test', GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN:'test' });
  delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  t.after(() => { globalThis.fetch=previousFetch;for(const key of Object.keys(process.env)) if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv); });
  const files = new Map([['company-root-12345',{id:'company-root-12345',mimeType:'application/vnd.google-apps.folder',name:'Company'}],['project-folder-12345',{id:'project-folder-12345',mimeType:'application/vnd.google-apps.folder',name:'Project',parents:['company-root-12345']}] ]);
  const sessions = new Map(), events=[];let sequence=0;
  globalThis.fetch=async(input,options={}) => {
    const url=new URL(input), id=url.pathname.split('/').at(-1), method=options.method||'GET';
    events.push({method,url:String(url)});
    if(url.pathname.startsWith('/upload/drive/v3/files')) {
      if(method==='PUT') {const session=sessions.get(url.searchParams.get('upload_id'));const file={...session.file,size:String(options.body.length)};files.set(file.id,file);return Response.json(file);}
      const metadata=JSON.parse(options.body),file=method==='PATCH'?{...files.get(id),...metadata}:{id:`file-${++sequence}`,...metadata};
      const sessionId=`session-${++sequence}`;sessions.set(sessionId,{file,method});
      return new Response(null,{headers:{location:`https://www.googleapis.com/upload/drive/v3/files${method==='PATCH'?'/'+id:''}?uploadType=resumable&upload_id=${sessionId}`}});
    }
    if(method==='POST') {const file={id:`file-${++sequence}`,...JSON.parse(options.body)};files.set(file.id,file);return Response.json(file);}
    if(method==='PATCH') {Object.assign(files.get(id),JSON.parse(options.body));return Response.json(files.get(id));}
    if(id!=='files') {assert.ok(files.has(id),`Unexpected file ${id}`);return Response.json(files.get(id));}
    const parent=url.searchParams.get('q').match(/^'([^']+)'/)[1];return Response.json({files:[...files.values()].filter(file=>file.parents?.includes(parent))});
  };
  return {files,sessions,events};
}

test('MRF reserves its supporting file before generating the linked form and reuses its ID on retry',async t=>{
  const {files,sessions,events}=driveFixture(t);let linkedId;
  const generate=async url=>{linkedId=new URL(url).pathname.split('/')[3];assert.ok(files.has(linkedId));assert.equal(files.get(linkedId).size,undefined);return Buffer.from('%PDF-linked-form');};
  const first=await prepareRequestArchive('project-folder-12345','mrf-1','MRF-001',1,generate,100);
  assert.match(first.sessionUri,new RegExp(`/files/${linkedId}\\?`));assert.ok(first.formFileId);
  assert.equal([...sessions.values()].at(-1).method,'PATCH');
  const originalId=linkedId, retry=await prepareRequestArchive('project-folder-12345','mrf-1','MRF-001',1,generate,100);
  assert.equal(linkedId,originalId);assert.equal(retry.formFileId,first.formFileId);
  assert.equal([...files.values()].filter(file=>file.appProperties?.hmlType==='support').length,1);
  files.get(linkedId).size='100';const uploadsBefore=events.filter(event=>event.method==='PATCH').length;
  const completed=await prepareRequestArchive('project-folder-12345','mrf-1','MRF-001',1,async url=>{assert.ok(url.includes(linkedId));return Buffer.from('%PDF-linked-form');},100);
  assert.equal(completed.supportFileId,linkedId);assert.equal(events.filter(event=>event.method==='PATCH').length,uploadsBefore);
});

test('Drive treats the XLSX and PDF of one bid version as distinct immutable files',async t=>{
  const {files,sessions}=driveFixture(t),hash='a'.repeat(64);
  const xlsx=await prepareBidFile('project-folder-12345','mrf-1','MRF-001','report-1',1,'bid.xlsx',hash,20,'xlsx');
  const excelSession=sessions.get(new URL(xlsx.sessionUri).searchParams.get('upload_id'));
  files.set(excelSession.file.id,{...excelSession.file,size:'20'});
  const pdf=await prepareBidFile('project-folder-12345','mrf-1','MRF-001','report-1',1,'bid.pdf',hash,20,'pdf');
  assert.ok(pdf.sessionUri);const pdfSession=sessions.get(new URL(pdf.sessionUri).searchParams.get('upload_id'));
  assert.equal(pdfSession.file.mimeType,'application/pdf');assert.equal(pdfSession.file.appProperties.hmlFormat,'pdf');
  files.set(pdfSession.file.id,{...pdfSession.file,size:'20'});
  const recovered=await prepareBidFile('project-folder-12345','mrf-1','MRF-001','report-1',1,'bid.pdf',hash,20,'pdf');assert.equal(recovered.driveFileId,pdfSession.file.id);
  await assert.rejects(prepareBidFile('project-folder-12345','mrf-1','MRF-001','report-1',1,'bid.pdf','b'.repeat(64),20,'pdf'),/different archived/);
});

test('accounting evidence archives into its MRF/PO/batch folders and reuses the exact file on retry', async t => {
  const { files, sessions, events } = driveFixture(t);
  const document = { id:'evidence-1',batchId:'batch-1',name:'Receipt.pdf',mime:'application/pdf',size:1024,sha256:'a'.repeat(64) };
  const mrf = {id:'mrf-1',ref:'MRF-1'}, po={id:'po-1',ref:'PO-1'}, batch={id:'batch-1',ref:'DEL-1'};
  const result = await prepareAccountingFile('project-folder-12345',mrf,po,batch,document);
  const session = sessions.get(new URL(result.sessionUri).searchParams.get('upload_id'));
  assert.equal(session.file.appProperties.hmlDocumentId,document.id);
  assert.equal(session.file.appProperties.hmlPoId,po.id);
  assert.equal(session.file.appProperties.hmlBatchId,batch.id);
  let parent = files.get(session.file.parents[0]);assert.equal(parent.name,'DEL-1');
  parent=files.get(parent.parents[0]);assert.equal(parent.name,'PO-1');
  parent=files.get(parent.parents[0]);assert.equal(parent.name,'Accounting Documents');
  files.set(session.file.id,{...session.file,size:'1024'});
  const starts = events.filter(value=>value.url.includes('/upload/')).length;
  const retried = await prepareAccountingFile('project-folder-12345',mrf,po,batch,document);
  assert.equal(retried.driveFileId,session.file.id);
  assert.equal(events.filter(value=>value.url.includes('/upload/')).length,starts);
  await assert.rejects(prepareAccountingFile('project-folder-12345',mrf,po,batch,{...document,sha256:'b'.repeat(64)}),/different Drive copy/);
  await assert.rejects(downloadAccountingFile('project-folder-12345','mrf-1','different-po','batch-1',document.id,session.file.id),/invalid document metadata/);
});
