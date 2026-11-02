import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { browserCallTimeout, configureBrowserChecks, navigateDocument } from './browser-environment.mjs';
import { requireLoopback } from './supabase-target.mjs';

export async function authBrowser(base, { startupTimeoutMs = 30000, onLaunch } = {}) {
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000 || startupTimeoutMs > 30000) throw Error('Invalid bounded browser startup deadline');
  const appOrigin = requireLoopback(base).origin;
  const binaries = process.platform === 'win32'
    ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const binary = binaries.find(file => existsSync(file));
  assert.ok(binary, 'A supported local Chrome/Edge installation is required');
  const profileParent = resolve(tmpdir());
  const profile = await mkdtemp(join(profileParent, 'constructsync-auth-'));
  const child = spawn(binary, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-features=Translate',
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost;[::1]',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  let failedStart;
  let discoveryComplete = false;
  let startupDiagnostics = '';
  const startupStarted = Date.now();
  child.stderr.on('data', chunk => {
    // Stop collecting before any page receives an account/link. Startup-only
    // diagnostics cannot contain application credentials or confirmation URLs.
    if (!discoveryComplete) startupDiagnostics = (startupDiagnostics + chunk).slice(-3000);
  });
  child.on('error', error => { failedStart = error; });
  const stopped = new Promise(done => child.once('close', done));
  const pending = new Map();
  let nextId = 0;
  const violations = [];
  async function close() {
    socket?.close();
    for (const item of pending.values()) item.reject(Error('Browser closed'));
    pending.clear();
    child.kill();
    await Promise.race([stopped, delay(5000)]);
    const target = resolve(profile);
    if (!target.startsWith(profileParent + sep) || !basename(target).startsWith('constructsync-auth-')) throw Error('Refusing unsafe profile cleanup');
    await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
  try {
    onLaunch?.(child);
    let target;
    let lastProbe = '';
    while (Date.now() - startupStarted < startupTimeoutMs && !target) {
      if (failedStart || child.exitCode !== null) throw Error('Browser could not start');
      try {
        const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid run-owned debugging port');
        target = (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) }).then(r => r.json())).find(page => page.type === 'page');
      } catch (error) { lastProbe = `${error.code ?? error.cause?.code ?? error.name}: ${error.message}`; }
      if (!target) await delay(100);
    }
    assert.ok(target, `Isolated browser started (${Date.now() - startupStarted}ms; ${lastProbe}; ${startupDiagnostics})`);
    discoveryComplete = true;
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('Browser debugging connection timed out')); }, 15000);
      socket.onopen = () => { clearTimeout(timer); done(); };
      socket.onerror = () => { clearTimeout(timer); reject(Error('Browser debugging connection failed')); };
    });
    const call = (method, params = {}) => new Promise((done, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Browser timeout: ' + method)); }, browserCallTimeout(method, 15000));
      pending.set(id, { resolve: value => { clearTimeout(timer); done(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result); }
      if (message.method === 'Fetch.requestPaused') {
        const url = new URL(message.params.request.url);
        const allowed = url.origin === appOrigin || ['data:', 'about:'].includes(url.protocol);
        if (!allowed) violations.push(url.origin);
        void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
          requestId: message.params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}),
        }).catch(() => undefined);
      }
      if (message.method === 'Network.webSocketCreated') {
        const url = new URL(message.params.url);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) violations.push(url.origin);
      }
    };
    await configureBrowserChecks(call);
    await call('Runtime.enable');
    await call('Network.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const run = async code => {
      const result = await call('Runtime.evaluate', { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
      return result.result.value;
    };
    const wait = async code => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try { if (await run(code)) return; } catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
        await delay(75);
      }
      throw Error('Expected browser state did not appear: ' + await run('return document.body.innerText.slice(-500)'));
    };
    const navigate = async route => { await navigateDocument(call, base + route); await wait("return !!document.querySelector('h1,h2')"); };
    const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));`);
    const click = async selector => run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Control missing');el.click();`);
    return { run, wait, navigate, fill, click, call, close, discoveryMs: Date.now() - startupStarted,
      assertIsolated: () => assert.deepEqual(violations, [], 'Browser made no external HTTP/WebSocket requests') };
  } catch (error) { await close(); throw error; }
}
