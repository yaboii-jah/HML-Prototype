import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { openTransferUploadTicket, sealTransferUploadTicket } from '../src/server/transfer-upload-ticket.ts';
import { openAccountingUploadTicket, sealAccountingUploadTicket } from '../src/server/accounting-upload-ticket.ts';

let calls = 0;
globalThis.__transferDrive = async () => { calls++; return { driveFileId: 'transfer-file', url: 'https://drive.google.com/file/d/transfer-file/view' }; };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/src/server/drive') return { url: 'data:text/javascript,export const archiveTransferReceipt=(...a)=>globalThis.__transferDrive(...a);export const prepareTransferEvidence=(...a)=>globalThis.__transferDrive(...a);export const downloadTransferEvidence=(...a)=>globalThis.__transferDrive(...a);', shortCircuit: true };
  if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const receiptRoute = await import('./fixtures/prototype-api/drive/transfer-receipts/route.ts');
const evidenceRoute = await import('./fixtures/prototype-api/drive/transfer-evidence/route.ts');
function fixture() {
  let state = seedDemo(), next = 0; state.pos = []; state.pendingAwards = []; state.movements = []; state.batches = [];
  const request = state.requests[0], source = state.sites.find(site => site.id !== request.siteId); request.items = [{ ...request.items[0], id: 'material', quantity: 10, name: 'Cement', unit: 'bag' }]; request.status = 'approved'; delete request.archive;
  state.movements.push({ id: 'opening', siteId: source.id, itemName: 'Cement', unit: 'bag', quantity: 10, kind: 'opening', reason: 'Opening', actor: 'Site Personnel', at: '2026-10-12T01:00:00Z' });
  const run = (role, command, siteIds = []) => { const result = applyCommand(state, command, { actor: { name: role, email: 'person@example.test', role }, siteIds, now: () => '2026-10-12T02:00:00Z', id: prefix => prefix + '-' + ++next }); assert.equal(result.ok, true, result.message); state = result.snapshot; };
  run('Procurement', { type: 'proposeStockTransfer', requestId: request.id, sourceSiteId: source.id, note: '', lines: [{ itemId: 'material', sourceName: 'Cement', unit: 'bag', quantity: 10, suitabilityConfirmed: true }] }); const transfer = state.stockTransfers[0], line = transfer.lines[0].id;
  run('Site Personnel', { type: 'reviewStockTransfer', id: transfer.id, decision: 'approve', quantities: { [line]: 10 }, reason: '' }, [source.id]);
  run('Logistics', { type: 'scheduleTransferDelivery', transferId: transfer.id, scheduledDate: '2026-10-13', evidence: 'Transfer manifest', quantities: { [line]: 10 } }); const delivery = state.transferDeliveries[0];
  run('Logistics', { type: 'dispatchTransferDelivery', id: delivery.id });
  run('Site Personnel', { type: 'receiveTransferDelivery', id: delivery.id, lines: { [line]: { accepted: 10, issue: '' } } }, [request.siteId]);
  return state.transferDeliveries[0].receiptVersions[0];
}
const post = (path, body, origin) => new Request('http://localhost/api/drive/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
function driveEnv(t) {
  const saved = { enabled: process.env.GOOGLE_DRIVE_ENABLED, vercel: process.env.VERCEL_ENV }; delete process.env.VERCEL_ENV; process.env.GOOGLE_DRIVE_ENABLED = 'true';
  t.after(() => { for (const [key, value] of [['GOOGLE_DRIVE_ENABLED', saved.enabled], ['VERCEL_ENV', saved.vercel]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}
test('transfer receipt archive rejects unrelated, unreceived and cross-origin inputs before Drive', async t => {
  driveEnv(t); calls = 0; const receipt = fixture(), body = { receipt, projectFolderId: 'destination-folder' };
  for (const invalid of [{}, { ...body, receipt: { ...receipt, version: 0 } }, { ...body, receipt: { ...receipt, data: { ...receipt.data, transfer: { ...receipt.data.transfer, destinationSiteId: receipt.data.sourceProject.id } } } }, { ...body, receipt: { ...receipt, data: { ...receipt.data, delivery: { ...receipt.data.delivery, status: 'dispatched' } } } }]) assert.equal((await receiptRoute.POST(post('transfer-receipts', invalid))).status, 400);
  assert.equal(calls, 0); assert.equal((await receiptRoute.POST(post('transfer-receipts', body, 'https://other.example'))).status, 403);
  assert.equal((await receiptRoute.POST(post('transfer-receipts', body))).status, 200); assert.equal(calls, 1);
});
test('signed transfer evidence is bound to its trip and receipt quantity version', async t => {
  driveEnv(t); calls = 0; const receipt = fixture();
  const document = { id: 'signed', deliveryId: receipt.data.delivery.id, receiptVersion: receipt.version, kind: 'Signed delivery receipt', name: 'Signed.pdf', mime: 'application/pdf', size: 1024, localFileId: 'file', sha256: 'a'.repeat(64), uploadedAt: '2026-10-12T02:00:00Z', uploadedBy: 'Site Personnel', archive: { status: 'pending' } };
  const body = { document, data: receipt.data, projectFolderId: 'destination-folder' };
  for (const changed of [{ deliveryId: 'foreign-trip' }, { receiptVersion: 5 }, { mime: 'text/html' }, { kind: 'Payment receipt' }, { sha256: 'invalid' }]) assert.equal((await evidenceRoute.POST(post('transfer-evidence', { ...body, document: { ...document, ...changed } }))).status, 400);
  assert.equal(calls, 0); assert.equal((await evidenceRoute.POST(post('transfer-evidence', body))).status, 200); assert.equal(calls, 1);
});
test('transfer upload tickets reject tampering and cannot be used for PO evidence', t => {
  const previous = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64'); t.after(() => { if (previous === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = previous; });
  const shared = { documentId: 'signed', total: 1024, mime: 'application/pdf', sessionUri: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test' };
  const encoded = sealTransferUploadTicket({ ...shared, transferId: 'transfer', deliveryId: 'trip' }); assert.equal(openTransferUploadTicket(encoded).deliveryId, 'trip');
  assert.throws(() => openAccountingUploadTicket(encoded)); assert.throws(() => openTransferUploadTicket(sealAccountingUploadTicket({ ...shared, poId: 'po' })));
  const damaged = Buffer.from(encoded, 'base64url');
  damaged[7] ^= 1;
  assert.throws(() => openTransferUploadTicket(damaged.toString('base64url')), /invalid/);
  assert.throws(() => sealTransferUploadTicket({ ...shared, transferId: 'transfer', deliveryId: 'trip', sessionUri: 'https://evil.test/upload' }));
});
