import { browserCallTimeout } from "./helpers/browser-environment.mjs";
import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_FIXTURES, SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { seedDemo } from '../tests/fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';

const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-site-visibility-'));
const port = 12000 + Math.floor(Math.random() * 1000);
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVwAAAABJRU5ErkJggg==', 'base64');
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())).find(page => page.type === 'page' && (page.url.startsWith(base)||page.url==='about:blank')); } catch {}
    if (!target) await sleep(250);
  }
  assert.ok(target, 'Test browser starts');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), exceptions = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, browserCallTimeout(method, 30000));
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call('Runtime.evaluate', { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 250; i++) { if (await run(code)) return; await sleep(120); } throw new Error(`Timed out: ${code}; page=${await run('return location.pathname;')}`); };
  const navigate = async route => { await call('Page.navigate', { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route.split('?')[0])}&&!!document.querySelector('.workspace-content h1');`); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const type=el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = selector => run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click();return true;`);
  await call('Runtime.enable'); await prepareFixtureBrowser(call, base); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const realFetch=window.fetch.bind(window);
    window.__previewAborts=0;
    window.fetch=(input,init)=>{
      const url=String(input);
      if(url.startsWith('/api/drive/accounting-documents?'))return Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(png.toString('base64'))}),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}));
      if(url==='/api/drive/delivery-receipts')return new Promise(resolve=>{window.__finishArchive=()=>resolve(Response.json({error:'Held archive failure for visibility test'},{status:503}));});
      if(url==='/api/documents/preview'&&window.__holdPreview)return new Promise((resolve,reject)=>{window.__finishPreview=()=>resolve(new Response('%PDF-1.4 held',{headers:{'Content-Type':'application/pdf'}}));init.signal.addEventListener('abort',()=>{window.__previewAborts++;reject(new DOMException('Aborted','AbortError'));});});
      return realFetch(input,init);
    };
  ` });
  await call('Page.reload');
  await wait("return !!document.querySelector('#signin-email');");
  const admin = ACCOUNT_FIXTURES.find(account => account.role === 'Administrator');
  await fill('#signin-email', admin.email); await fill('#signin-password', admin.password); await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  let fixture = seedDemo();
  fixture.role = 'Administrator'; fixture.siteFilter = 'site-b';
  fixture.sites[0].budget = 9876543.21; fixture.scopes[0].budget = 8765432.10;
  fixture.sites.forEach(site => { site.driveFolderId = 'visibility-' + site.id; });
  const crossRequest = fixture.requests.find(request => request.id === 'm6');
  crossRequest.status = 'approved';
  crossRequest.items = [{ ...crossRequest.items[0], name: 'Transfer-only material', unit: 'bag', quantity: 40 }];
  fixture.movements.push({ id: 'transfer-opening', siteId: 'site-a', itemName: 'Transfer-only material', unit: 'bag', quantity: 80, kind: 'opening', reason: 'Opening stock for transfer', actor: 'Site Personnel', at: new Date().toISOString() });
  let nextId = 0;
  const proposed = applyCommand(fixture, { type: 'proposeStockTransfer', requestId: crossRequest.id, sourceSiteId: 'site-a', note: 'Assigned source context', lines: [{ itemId: crossRequest.items[0].id, sourceName: 'Transfer-only material', unit: 'bag', quantity: 20, suitabilityConfirmed: true }] }, { now: () => new Date().toISOString(), id: prefix => `${prefix}-visibility-${++nextId}`, actor: { name: 'Procurement tester', email: 'tester@example.com', role: 'Procurement' } });
  assert.equal(proposed.ok, true, proposed.message); fixture = proposed.snapshot;
  const transferId = fixture.stockTransfers[0].id;
  const document = { id: 'visible-invoice', name: 'Assigned project invoice.png', kind: 'Invoice', mime: 'image/png', size: png.length, localFileId: 'visible-invoice-file', sha256: createHash('sha256').update(png).digest('hex'), uploadedAt: new Date().toISOString(), uploadedBy: 'Accounting', archive: { status: 'complete', fileId: 'visible-invoice-drive', url: 'https://drive.google.com/file/d/visible-invoice-drive/view' } };
  fixture.accounting.find(record => record.poId === 'po1').documents = [document];
  fixture.batches.push({ ...fixture.batches[0], id: 'other-batch', ref: 'OTHER-PROJECT-DELIVERY', poId: 'po3', status: 'confirmed', lines: fixture.requests.find(request => request.id === 'm3').items.map(item => ({ itemId: item.id, expected: 1, accepted: 1, posted: 0, issue: '' })) });
  fixture.pos.find(po => po.id === 'po3').status = 'released';
  const site = ACCOUNT_FIXTURES.find(account => account.role === 'Site Personnel');
  await run(`const key='hml-constructsync-users-v1',directory=JSON.parse(localStorage.getItem(key));const user=directory.users.find(user=>user.email===${JSON.stringify(site.email)});user.siteIds=['site-a'];directory.users.push({...user,id:'visibility-source',name:'Other site operator',email:'source.visibility@example.com',siteIds:['site-b']},{...user,id:'visibility-empty',name:'Unassigned operator',email:'empty.visibility@example.com',siteIds:[]});localStorage.setItem(key,JSON.stringify(directory));localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await navigate('/dashboard');
  const switchAccount = async email => {
    const name = await run(`return JSON.parse(localStorage.getItem('hml-constructsync-users-v1')).users.find(user=>user.email===${JSON.stringify(email)}).name;`);
    await click('.masthead-account'); await wait("return !!document.querySelector('.role-options');");
    await run(`const button=[...document.querySelectorAll('.role-options button')].find(button=>button.querySelector('small')?.textContent===${JSON.stringify(name)});if(!button)throw Error('Missing account '+${JSON.stringify(name)});button.click();return true;`);
    await wait(`return document.querySelector('.masthead-account')?.textContent.includes(${JSON.stringify(name)})&&JSON.parse(localStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})).email===${JSON.stringify(email)};`);
  };
  const crossTabSwitch = async email => {
    await run(`const user=JSON.parse(localStorage.getItem('hml-constructsync-users-v1')).users.find(user=>user.email===${JSON.stringify(email)});const key=${JSON.stringify(SESSION_STORAGE_KEY)};localStorage.setItem(key,JSON.stringify({email:user.email,role:user.role,userId:user.id,revision:user.revision}));window.dispatchEvent(new StorageEvent('storage',{key}));return true;`);
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).role===${JSON.stringify(email === admin.email ? 'Administrator' : 'Site Personnel')}&&!document.querySelector('.workspace-loading');`);
  };
  const hiddenBudgets = async () => {
    assert.equal(await run("return /9,876,543|8,765,432|Budget at a glance|Budget position|Approved commitment|Available scope budget|Project allocated/.test(document.querySelector('.workspace-content').textContent);"), false, 'Budget positions are absent from the DOM');
  };

  console.log('Checking assigned-project lists and budget visibility');
  await switchAccount(site.email);
  await wait("return document.querySelector('.project-panel h2')?.textContent==='Assigned projects';");
  assert.equal(await run("return document.querySelector('select[aria-label=\"Site context\"]').value;"), 'all', 'A stale unassigned project filter becomes all assigned projects');
  assert.deepEqual(await run("return [...document.querySelectorAll('.compact-navigation a')].map(link=>link.getAttribute('href')).sort();"), ['/dashboard', '/deliveries', '/inventory', '/projects', '/requests'].sort());
  assert.equal(await run("return [...document.querySelectorAll('.project-positions a')].length;"), 1);
  await hiddenBudgets();
  for (const route of ['/projects', '/requests', '/inventory', '/deliveries', '/projects/site-a', '/requests/m1', '/purchase-orders/po1']) {
    await navigate(route); await hiddenBudgets();
    assert.equal(await run("return [...document.querySelectorAll('.workspace-content a')].some(link=>{const href=link.getAttribute('href');return ['/projects/site-b','/inventory/site-b','/requests/m3','/requests/m4','/requests/m6','/requests/m8','/requests/m9','/purchase-orders/po3','/purchase-orders/po4'].some(prefix=>href===prefix||href.startsWith(prefix+'/'));});"), false, route + ' offers no unrelated project links');
  }
  assert.ok(await run("return document.querySelector('.po-total').textContent.includes('PO total');"), 'PO prices remain visible');
  assert.equal(await run("return !!document.querySelector('.accounting-evidence')&&document.querySelector('.accounting-evidence').textContent.includes('Assigned project invoice.png')&&!document.querySelector('.evidence-upload');"), true, 'Assigned PO documents have a read-only presentation');
  await click('.evidence-file .button'); await wait("return !!document.querySelector('.evidence-preview img');");
  await click('.evidence-preview .modal-close-button');

  console.log('Checking direct URLs, cross-project transfers and safe defaults');
  for (const route of ['/projects/site-b', '/requests/m3', '/purchase-orders/po3', '/inventory/site-b/material', '/suppliers', '/purchase-orders', '/purchase-orders/po1/edit', '/requests/m1/quotes', '/finance/po1', '/accounting/po1', '/reports', '/admin', '/deliveries/new?poId=po1']) {
    await navigate(route);
    assert.equal(await run("return document.querySelector('.workspace-content h1').textContent;"), 'Access unavailable', route);
  }
  await navigate('/stock-transfers/' + transferId);
  assert.equal(await run("return document.querySelector('.transfer-summary').textContent.includes('Northline')&&!document.querySelector('.transfer-summary a[href=\"/requests/m6\"]');"), true, 'The source sees transfer context without access to the destination MRF');
  await navigate('/requests/new');
  assert.equal(await run("return document.querySelector('select[name=site]').value;"), 'site-a');
  assert.deepEqual(await run("return [...document.querySelector('select[name=site]').options].filter(option=>option.value).map(option=>option.value);"), ['site-a']);
  await navigate('/projects/site-a');
  assert.equal(await run("return !!document.querySelector('section[aria-label^=\"Scopes of work\"]')&&!document.querySelector('.drive-project-files')&&!document.querySelector('a[href*=\"drive.google.com/drive/folders\"]');"), true);
  for (const theme of ['light', 'dark']) for (const width of [1440, 768, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`); await sleep(80);
    assert.equal(await run('return document.documentElement.scrollWidth<=innerWidth+1;'), true, `${theme}/${width}`);
  }
  await call('Emulation.clearDeviceMetricsOverride');
  await switchAccount('empty.visibility@example.com'); await navigate('/dashboard');
  assert.equal(await run("return document.querySelector('.workspace-content').textContent.includes('No assigned projects')&&!document.querySelector('a[href=\"/requests/new\"]')&&!document.querySelector('.project-positions a')&&document.querySelectorAll('[data-monitoring-request]').length===0;"), true);

  console.log('Checking account changes, stale previews and archive-job visibility');
  await switchAccount(admin.email); await navigate('/deliveries/other-batch');
  await click('.generated-delivery-receipt button');
  await wait("return !!window.__finishArchive&&!!document.querySelector('.archive-activity');");
  await run("window.__holdPreview=true;document.querySelector('.batch-receipt-document button, .document-actions button, .print-hide button').click();return true;");
  await wait("return !!window.__finishPreview&&!!document.querySelector('.document-preview-dialog[open]');");
  await crossTabSwitch(site.email);
  await wait("return document.querySelector('.workspace-content h1')?.textContent==='Access unavailable'&&window.__previewAborts===1;");
  assert.equal(await run("return !!document.querySelector('dialog[open]')||!!document.querySelector('.archive-activity');"), false);
  await run('window.__finishArchive();window.__finishPreview();return true;'); await sleep(250);
  assert.equal(await run("return !!document.querySelector('dialog[open]')||!!document.querySelector('.archive-activity');"), false, 'Late responses cannot reopen old-account content');
  await navigate('/dashboard'); await switchAccount(admin.email);
  assert.equal(await run("return !!document.querySelector('.budget-track')&&document.querySelector('.project-panel h2').textContent==='Budget at a glance';"), true, 'Administrator budget visibility is preserved');
  await writeFile(path.join(profile, 'administrator-dashboard.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await switchAccount(site.email);
  await writeFile(path.join(profile, 'site-dashboard.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('Checking account changes during PDF worker initialization');
  await navigate('/purchase-orders/po1');
  for (let attempt = 0; attempt < 3; attempt++) {
    await crossTabSwitch(admin.email);
    await click('.po-print .print-hide button');
    await wait("return !!document.querySelector('.document-preview-dialog[open] .pdf-document-viewer');");
    await crossTabSwitch(site.email);
    await wait("return !document.querySelector('dialog[open]')&&!!document.querySelector('.po-total');");
    await sleep(150);
  }
  console.log('Checking assignment removal and retained financial data');
  await run(`const key='hml-constructsync-users-v1',directory=JSON.parse(localStorage.getItem(key)),user=directory.users.find(user=>user.email===${JSON.stringify(site.email)});user.siteIds=[];user.revision++;localStorage.setItem(key,JSON.stringify(directory));window.dispatchEvent(new StorageEvent('storage',{key}));return true;`);
  await wait("return !!document.querySelector('#signin-email')&&!document.querySelector('.workspace-content');");
  await fill('#signin-email', site.email); await fill('#signin-password', site.password); await click('.signin-form button');
  await wait("return !!document.querySelector('.workspace-content h1');");
  assert.equal(await run("return document.querySelector('.workspace-content h1').textContent;"), 'Access unavailable', 'Reauthentication cannot reopen the removed assignment');
  await navigate('/dashboard');
  await wait("return document.querySelector('.workspace-content')?.textContent.includes('No assigned projects');");
  assert.deepEqual(await run("const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));return [state.sites[0].budget,state.scopes[0].budget];"), [9876543.21,8765432.10], 'Visibility never overwrites budgets');
  assert.deepEqual(exceptions, []);
  console.log('Site visibility smoke passed: assigned records, hidden budgets, retained PO prices/documents, routes, transfer context, empty assignments, themes, account changes and stale reads. Screenshots:', profile);
} finally { ws?.close(); browser.kill(); }
