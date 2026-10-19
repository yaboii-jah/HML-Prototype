import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ACCOUNT_FIXTURES } from '../src/app-state/account-fixtures.ts';
import { coreFlowScenarios } from './core-flow-scenarios.mjs';

const base = (process.env.CORE_FLOW_APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const capstone = process.argv.includes('--capstone');
const detailed = process.argv.includes('--mrf372') || capstone;
const output = capstone ? path.resolve('artifacts/capstone-key-modules') : path.resolve('artifacts/core-business-flow', detailed ? 'detailed-screenshots' : '.');
const viewport = capstone ? { width: 1600, height: 1000, deviceScaleFactor: 2 } : { width: 1440, height: 900, deviceScaleFactor: 1 };
const from = Number(process.argv.find(a => a.startsWith('--from='))?.split('=')[1] || 1);
const to = Number(process.argv.find(a => a.startsWith('--to='))?.split('=')[1] || (detailed ? Infinity : 36));
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1].split(',').map(Number);
const scenario = capstone ? await (await import('./capstone-module-scenarios.mjs')).capstoneModuleScenarios() : detailed ? await (await import('./mrf372-flow-scenarios.mjs')).mrf372FlowScenarios() : coreFlowScenarios();
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-core-paper-'));
const port = 14000 + Math.floor(Math.random() * 1000);
const slug = value => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(path.join(output, 'screenshots'), { recursive: true });
let entries = [];
try { entries = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); } catch {}
if (detailed) entries = entries.flatMap(entry => {
  const checkpoint = scenario.checkpoints.find(c => c.title === entry.title);
  return checkpoint ? [{ ...entry, number: checkpoint.number, caption: `Figure ${checkpoint.number}. ${checkpoint.title}` }] : [];
});
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--disable-background-timer-throttling', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, base], { windowsHide: true, stdio: 'ignore' });
let ws, current, active;
const exceptions = [], driveCalls = [], capturedThisRun = [];
try {
  let target;
  for (let attempt = 0; attempt < 120 && !target; attempt++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.type === 'page' && t.url.startsWith(base)); } catch {}
    if (!target) await sleep(250);
  }
  assert.ok(target, 'Isolated browser starts');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/drive/')) driveCalls.push(message.params.request.url);
    if (request) { pending.delete(message.id); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call('Runtime.evaluate', { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (code, attempts = 600) => {
    for (let n = 0; n < attempts; n++) { if (await run(code)) return; await sleep(100); }
    throw Error(`Not ready: ${code}; ${await run('return document.body?.innerText.slice(0,700);')}`);
  };
  const fill = async (selector, value) => {
    await run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!el)throw Error('Missing field '+${JSON.stringify(selector)});const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));`);
    await sleep(200);
  };
  const click = async (label, partial = false, selector = 'button') => {
    await run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility()&&!e.disabled&&${partial ? 'e.textContent.trim().includes' : 'e.textContent.trim()==='}${partial ? '(' : ''}${JSON.stringify(label)}${partial ? ')' : ''});if(!el)throw Error('Missing button '+${JSON.stringify(label)});el.click();`);
    await sleep(200);
  };
  const switchRole = async role => {
    if (current === role) return;
    await run("for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();");
    await run("document.querySelector('.masthead-account').click();");
    await wait("return !!document.querySelector('.role-options');");
    await run(`const label=${JSON.stringify(role === 'Accounting / Auditing' ? 'Accounting' : role)};const el=[...document.querySelectorAll('.role-options button')].find(e=>e.querySelector('strong')?.textContent===label);if(!el)throw Error('Missing role '+label);el.click();`);
    await wait(`return document.querySelector('.account-label small')?.textContent===${JSON.stringify(role === 'Accounting / Auditing' ? 'Accounting' : role)}&&!document.querySelector('.role-dialog[open]');`);
    current = role;
  };
  const anchor = async step => {
    const found = await run(`const s=${JSON.stringify(step)};const el=s.selector?document.querySelector(s.selector):[...document.querySelectorAll(s.button?'button':'h2,h3,summary')].find(e=>(s.partial?e.textContent.trim().includes(s.button||s.heading):e.textContent.trim()===(s.button||s.heading)));if(!el)return false;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;if(el.tagName==='SUMMARY')el.parentElement.open=true;window.scrollTo(0,Math.max(0,el.getBoundingClientRect().top+scrollY-${step.offset ?? (step.button ? 610 : 95)}));return true;`);
    if (!found && !step.optional) throw Error(`Missing capture anchor: ${JSON.stringify(step)}`);
    await sleep(200);
  };
  const selected = checkpoint => checkpoint.number >= from && checkpoint.number <= to && (!only || only.includes(checkpoint.number));
  const capture = async checkpoint => {
    await run("document.activeElement?.blur();for(const b of document.querySelectorAll('.toast:not(.toast-progress) .toast-close'))b.click();");
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 220, y: 65 });
    await wait("return !document.querySelector('.toast-progress,.archive-job[aria-busy=\"true\"]');");
    await run('await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.checkVisibility()).map(i=>i.decode().catch(()=>{})));');
    await sleep(350);
    const file = `screenshots/${checkpoint.group ? checkpoint.group + '/' : ''}${String(checkpoint.number).padStart(2, '0')}-${slug(checkpoint.title)}.png`;
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(path.join(output, file), Buffer.from(result.data, 'base64'));
    const { snapshot: _snapshot, setup: _setup, ...entry } = checkpoint; void _snapshot; void _setup;
    entry.file = file; entry.role = checkpoint.role === 'Accounting / Auditing' ? 'Accounting' : checkpoint.role;
    entry.caption = `Figure ${checkpoint.number}. ${checkpoint.title}`;
    entry.visibleText = await run("return document.body.innerText;");
    for (const text of checkpoint.expectedText || []) assert.ok(entry.visibleText.includes(text), `${checkpoint.title}: expected ${text}`);
    for (const check of checkpoint.uiChecks || []) assert.ok(await run(check.expression), check.message);
    if (capstone) assert.equal(await run('return document.documentElement.scrollWidth>innerWidth+1;'), false, 'No page-level horizontal overflow');
    entries = entries.filter(e => e.number !== entry.number).concat(entry).sort((a, b) => a.number - b.number);
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(entries, null, 2));
    capturedThisRun.push(checkpoint.number);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, mobile: false });
  await wait("return !!document.querySelector('#signin-email');");
  await run("localStorage.setItem('constructsync-theme','light');document.documentElement.dataset.theme='light';await document.fonts.ready;");
  const blankLogin = scenario.checkpoints.find(c => c.loginStage === 'blank');
  if (blankLogin && selected(blankLogin)) await capture(blankLogin);
  const account = ACCOUNT_FIXTURES.find(a => a.role === (detailed ? 'Project Manager' : 'Administrator'));
  await fill('#signin-email', account.email); await fill('#signin-password', account.password);
  const credentialLogin = scenario.checkpoints.find(c => c.loginStage === 'credentials');
  if (credentialLogin && selected(credentialLogin)) {
    assert.equal(await run("return document.querySelector('#signin-password').type;"), 'password', 'Password remains masked');
    await capture(credentialLogin);
  }
  await run("document.querySelector('.signin-form button').click();");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');", 1200);
  current = account.role;
  if (detailed) await run(`const directory=JSON.parse(localStorage.getItem('hml-constructsync-users-v1'));for(const user of directory.users.filter(u=>u.active&&u.role==='Site Personnel')){user.siteIds=${JSON.stringify(scenario.final.sites.map(s => s.id))};user.revision++;}localStorage.setItem('hml-constructsync-users-v1',JSON.stringify(directory));`);
  // Supply real PDF bytes for every referenced fictional local document.
  const files = [], metadata = new Map();
  for (const document of scenario.documents) {
    if (document.sourcePath || document.previewData) {
      let bytes;
      if (document.sourcePath) bytes = await readFile(document.sourcePath);
      else {
        const response = await fetch(base + '/api/documents/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(document.previewData) });
        if (!response.ok) throw Error(`Document generation failed for ${document.name}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      files.push({ id: document.id, base64: Buffer.from(bytes).toString('base64') });
      metadata.set(document.id, { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      continue;
    }
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    let page = pdf.addPage([612, 792]), y = 740;
    for (const line of ['HML TECHNOLOGIES AND SERVICES INC.', document.name, '', ...document.lines, '', 'Demonstration copy - fictional project records']) {
      const text = line.replace(/[^\x20-\x7e]/g, ' ');
      for (const chunk of text.match(/.{1,85}/g) || ['']) {
        if (y < 55) { page = pdf.addPage([612, 792]); y = 740; }
        page.drawText(chunk, { x: 42, y, size: 11, font, color: rgb(0.12, 0.19, 0.3) }); y -= 20;
      }
    }
    const bytes = await pdf.save();
    files.push({ id: document.id, base64: Buffer.from(bytes).toString('base64') });
    metadata.set(document.id, { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await run(`const files=${JSON.stringify(files)};const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');for(const f of files)tx.objectStore('files').put(new Blob([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],{type:'application/pdf'}),f.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();return files.length;`);
  const patchMetadata = value => {
    if (!value || typeof value !== 'object') return;
    if (metadata.has(value.localFileId)) Object.assign(value, metadata.get(value.localFileId));
    for (const child of Object.values(value)) if (typeof child === 'object') patchMetadata(child);
  };
  for (const checkpoint of scenario.checkpoints.filter(c => !c.loginStage && selected(c))) {
    active = checkpoint;
    console.log(`${String(checkpoint.number).padStart(2, '0')} ${checkpoint.title}`);
    if (capstone) await call('Emulation.setDeviceMetricsOverride', { ...(checkpoint.viewport || viewport), mobile: false });
    await switchRole(checkpoint.role);
    patchMetadata(checkpoint.snapshot);
    checkpoint.snapshot.role = checkpoint.role;
    checkpoint.snapshot.siteFilter = 'all';
    await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(checkpoint.snapshot))});localStorage.setItem('constructsync-theme','light');`);
    await call('Page.navigate', { url: base + checkpoint.route });
    await wait(`return location.pathname===${JSON.stringify(checkpoint.route.split('?')[0])}&&!!document.querySelector('main h1')&&!document.querySelector('.state-screen');`);
    await run("await document.fonts.ready;document.documentElement.dataset.theme='light';document.documentElement.dataset.sidebar='expanded';window.scrollTo(0,0);");
    await sleep(350);
    assert.equal(await run("return /Access unavailable|Record unavailable|could not be found/.test(document.querySelector('h1')?.textContent||'');"), false, 'Checkpoint is accessible');
    for (const step of checkpoint.setup) {
      if (step.step) { await run(`document.querySelector('.procurement-steps button:nth-child(${step.step})').click();`); await sleep(300); }
      else if (step.waitSelector) await wait(`return !!document.querySelector(${JSON.stringify(step.waitSelector)});`);
      else if (step.collapse) await run(`for(const el of document.querySelectorAll(${JSON.stringify(step.collapse)}))el.open=false;`);
      else if (step.horizontal) await run(`const el=document.querySelector(${JSON.stringify(step.horizontal)});if(!el)throw Error('Missing horizontal comparison frame');el.scrollLeft=el.scrollWidth;`);
      else if (step.scroll) await run(`const el=document.querySelector(${JSON.stringify(step.scroll.selector)});if(!el)throw Error('Missing scrolling frame '+${JSON.stringify(step.scroll.selector)});el.scrollTop=${step.scroll.edge === 'bottom' ? 'el.scrollHeight' : step.scroll.edge === 'middle' ? '(el.scrollHeight-el.clientHeight)/2' : '0'};`);
      else if (step.openDetails) await run(`for(const el of document.querySelectorAll(${JSON.stringify(step.openDetails)}))el.open=true;`);
      else if (step.click) await click(step.click, step.partial, step.buttonSelector);
      else if (step.clickSelector) { await run(`document.querySelector(${JSON.stringify(step.clickSelector)}).click();`); await sleep(150); }
      else if (step.fill) {
        if (!step.optional || await run(`return !!document.querySelector(${JSON.stringify(step.fill)});`)) await fill(step.fill, step.value);
      } else await anchor(step);
    }
    await capture(checkpoint);
  }
  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  assert.deepEqual(driveCalls, [], 'No external Drive writes');
  await writeFile(path.join(output, 'VALIDATION.json'), JSON.stringify({ captured: entries.length, capturedThisRun, expected: scenario.checkpoints.length, viewport, commandCount: scenario.commands.length, scenarios: scenario.verified, sampleImportTests: scenario.sampleTest ? { passed: scenario.sampleTest.passed, method: scenario.sampleTest.method || 'live-extraction', files: [scenario.sampleTest.mrf, ...scenario.sampleTest.quotations].map(f => ({ file: f.file, sha256: f.sha256, verifiedGross: f.verifiedGross })) } : undefined, browserExceptions: exceptions, externalDriveRequests: driveCalls, source: 'Connected demonstration snapshots advanced through application domain commands; native UI controls, no altered page layout.', capturedAt: new Date().toISOString() }, null, 2));
  console.log(`Captured ${entries.length}/${scenario.checkpoints.length} figures in ${output}`);
} catch (error) {
  if (ws?.readyState === 1) {
    // A diagnostic is intentionally outside the paper package.
    const id = 900000;
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'JSON.stringify({text:document.body.innerText,headings:[...document.querySelectorAll("h2,h3,summary")].map(e=>e.textContent)})', returnByValue: true } }));
    await new Promise(resolve => {
      const listener = event => { const m = JSON.parse(event.data); if (m.id !== id) return; ws.removeEventListener('message', listener); void writeFile(path.join('.next', 'core-flow-capture-diagnostic.json'), JSON.stringify({ checkpoint: active?.number, error: error.message, page: m.result?.result?.value }, null, 2)).then(resolve); };
      ws.addEventListener('message', listener); setTimeout(resolve, 2000);
    });
  }
  throw error;
} finally { ws?.close(); browser.kill(); }
