import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { sealAccountingUploadTicket } from '../src/server/accounting-upload-ticket.ts';

const driveMock = `
export async function prepareAccountingFile() { return {sessionUri:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test'}; }
export async function downloadAccountingFile() { return {bytes:new TextEncoder().encode('%PDF-1.4 test'),mime:'application/pdf'}; }
export async function documentUploadStatus() { return {offset:0}; }
export async function sendDocumentChunk() { return {driveFileId:'document-drive',url:'https://drive.google.com/file/d/document-drive/view'}; }
`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/src/server/drive') return {url:'data:text/javascript,'+encodeURIComponent(driveMock),shortCircuit:true};
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,context);
  return nextResolve(specifier,context);
} });
const routes = await import('./fixtures/prototype-api/drive/accounting-documents/route.ts');
const chunks = await import('./fixtures/prototype-api/drive/accounting-documents/chunk/route.ts');
const body = () => ({
  document:{id:'document',batchId:'batch',name:'Receipt.pdf',kind:'Payment receipt',mime:'application/pdf',size:12,localFileId:'local',sha256:'a'.repeat(64),archive:{status:'pending'}},
  po:{id:'po',ref:'PO-1',mrfId:'mrf',status:'released'},
  batch:{id:'batch',ref:'DEL-1',poId:'po',status:'confirmed'},
  mrf:{id:'mrf',ref:'MRF-1'},projectFolderId:'project-folder'
});
function environment(t) {
  const previous={...process.env};
  delete process.env.VERCEL_ENV;
  process.env.GOOGLE_DRIVE_ENABLED='true';
  process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY=Buffer.alloc(32,8).toString('base64');
  t.after(()=>{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);});
}
const post = (value,headers={}) => new Request('http://localhost/api/drive/accounting-documents',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});

test('accounting upload routes reject missing identities, wrong relationships and cross-origin writes',async t=>{
  environment(t);
  const malformed=[{}, {...body(),document:{...body().document,localFileId:42}}, {...body(),po:{...body().po,id:undefined}}, {...body(),batch:{...body().batch,poId:'other-po'}}, {...body(),mrf:{...body().mrf,id:'other-mrf'}}, {...body(),batch:{...body().batch,status:'expected'}}];
  for(const value of malformed) assert.equal((await routes.POST(post(value))).status,400);
  assert.equal((await routes.POST(post(body(),{origin:'https://another-origin.test'}))).status,403);
  const accepted=await routes.POST(post(body()));
  assert.equal(accepted.status,200);assert.ok((await accepted.json()).ticket);
  process.env.GOOGLE_DRIVE_ENABLED='false';
  assert.equal((await routes.POST(post(body()))).status,503);
});

test('accounting chunks reject forged tickets, disguised files and invalid offsets before uploading',async t=>{
  environment(t);
  const ticket=sealAccountingUploadTicket({documentId:'document',poId:'po',batchId:'batch',total:12,mime:'application/pdf',sessionUri:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test'});
  const put=(bytes,offset='0',token=ticket)=>new Request('http://localhost/api/drive/accounting-documents/chunk',{method:'PUT',headers:{'x-drive-upload-ticket':token,'x-drive-upload-offset':offset},body:bytes});
  const pdf=new TextEncoder().encode('%PDF-1.4 abc');
  assert.equal((await chunks.PUT(put(pdf,'0','forged'))).status,502);
  assert.equal((await chunks.PUT(put(new TextEncoder().encode('<html>unsafe')))).status,400);
  assert.equal((await chunks.PUT(put(pdf,'-1'))).status,400);
  assert.equal((await chunks.PUT(put(pdf,'1'))).status,400);
  assert.equal((await chunks.PUT(put(new Uint8Array(3*1024*1024+1)))).status,400);
  assert.equal((await chunks.PUT(put(pdf))).status,200);
  const status=await chunks.POST(new Request('http://localhost/api/drive/accounting-documents/chunk',{method:'POST',headers:{'x-drive-upload-ticket':ticket}}));
  assert.deepEqual(await status.json(),{offset:0});
});

test('accounting downloads require relationship IDs and return uncached typed bytes',async t=>{
  environment(t);
  const url='http://localhost/api/drive/accounting-documents';
  assert.equal((await routes.GET(new Request(url))).status,400);
  const query=new URLSearchParams({projectFolderId:'project',requestId:'mrf',poId:'po',batchId:'batch',documentId:'document',fileId:'drive-file'});
  const response=await routes.GET(new Request(`${url}?${query}`));
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(await response.text(),/^%PDF-/);
});
