import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { syntheticPdf, mrfLines, quotationLines } from './helpers/synthetic-documents.mjs';
import { seedDemo } from '../tests/fixtures/workspace.ts';

// Use the same configuration loader as Next, without logging credential contents.
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim().match(/(?:folders\/)?([A-Za-z0-9_-]{10,})(?:[/?].*)?$/)?.[1];
if (!root || !process.env.GEMINI_API_KEY) throw new Error('Configure the Drive root, Drive credentials and GEMINI_API_KEY before live verification.');
const runId = randomUUID(), label = 'ConstructSync verification ' + runId;
const result = { runId, at: new Date().toISOString(), checks: [], cleanup: 'not-created' };
const api = 'https://www.googleapis.com/drive/v3/files';
let folderId, server, accessToken, stopped, startupError;
async function token() {
  if (accessToken) return accessToken;
  let client;
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] }).getClient();
  } else {
    client = new OAuth2Client(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID, process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET);
    client.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN });
  }
  try { accessToken = (await client.getAccessToken()).token; } catch { throw new Error('Drive authentication failed; check the configured app credentials.'); }
  if (!accessToken) throw new Error('Drive did not provide an access token.');
  return accessToken;
}
async function drive(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + await token(), ...init.headers }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Live Drive check failed with HTTP ' + response.status);
  return response;
}
async function check(name, action) {
  try { await action(); result.checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (cause) { result.checks.push({ name, passed: false, error: cause instanceof Error ? cause.message : 'Verification failed' }); console.error('FAIL ' + name + ': ' + result.checks.at(-1).error); process.exitCode = 1; }
}
try {
  const parent = await (await drive(`${api}/${root}?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities`)).json();
  assert.equal(parent.mimeType, 'application/vnd.google-apps.folder');
  assert.equal(parent.trashed, false);
  assert.notEqual(parent.capabilities?.canAddChildren, false);
  // No existing file is updated: every application-created object is confined below this new folder.
  const folder = await (await drive(`${api}?supportsAllDrives=true&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label, mimeType: 'application/vnd.google-apps.folder', parents: [root], appProperties: { constructsyncVerification: runId } }) })).json();
  folderId = folder.id;
  assert.ok(folderId && folderId !== root);
  result.cleanup = 'pending';
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, GOOGLE_DRIVE_ROOT_FOLDER_ID: folderId, GOOGLE_DRIVE_ENABLED: 'true' } });
  stopped = new Promise(resolve => { server.once('close', resolve); server.once('error', error => { startupError = error; resolve(); }); });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (startupError || server.exitCode !== null) throw new Error('Isolated live-check application exited during startup.');
    try { if ((await fetch(base + '/sign-in')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error('Isolated live-check application did not become ready.');
  async function post(endpoint, body) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { origin: base, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Application request failed with HTTP ' + response.status);
    return payload;
  }
  const mrf = await syntheticPdf(mrfLines), quoteBytes = await syntheticPdf(quotationLines);
  await check('live MRF extraction', async () => {
    const form = new FormData(); form.append('files', new File([mrf], 'synthetic-mrf.pdf', { type: 'application/pdf' }));
    const { extraction: extracted } = await post('/api/requests/extract', form);
    assert.equal(extracted.items.length, 1); assert.match(extracted.items[0].name, /cement/i); assert.equal(extracted.items[0].quantity, 10); assert.equal(extracted.items[0].unit.toLowerCase(), 'bag');
  });
  await check('live quotation extraction', async () => {
    const form = new FormData(); form.append('files', new File([quoteBytes], 'synthetic-quote.pdf', { type: 'application/pdf' }));
    form.append('materials', JSON.stringify([{ id: 'test-item', description: 'Portland cement', quantity: 10, unit: 'bag' }]));
    const { extraction } = await post('/api/quotes/extract', form);
    assert.equal(extraction.lines.length, 1); assert.match(extraction.lines[0].description, /cement/i); assert.equal(extraction.lines[0].quantity, 10); assert.equal(extraction.lines[0].unitPrice, 250);
  });
  await check('live Drive project creation, resumable upload and download integrity', async () => {
    const project = await post('/api/drive/projects', { projectId: 'test-' + runId, name: 'Synthetic verification project' });
    const seed = seedDemo(), request = { ...seed.requests[0], id: 'mrf-' + runId, ref: 'TEST-MRF-001' };
    const quote = { ...seed.quotes[0], reviewStatus: 'finalized', id: 'quote-' + runId, mrfId: request.id, archive: { status: 'pending', files: [] }, documents: [{ fileId: 'synthetic-test-file', name: 'synthetic-quote.pdf', type: 'application/pdf' }] };
    const start = await post('/api/drive/quotes', { quote, mrf: request, projectFolderId: project.id, index: 0, size: quoteBytes.length });
    assert.ok(start.ticket);
    const statusResponse = await fetch(base + '/api/drive/quotes/chunk', { method: 'POST', headers: { origin: base, 'x-drive-upload-ticket': start.ticket }, signal: AbortSignal.timeout(60000) });
    assert.equal(statusResponse.status, 200); assert.equal((await statusResponse.json()).offset, 0);
    const uploaded = await fetch(base + '/api/drive/quotes/chunk', { method: 'PUT', headers: { origin: base, 'Content-Type': 'application/octet-stream', 'x-drive-upload-ticket': start.ticket, 'x-drive-upload-offset': '0' }, body: quoteBytes, signal: AbortSignal.timeout(120000) });
    const archived = await uploaded.json(); assert.equal(uploaded.status, 200); assert.ok(archived.driveFileId && archived.url);
    const metadata = await (await drive(`${api}/${archived.driveFileId}?supportsAllDrives=true&fields=id,mimeType,size,appProperties`)).json();
    assert.equal(metadata.mimeType, 'application/pdf'); assert.equal(Number(metadata.size), quoteBytes.length); assert.equal(metadata.appProperties.hmlQuoteId, quote.id);
    const downloaded = await (await drive(`${api}/${archived.driveFileId}?alt=media&supportsAllDrives=true`)).arrayBuffer();
    const hash = bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    assert.equal(hash(downloaded), hash(quoteBytes));
  });
} catch (cause) {
  process.exitCode = 1;
  result.error = cause instanceof Error ? cause.message : 'Live verification failed';
  console.error(result.error);
} finally {
  if (server) { server.kill(); await stopped; }
  if (folderId) {
    try {
      const own = await (await drive(`${api}/${folderId}?supportsAllDrives=true&fields=id,name,parents,appProperties`)).json();
      assert.equal(own.name, label); assert.ok(own.parents.includes(root)); assert.equal(own.appProperties.constructsyncVerification, runId);
      await drive(`${api}/${folderId}?supportsAllDrives=true&fields=id,trashed`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      const cleaned = await (await drive(`${api}/${folderId}?supportsAllDrives=true&fields=trashed`)).json();
      assert.equal(cleaned.trashed, true); result.cleanup = 'trashed-and-verified'; console.log('PASS run-owned Drive folder cleanup');
    } catch {
      result.cleanup = 'failed'; result.remainingFolderId = folderId; process.exitCode = 1;
      console.error('Live cleanup failed. Run-owned folder: ' + folderId);
    }
  }
  await mkdir('.verification', { recursive: true });
  await writeFile('.verification/live.json', JSON.stringify(result, null, 2));
}
