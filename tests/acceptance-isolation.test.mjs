import assert from 'node:assert/strict';
import test from 'node:test';
import { disposableHttpOrigin, browserRequestAllowed, realtimeSocketAllowed } from '../scripts/helpers/disposable-endpoints.mjs';
import { controlledFetch } from '../scripts/helpers/no-external-network.mjs';
import { requireCurrentEvidence } from '../scripts/helpers/verification-evidence.mjs';
import { navigateDocument } from '../scripts/helpers/browser-environment.mjs';

test('disposable service origins reject hosted, ambiguous and malformed targets before launch', () => {
  assert.equal(disposableHttpOrigin('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  for (const target of ['https://gxphubtycnvhpgstruqb.supabase.co', 'https://caiasmpfhueuouxqhalo.supabase.co',
    'http://localhost', 'https://localhost:54321', 'postgres://localhost:54321', 'http://a@localhost:54321',
    'http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1:54321?target=remote', 'http://127.0.0.1.evil:54321']) {
    assert.throws(() => disposableHttpOrigin(target), target);
  }
});

test('actual browser HTTP and WebSocket policies reject wrong origins, ports, paths and credentials', () => {
  const app = 'http://127.0.0.1:3198', api = 'http://127.0.0.1:54321', socket = 'ws://127.0.0.1:54321/realtime/v1/websocket';
  assert.equal(browserRequestAllowed(app + '/projects', app, api), true);
  assert.equal(browserRequestAllowed(api + '/realtime/v1/api/broadcast', app, api), true);
  assert.equal(realtimeSocketAllowed(socket + '?apikey=public&vsn=2.0.0', socket), true);
  for (const address of ['https://example.invalid', 'http://127.0.0.1:3197/projects', api + '/auth/v1/token', 'http://user@127.0.0.1:3198/']) {
    assert.equal(browserRequestAllowed(address, app, api), false, address);
  }
  for (const address of ['wss://127.0.0.1:54321/realtime/v1/websocket', 'ws://127.0.0.1:54322/realtime/v1/websocket',
    'ws://example.invalid/realtime/v1/websocket', 'ws://127.0.0.1:54321/auth/v1',
    'ws://user@127.0.0.1:54321/realtime/v1/websocket', socket + '#fragment']) {
    assert.equal(realtimeSocketAllowed(address, socket), false, address);
  }
});

test('Node network guard blocks before calling fetch and forbids redirect escape', async () => {
  let calls = 0;
  const transport = async (_input, init) => { calls++; assert.equal(init.redirect, 'error'); return 'local'; };
  for (const target of ['https://example.invalid', 'http://localhost.evil/', 'http://localhost@remote.invalid', 'file:///tmp/a', 'http://user@localhost/']) {
    assert.throws(() => controlledFetch(transport, target));
  }
  assert.equal(calls, 0);
  assert.equal(await controlledFetch(transport, 'http://127.0.0.1:3198', { redirect: 'follow' }), 'local');
  assert.equal(calls, 1);
  assert.equal(await controlledFetch(async (_input, init) => { assert.equal(init.redirect, 'manual'); return 'acknowledgement'; },
    'http://127.0.0.1:3198/upload/drive/v3/files', { redirect: 'manual' }), 'acknowledgement');
});

test('acceptance rejects stale, partial and failing evidence', () => {
  const source = { sourceRevision: 'a', sourceHash: 'b', migrationHash: 'c' };
  const passed = { ...source, complete: true, passed: true };
  requireCurrentEvidence(passed, source, 'valid');
  for (const patch of [{ sourceRevision: 'old' }, { sourceHash: 'old' }, { migrationHash: 'old' }, { passed: false }, { complete: false }]) {
    assert.throws(() => requireCurrentEvidence({ ...passed, ...patch }, source, 'invalid'));
  }
  assert.throws(() => requireCurrentEvidence(null, source, 'missing'));
});

test('navigation preserves its result when a renderer already discarded its marker', async () => {
  const calls = [];
  const control = (navigationError, cleanupError = 'Script not found') => async method => {
    calls.push(method);
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'owned-marker' };
    if (method === 'Page.navigate') return navigationError ? { errorText: navigationError } : {};
    if (method === 'Runtime.evaluate') return { result: { value: true } };
    if (method === 'Page.removeScriptToEvaluateOnNewDocument') throw Error(cleanupError);
    throw Error('Unexpected method');
  };
  await navigateDocument(control(), 'http://127.0.0.1:3198/projects');
  assert.equal(calls.at(-1), 'Page.removeScriptToEvaluateOnNewDocument');
  await assert.rejects(navigateDocument(control('net::ERR_FAILED'), 'http://127.0.0.1:3198/projects'), /Navigation failed: net::ERR_FAILED/);
  await assert.rejects(navigateDocument(control(null, 'Connection lost'), 'http://127.0.0.1:3198/projects'), /Connection lost/);
});
