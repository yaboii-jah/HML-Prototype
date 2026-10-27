import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadDocument } from '../src/documents/resumable-upload.ts';

function mock(t, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = previous; });
}

test('interrupted upload recovers the server offset and acknowledges a single document', async t => {
  const blob = new Blob([new Uint8Array(3 * 1024 * 1024 + 12)]), seen = [], progress = [];
  mock(t, async (_url, options) => {
    seen.push([options.method, options.headers['x-drive-upload-offset']]);
    if (seen.length === 1) throw new Error('Connection lost after server accepted bytes');
    if (options.method === 'POST') return Response.json({ offset: 3 * 1024 * 1024 });
    return Response.json({ driveFileId: 'document', url: 'https://drive.google.com/file/d/document/view' });
  });
  const result = await uploadDocument(blob, 'ticket', 0, '/api/drive/quotes/chunk', value => progress.push(value));
  assert.equal(result.driveFileId, 'document');
  assert.deepEqual(seen, [['PUT', '0'], ['POST', undefined], ['PUT', String(3 * 1024 * 1024)]]);
  assert.equal(progress.at(-1).loaded, blob.size);
});

test('MRF recovery retains both form and support document identities', async t => {
  mock(t, async (_url, options) => options.method === 'PUT' ? new Response('', { status: 503 }) : Response.json({ formFileId: 'form', formUrl: 'form-url', supportFileId: 'support', supportUrl: 'support-url' }));
  assert.deepEqual(await uploadDocument(new Blob(['%PDF-test']), 'ticket', 0, '/api/drive/archive/chunk'), { formFileId: 'form', formUrl: 'form-url', supportFileId: 'support', supportUrl: 'support-url' });
});

test('invalid starting and returned offsets, stalled uploads and missing completion cannot succeed', async t => {
  const blob = new Blob(['%PDF-test']);
  let calls = 0;
  mock(t, async () => { calls++; return Response.json({ offset: 0 }); });
  await assert.rejects(uploadDocument(blob, 'ticket', -1), /invalid upload position/);
  assert.equal(calls, 0);
  await assert.rejects(uploadDocument(blob, 'ticket', 0), /did not advance/);
  assert.equal(calls, 3);
  globalThis.fetch = async () => Response.json({ offset: blob.size + 1 });
  await assert.rejects(uploadDocument(blob, 'ticket', 0), /invalid upload position/);
  globalThis.fetch = async () => Response.json({ offset: blob.size });
  await assert.rejects(uploadDocument(blob, 'ticket', blob.size), /did not confirm/);
});

test('client rejections do not trigger a status retry', async t => {
  let calls = 0;
  mock(t, async () => { calls++; return Response.json({ error: 'Ticket expired' }, { status: 410 }); });
  await assert.rejects(uploadDocument(new Blob(['%PDF-test']), 'ticket', 0), /Ticket expired/);
  assert.equal(calls, 1);
});
