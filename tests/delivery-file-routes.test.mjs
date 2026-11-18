import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';

let authorized = false;
let reads = 0;
let transfers = 0;
globalThis.__deliveryFileRoute = {
  async documentActor() {
    if (!authorized) throw Object.assign(Error('Sign in again'), { status:401 });
    return { activeRole:'Site Personnel' };
  },
  sameOrigin(request) {
    if (request.headers.get('origin')!=='http://127.0.0.1:3000') throw Object.assign(Error('Same origin required'), { status:403 });
  },
  async readDocumentBytes(request,limit) {
    reads++;
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length>limit) throw Object.assign(Error('Too large'), { status:413 });
    return bytes;
  },
  documentError(error) { return Response.json({ error:error.message }, { status:error.status ?? 503 }); },
  async receiptFileCommand(command,actor) { return { command,role:actor.activeRole }; },
  async transferReceiptFile(id,bytes,offset,actor) {
    transfers++;
    return { id,offset:offset+bytes.length,role:actor.activeRole };
  },
  async readReceiptFile() { return new Response(null,{ status:403 }); },
};

registerHooks({ resolve(specifier,context,next) {
  const exports = specifier==='@/src/server/documents/access' ? ['documentActor','sameOrigin','readDocumentBytes','documentError']
    : specifier==='@/src/server/deliveries/receipt-files' ? ['receiptFileCommand','transferReceiptFile','readReceiptFile'] : null;
  if (exports) {
    const source = 'export class DocumentHttpError extends Error { constructor(status,message) { super(message); this.status=status; } }'
      + exports.map(name => `export const ${name}=(...args)=>globalThis.__deliveryFileRoute.${name}(...args);`).join('');
    return { url:'data:text/javascript,'+source,shortCircuit:true };
  }
  if (specifier.startsWith('@/src/domain/')) return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  return next(specifier,context);
} });

const { POST } = await import('../app/api/delivery-files/route.ts');
const { PUT } = await import('../app/api/delivery-files/[id]/route.ts');
const request = (method,body,headers={}) => new Request('http://127.0.0.1:3000/api/delivery-files', {
  method, body, headers:{ origin:'http://127.0.0.1:3000',...headers },
});

test('receipt document writes authenticate and check origin before reading a body',async () => {
  authorized = false;
  const initial = reads;
  assert.equal((await POST(request('POST','{}'))).status,401);
  authorized = true;
  assert.equal((await POST(request('POST','{}',{ origin:'https://outside.invalid' }))).status,403);
  assert.equal(reads,initial);
  assert.equal((await POST(request('POST','broken'))).status,400);
  assert.equal((await POST(request('POST',' '.repeat(4097)))).status,413);
  assert.equal((await (await POST(request('POST','{}'))).json()).role,'Site Personnel');
});

test('receipt upload rejects bad offsets before reading and calls the checked transfer for valid chunks',async () => {
  const id = randomUUID(), context = { params:Promise.resolve({ id }) };
  const initial = reads;
  assert.equal((await PUT(request('PUT','data'),context)).status,400);
  assert.equal(reads,initial);
  const result = await PUT(request('PUT','data',{ 'upload-offset':'24' }),context);
  assert.deepEqual(await result.json(),{ id,offset:28,role:'Site Personnel' });
  assert.equal(transfers,1);
});
