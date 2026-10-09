import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';

let archives = 0;
globalThis.__deliveryArchive = async () => { archives++; return { driveFileId: 'receipt-file', url: 'https://drive.google.com/file/d/receipt-file/view' }; };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/src/server/drive') return { url: 'data:text/javascript,export async function archiveDeliveryReceipt(...args){return globalThis.__deliveryArchive(...args)}', shortCircuit: true };
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { POST } = await import('../app/api/drive/delivery-receipts/route.ts');
const post = (body, headers = {}) => new Request('http://localhost/api/drive/delivery-receipts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function receipt() {
  const state = seedDemo(), batch = state.batches.find(value => value.status === 'expected');
  state.role = 'Site Personnel'; state.pos.find(value => value.id === batch.poId).status = 'released';
  const result = applyCommand(state, { type: 'confirmBatch', id: batch.id, lines: Object.fromEntries(batch.lines.map(line => [line.itemId, { accepted: line.expected, issue: '' }])) });
  assert.equal(result.ok, true, result.message);
  return result.snapshot.batches.find(value => value.id === batch.id).receiptVersions[0];
}

test('receipt archive route accepts only valid confirmed snapshots and same-origin writes', async t => {
  const env = { enabled: process.env.GOOGLE_DRIVE_ENABLED, vercel: process.env.VERCEL_ENV };
  delete process.env.VERCEL_ENV; process.env.GOOGLE_DRIVE_ENABLED = 'true';
  t.after(() => { for (const [name, value] of [['GOOGLE_DRIVE_ENABLED', env.enabled], ['VERCEL_ENV', env.vercel]]) if (value === undefined) delete process.env[name]; else process.env[name] = value; delete globalThis.__deliveryArchive; });
  const original = receipt(), body = { receipt: original, projectFolderId: 'project-folder' };
  const invalid = [{}, { ...body, receipt: { ...original, version: 0 } }, { ...body, receipt: { ...original, id: '' } }, { ...body, receipt: { ...original, data: { ...original.data, batch: { ...original.data.batch, status: 'dispatched' } } } }, { ...body, receipt: { ...original, data: { ...original.data, po: { ...original.data.po, id: 'foreign-po' } } } }, { ...body, projectFolderId: '' }];
  for (const value of invalid) assert.equal((await POST(post(value))).status, 400);
  assert.equal(archives, 0);
  assert.equal((await POST(post(body, { origin: 'https://other.example' }))).status, 403);
  const result = await POST(post(body)); assert.equal(result.status, 200); assert.equal((await result.json()).driveFileId, 'receipt-file'); assert.equal(archives, 1);
  process.env.GOOGLE_DRIVE_ENABLED = 'false'; assert.equal((await POST(post(body))).status, 503);
});
