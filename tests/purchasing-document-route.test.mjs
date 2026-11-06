import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
const target = randomUUID(), parent = randomUUID();
let role = null, rpcCalls = 0, providerCalls = 0, savedVersion = '4';
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class RpcError extends Error { constructor(code) { super('Private RPC rejected'); this.code = code; } }
globalThis.__purchasingRoutes = {
  HttpError, RpcError,
  privateDocumentRead: request => { if (request.headers.get('origin') === 'https://attacker.invalid') throw new HttpError(403, 'Same-origin access required.'); },
  documentActor: async () => { if (!role) throw new HttpError(401, 'Sign in required.'); return { activeRole: role }; },
  serviceRpc: async (name, args) => {
    rpcCalls++; if (args.actor?.activeRole === 'Site Personnel') throw new RpcError('42501');
    if ((args.artifact_id ?? args.po_id) !== target) throw new RpcError('P4801');
    return name === 'purchasing_po_request' ? parent : { fileId: 'private-provider-id', name: 'Comparison.pdf', mime: 'application/pdf', size: 12 };
  },
  purchasingView: async () => ({ records: [{ id: target, kind: 'po', version: savedVersion }] }),
  documentDrive: () => ({ stream: async (_id, range) => { providerCalls++; const bytes = Buffer.from('%PDF-sample!'); return new Response(range ? bytes.subarray(range.start, range.end + 1) : bytes); } }),
  quotationFileError: error => Response.json({ error: error.status ? error.message : 'Document unavailable.' }, { status: error.status || (error.code === '42501' ? 403 : 503), headers: { 'Cache-Control': 'private, no-store' } }),
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  const names = {
    '@/src/server/documents/access': ['privateDocumentRead', 'documentActor'],
    '@/src/server/documents/config': ['documentDrive'], '@/src/server/auth/service-rpc': ['serviceRpc'],
    '@/src/server/quotations/files': ['quotationFileError'],
    './purchasing': ['purchasingView'],
  }[specifier];
  if (names) {
    let code = names.map(n => `export const ${n}=(...args)=>globalThis.__purchasingRoutes.${n}(...args);`).join('');
    if (specifier.endsWith('/access')) code += 'export const DocumentHttpError=globalThis.__purchasingRoutes.HttpError;';
    if (specifier.endsWith('/service-rpc')) code += 'export const ServiceCommandError=globalThis.__purchasingRoutes.RpcError;';
    return { url: 'data:text/javascript,' + code, shortCircuit: true };
  }
  if (specifier === './documents') return { url: 'data:text/javascript,export const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";export const generatePurchasingPoPreview=async()=>new Uint8Array([37,80,68,70,45]);', shortCircuit: true };
  if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { readPurchasingDocument } = await import('../src/server/purchasing/read-document.ts');
const request = (query = '', headers = {}) => new Request('http://127.0.0.1:3000/api/document' + query, { headers });
test('purchasing retrieval rejects anonymous, Site and cross-origin access before provider work', async () => {
  assert.equal((await readPurchasingDocument(request(), target, 'comparison')).status, 401);
  role = 'Site Personnel'; assert.equal((await readPurchasingDocument(request(), target, 'comparison')).status, 403);
  assert.equal((await readPurchasingDocument(request('?version=4'), target, 'po')).status, 403);
  role = 'Accounting'; const before = rpcCalls;
  assert.equal((await readPurchasingDocument(request('', { origin: 'https://attacker.invalid' }), target, 'comparison')).status, 403);
  assert.equal(rpcCalls, before); assert.equal(providerCalls, 0);
});
test('comparison streaming is private, range checked and resolves opaque identities on the server', async () => {
  role = 'Accounting';
  const response = await readPurchasingDocument(request('', { range: 'bytes=0-4' }), target, 'comparison');
  assert.equal(response.status, 206); assert.equal(await response.text(), '%PDF-');
  assert.match(response.headers.get('cache-control'), /private.*no-store/); assert.equal(response.headers.get('content-range'), 'bytes 0-4/12');
  const before = providerCalls;
  assert.equal((await readPurchasingDocument(request('', { range: 'bytes=99-100' }), target, 'comparison')).status, 416);
  assert.equal(providerCalls, before);
  assert.equal((await readPurchasingDocument(request(), randomUUID(), 'comparison')).status, 404);
});
test('saved PO previews require the current saved version and expose no issuance operation', async () => {
  role = 'Procurement';
  assert.equal((await readPurchasingDocument(request('?version=3'), target, 'po')).status, 409);
  const response = await readPurchasingDocument(request('?version=4'), target, 'po');
  assert.equal(response.status, 200); assert.equal(await response.text(), '%PDF-');
  savedVersion = '5'; assert.equal((await readPurchasingDocument(request('?version=4'), target, 'po')).status, 409);
});
