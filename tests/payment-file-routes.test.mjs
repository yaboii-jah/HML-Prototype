import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
let role=null, reads=0, writes=0;
globalThis.__paymentRoute={
  async documentActor(){if(!role)throw Object.assign(Error('Sign in again'),{status:401});return {activeRole:role};},
  sameOrigin(r){if(r.headers.get('origin')!=='http://127.0.0.1:3000')throw Object.assign(Error('Same origin required'),{status:403});},
  async readDocumentBytes(r,limit){reads++;const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>limit)throw Object.assign(Error('Too large'),{status:413});return bytes;},
  async paymentFileCommand(){writes++;return {groupId:randomUUID()};},
  async transferPaymentProof(){writes++;return {offset:0};},
  paymentFileError(e){return Response.json({error:e.message},{status:e.status||503});},
};
registerHooks({resolve(specifier,context,next){
  const names=specifier==='@/src/server/documents/access'?['DocumentHttpError','documentActor','sameOrigin','readDocumentBytes']:specifier==='@/src/server/payments/files'?['paymentFileCommand','transferPaymentProof','paymentFileError']:null;
  if(names)return {url:'data:text/javascript,'+names.map(n=>n==='DocumentHttpError'?'export class DocumentHttpError extends Error{constructor(status,message){super(message);this.status=status}}':`export const ${n}=(...args)=>globalThis.__paymentRoute.${n}(...args);`).join(''),shortCircuit:true};
  if(specifier.startsWith('@/src/domain/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
const routes=await import('../app/api/payment-files/route.ts');
const chunks=await import('../app/api/payment-files/uploads/[id]/route.ts');
const request=(body='{}',origin='http://127.0.0.1:3000')=>new Request('http://127.0.0.1:3000/api/payment-files',{method:'POST',headers:{origin},body});
test('payment proof writes authenticate and check origin before reading uploaded bytes',async()=>{
  role=null;assert.equal((await routes.POST(request())).status,401);assert.equal(reads,0);
  role='Accounting';assert.equal((await routes.POST(request('{}','https://other.invalid'))).status,403);assert.equal(reads,0);
  assert.equal((await routes.POST(request('broken'))).status,400);assert.equal(writes,0);
  assert.equal((await routes.POST(request())).status,200);assert.equal(writes,1);
});
test('payment chunk transport rejects malformed identity and offset before provider work',async()=>{
  const before=writes;
  assert.equal((await chunks.POST(request(),{params:Promise.resolve({id:'invalid'})})).status,400);
  assert.equal((await chunks.PUT(request(),{params:Promise.resolve({id:randomUUID()})})).status,400);
  assert.equal(writes,before);
});
