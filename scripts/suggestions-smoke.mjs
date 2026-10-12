import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { captureBidReport } from "../src/domain/bid-reports.ts";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-registers-"));
const port = 11000 + Math.floor(Math.random() * 1000);
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, base], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(p => p.type === "page" && p.url.startsWith(base)); } catch {}
    if (!target) await sleep(250);
  }
  assert.ok(target, "Test browser starts");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0; const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  const fixture = seedDemo();
  fixture.role = 'Procurement'; fixture.siteFilter = 'all';
  const request = fixture.requests.find(r => r.id === 'm1');
  request.status = 'approved'; request.archive = undefined; request.correction = undefined;
  fixture.sites.find(site => site.id === request.siteId).driveFolderId = 'test-project-folder';
  fixture.quotes.filter(q => q.mrfId === request.id).forEach(q => { q.reviewStatus = 'finalized'; q.currency = 'PHP'; q.archive = { status: 'complete', files: [] }; });
  fixture.scopes.push({ id: 'scope-other', siteId: 'site-a', name: 'Civil Works', budget: 1000 });
  fixture.requests.push({ ...structuredClone(request), id: 'scope-request', scopeId: 'scope-other' });
  fixture.pos.push({ ...structuredClone(fixture.pos[0]), id: 'scope-po', mrfId: 'scope-request' });
  fixture.batches.push({ ...structuredClone(fixture.batches[0]), id: 'scope-batch', poId: 'scope-po' });
  fixture.movements = [
    { id: 'a', siteId: 'site-a', itemName: 'Cement', unit: 'bag', kind: 'receipt', quantity: 10, batchId: 'b1', reason: '', actor: 'Site Personnel', at: '2026-10-12T00:00:00Z' },
    { id: 'b', siteId: 'site-a', itemName: 'Cement', unit: 'bag', kind: 'receipt', quantity: 20, batchId: 'scope-batch', reason: '', actor: 'Site Personnel', at: '2026-10-12T00:00:00Z' },
    { id: 'c', siteId: 'site-a', itemName: 'Cement', unit: 'bag', kind: 'usage', quantity: -5, reason: '', actor: 'Site Personnel', at: '2026-10-12T01:00:00Z' },
    { id: 'd', siteId: 'site-a', itemName: 'Opening stock', unit: 'pc', kind: 'opening', quantity: 3, reason: '', actor: 'Site Personnel', at: '2026-10-12T00:00:00Z' },
    { id: 'e', siteId: 'site-b', itemName: 'Empty material', unit: 'pc', kind: 'opening', quantity: 0, reason: '', actor: 'Site Personnel', at: '2026-10-12T00:00:00Z' },
  ];
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdf.addPage().drawText('Saved bid comparison page ' + (i + 1), { x: 50, y: 700, size: 20 });
  const bytes = await pdf.save();
  const report = { id: 'preview-report', requestId: 'm1', version: 1, generatedAt: '2026-10-12T00:00:00Z', fileName: 'comparison.xlsx', data: captureBidReport(fixture, 'm1', true), archive: { status: 'pending' }, pdf: { fileName: 'comparison.pdf', localFileId: 'preview-pdf', sha256: createHash('sha256').update(bytes).digest('hex'), archive: { status: 'pending' } } };
  fixture.bidReports = [report];
  const setFixture = async () => { await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`); };
  await setFixture();
  const stored = await call('Runtime.evaluate', { expression: `(async()=>{const blob=new Blob([Uint8Array.from(atob('${Buffer.from(bytes).toString('base64')}'),c=>c.charCodeAt(0))],{type:'application/pdf'});const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(blob,'preview-pdf');tx.oncomplete=resolve;tx.onerror=reject});db.close();return true})()`, awaitPromise: true, returnByValue: true });
  assert.equal(stored.result.value, true);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/inventory');
  await fill('[aria-label="Materials received for scope"]', 'site-a-scope'); await sleep(150);
  assert.equal(await run("return document.querySelectorAll('.register tbody tr').length;"), 1);
  assert.equal(await run("return document.querySelector('.register tbody td.numeric').textContent;"), '25', 'Scope filter preserves the whole project balance');
  await fill('[aria-label="Inventory unit"]', 'pc'); await sleep(100);
  assert.equal(await run("return document.querySelectorAll('.register tbody tr').length;"), 0, 'Filters combine');
  await fill('[aria-label="Inventory unit"]', ''); await fill('[aria-label="Materials received for scope"]', ''); await fill('[aria-label="Stock position"]', 'out'); await sleep(100);
  assert.equal(await run("return document.querySelector('.register tbody tr').textContent.includes('Empty material');"), true);
  await fill('[aria-label="Stock position"]', 'all'); await fill('[aria-label="Materials received for scope"]', 'scope-other'); await fill('[aria-label="Inventory unit"]', 'bag');
  await fill('.site-context select', 'site-b'); await sleep(150);
  assert.equal(await run("return document.querySelector('[aria-label=\"Materials received for scope\"]').value+document.querySelector('[aria-label=\"Inventory unit\"]').value;"), '', 'Project change clears scope and unit');
  await fill('.site-context select', 'all'); await sleep(100);
  await fill('[aria-label="Search inventory"]', 'opening'); await sleep(100);
  assert.equal(await run("return document.querySelectorAll('.register tbody tr').length;"), 1, 'Unattributed opening stock remains searchable');
  await fill('[aria-label="Search inventory"]', '');
  for (const width of [1440, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme='${theme}';return true;`); await sleep(100);
      assert.equal(await run("return document.documentElement.scrollWidth <= innerWidth+1;"), true, 'Inventory filters fit ' + width + '/' + theme);
      assert.equal(await run("return getComputedStyle(document.documentElement).scrollbarColor !== 'auto';"), true, 'Native scrollbar palette applied');
      await writeFile(path.join(profile, `inventory-${width}-${theme}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/requests/new'); await wait("return !!document.querySelector('#siteId');");
  await fill('#siteId', 'site-a'); await sleep(100);
  assert.deepEqual(await run("return [...document.querySelector('#scopeId').options].slice(1).map(o=>o.textContent);"), ['Structural', 'Civil Works'], 'Scope choices show names only');
  await navigate('/requests/m1/quotes');
  await run("[...document.querySelectorAll('.procurement-steps button')].find(b=>b.textContent.includes('Compare & award')).click();return true;");
  await wait("return !!document.querySelector('.compare-allocate');");
  assert.equal(await run("const details=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary strong')?.textContent==='Comparison reports');return !details.open&&!!(details.compareDocumentPosition(document.querySelector('.compare-allocate'))&Node.DOCUMENT_POSITION_FOLLOWING);"), true, 'Reports start collapsed above the comparative bid');
  await run("[...document.querySelectorAll('details')].find(d=>d.querySelector('summary strong')?.textContent==='Comparison reports').open=true;return true;");
  const before = await run("return localStorage.getItem('hml-constructsync-demo-v12');");
  for (const width of [1440, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme='${theme}';const button=[...document.querySelectorAll('.bid-report-row button')].find(b=>b.textContent==='Preview PDF');button.focus();button.click();return true;`);
      await wait("return !!document.querySelector('.bid-report-preview[open] .pdf-document-toolbar');");
      await wait("return !document.querySelector('.bid-report-preview [aria-label=\"Next page\"]').disabled;");
      assert.equal(await run("const d=document.querySelector('.bid-report-preview');const r=d.getBoundingClientRect(),v=d.querySelector('.pdf-document-viewer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&v.height>250&&v.bottom<=r.bottom;"), true, 'Preview fits ' + width + '/' + theme);
      assert.equal(await run("return localStorage.getItem('hml-constructsync-demo-v12');"), before, 'Preview cannot change records, versions or awards');
      await writeFile(path.join(profile, `bid-preview-${width}-${theme}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await wait("return !document.querySelector('.bid-report-preview');");
      assert.equal(await run("return document.activeElement.textContent;"), 'Preview PDF', 'Closing restores invoker focus');
    }
  }
  // A missing saved PDF must report an error and must not generate a new artifact.
  report.pdf.localFileId = 'missing-preview'; await setFixture(); await navigate('/requests/m1/quotes');
  await run("[...document.querySelectorAll('.procurement-steps button')].find(b=>b.textContent.includes('Compare & award')).click();return true;");
  await wait("return !!document.querySelector('.bid-report-row');");
  await run("[...document.querySelectorAll('details')].find(d=>d.querySelector('summary strong')?.textContent==='Comparison reports').open=true;return true;");
  await run("[...document.querySelectorAll('.bid-report-row button')].find(b=>b.textContent==='Preview PDF').click();return true;");
  await wait("return !!document.querySelector('.bid-report-preview [role=alert]');");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).bidReports.length;"), 1);
  await click('.bid-report-preview button[aria-label="Close bid comparison preview"]');
  console.log(`Suggestions smoke passed: combined scope/unit/stock/search filters, pooled balances, project reset, scope names, saved read-only PDF preview, failure handling, focus restore and desktop/mobile themes. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
