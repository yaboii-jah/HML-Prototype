import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_FIXTURES } from '../src/app-state/account-fixtures.ts';
import { buildShowcase } from '../src/mock/fixtures/showcase.ts';
import { EMPTY_WORKSPACE_MARKER } from '../src/mock/workspace-initialization.ts';

const base = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/$/, '');
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-empty-workspace-'));
const port = 11000 + Math.floor(Math.random() * 1000);
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())).find(page => page.type === 'page'); } catch {} if (!target) await sleep(150); }
  assert.ok(target, 'Isolated browser starts');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0; const pending = new Map(), exceptions = [], startupDocumentRequests = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && /\/api\/(bid-comparisons|documents\/preview)/.test(message.params.request.url)) startupDocumentRequests.push(message.params.request.url);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, method === 'Page.navigate' ? 60000 : 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => { const result = await call('Runtime.evaluate', { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const wait = async code => { for (let i = 0; i < 400; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}; ${await run('return document.body.innerText.slice(-2000);')}`); };
  const navigate = async route => { await call('Page.navigate', { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1,h2');`); };
  const fill = async (selector, value) => { await run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));`); await sleep(70); };
  const press = async (label, scope = 'body') => { await run(`const button=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')].find(value=>value.checkVisibility()&&value.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button: '+${JSON.stringify(label)});button.click();`); await sleep(100); };
  const state = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  const directory = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-users-v1'));");
  const fileCount = () => run("const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}");
  const empty = snapshot => {
    for (const key of ['sites', 'suppliers', 'categories', 'scopes', 'requests', 'quotes', 'pos', 'batches', 'movements', 'payments', 'paymentRequests', 'accounting', 'activity', 'pendingAwards', 'bidReports', 'stockTransfers', 'transferDeliveries', 'usageEntries', 'stockSuitabilityReviews']) assert.equal(snapshot[key]?.length || 0, 0, key + ' starts empty');
    assert.equal(snapshot.showcase, undefined);
  };
  const administrator = ACCOUNT_FIXTURES.find(account => account.role === 'Administrator');
  const signIn = async () => { await wait("return !!document.querySelector('#signin-email');"); await fill('#signin-email', administrator.email); await fill('#signin-password', administrator.password); await press('Sign in', '.signin-form'); await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');"); };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(new URL(base).origin)}){const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(input==='/api/drive/projects'){const calls=Number(sessionStorage.getItem('drive-project-calls')||0)+1;sessionStorage.setItem('drive-project-calls',String(calls));return Promise.resolve(calls===1?Response.json({error:'Simulated Drive outage'},{status:503}):Response.json({id:'verified-drive-folder'}));}return originalFetch(input,init);};}` });
  await navigate('/sign-in'); await wait("return !!document.querySelector('#signin-email');");
  empty(await state()); assert.equal((await directory()).users.length, 7);
  assert.equal(await fileCount(), 0); assert.deepEqual(startupDocumentRequests, []);
  assert.equal(await run(`return localStorage.getItem(${JSON.stringify(EMPTY_WORKSPACE_MARKER)});`), '1');
  assert.equal(await run("return localStorage.getItem('hml-constructsync-showcase-installed-v1');"), null);
  await signIn(); await navigate('/admin'); await press('Add project');
  await fill('.admin-add-project [name="name"]', 'Actual project');
  await fill('.admin-add-project [name="documentCode"]', 'ACTUAL');
  await fill('.admin-add-project [name="location"]', 'Manila');
  await fill('.admin-add-project [name="budget"]', '10000');
  await press('Add project', '.admin-add-project'); await wait("return !!document.querySelector('.confirm-dialog[open]');"); await press('Add project', '.confirm-dialog[open]');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0]?.driveFolderSetup?.error==='Simulated Drive outage';");
  let project = (await state()).sites[0];
  assert.equal(project.localArchiveId, undefined); assert.equal(project.driveFolderId, undefined);
  await wait("return !!document.querySelector('.record-dialog[open]');"); await press('Retry folder creation', '.record-dialog[open]');
  await wait("return !!document.querySelector('.confirm-dialog[open]');"); await press('Create folder', '.confirm-dialog[open]');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0]?.driveFolderId==='verified-drive-folder';");
  project = (await state()).sites[0]; assert.equal(project.localArchiveId, undefined);
  for (const width of [375, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 });
    await sleep(200); assert.equal(await run('return document.documentElement.scrollWidth<=innerWidth+2;'), true);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(profile, `empty-workspace-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  await navigate('/admin'); assert.equal((await state()).sites[0].id, project.id, 'New work survives reload');
  console.log('Fresh startup: empty records, seven working accounts, no generated samples, Drive setup failure and retry, persistent new project.');
  const previousDirectory = await directory();
  previousDirectory.users.find(user => user.role === 'Site Personnel').siteIds = ['old-project'];
  previousDirectory.users.push({ ...structuredClone(previousDirectory.users[0]), id: 'manually-added-account', name: 'Actual user', email: 'actual.user@example.test', active: false, siteIds: ['old-project'] });
  previousDirectory.activity.push({ id: 'preserved-account-event', action: 'User added', at: new Date().toISOString() });
  const old = buildShowcase('old-browser-install', new Date('2026-10-15T08:00:00Z')).snapshot;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(old))});localStorage.setItem('hml-constructsync-users-v1',${JSON.stringify(JSON.stringify(previousDirectory))});localStorage.setItem('hml-constructsync-demo-v11','old-workflow');localStorage.setItem('hml-constructsync-showcase-installed-v1','installed');localStorage.setItem('hml-constructsync-showcase-installing-v1','old-journal');localStorage.setItem('constructsync-usage-draft-v1/old','draft');localStorage.setItem('constructsync-stock-draft-v1/old','draft');localStorage.removeItem(${JSON.stringify(EMPTY_WORKSPACE_MARKER)});`);
  await run("for(const [name,store,keyPath] of [['hml-quotation-files','files',undefined],['hml-constructsync-showcase-backups','backups','id']]){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store,keyPath?{keyPath}:undefined);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');if(keyPath)tx.objectStore(store).put({id:'old-backup',records:'old records',files:[new Blob(['old bytes'])]});else tx.objectStore(store).put(new Blob(['old file']),'old-file');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}");
  const other = await call('Target.createTarget', { url: base + '/sign-in' });
  await navigate('/sign-in'); await wait("return !!document.querySelector('#signin-email');");
  empty(await state()); assert.equal(await fileCount(), 0);
  assert.equal(await run("return (await indexedDB.databases()).some(db=>db.name==='hml-constructsync-showcase-backups');"), false);
  const cleanedDirectory = await directory();
  assert.equal(cleanedDirectory.users.length, previousDirectory.users.length); assert.deepEqual(cleanedDirectory.activity, previousDirectory.activity);
  for (const user of cleanedDirectory.users) {
    const previous = previousDirectory.users.find(value => value.id === user.id);
    assert.deepEqual(user.credential, previous.credential); assert.equal(user.name, previous.name); assert.equal(user.email, previous.email); assert.equal(user.active, previous.active);
    assert.equal(user.siteIds?.length || 0, 0);
  }
  for (const key of ['hml-constructsync-demo-v11', 'hml-constructsync-showcase-installed-v1', 'hml-constructsync-showcase-installing-v1', 'constructsync-usage-draft-v1/old', 'constructsync-stock-draft-v1/old', 'hml-constructsync-session-v2']) assert.equal(await run(`return localStorage.getItem(${JSON.stringify(key)});`), null);
  await call('Target.closeTarget', { targetId: other.targetId });
  await signIn(); await navigate('/dashboard'); empty(await state());
  console.log('Existing workspace: records, drafts and IndexedDB documents/backups cleared once; all accounts retained; other-tab startup works.');
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(old))});localStorage.removeItem(${JSON.stringify(EMPTY_WORKSPACE_MARKER)});`);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "const originalDelete=IDBFactory.prototype.deleteDatabase;IDBFactory.prototype.deleteDatabase=function(name){if(name==='hml-constructsync-showcase-backups'&&!sessionStorage.getItem('cleanup-failed-once')){sessionStorage.setItem('cleanup-failed-once','true');throw new Error('Temporary cleanup failure');}return originalDelete.call(this,name);};" });
  await navigate('/sign-in'); await wait("return document.querySelector('h1')?.textContent==='Setup could not finish';");
  assert.equal(await run(`return localStorage.getItem(${JSON.stringify(EMPTY_WORKSPACE_MARKER)});`), null);
  assert.equal(await run("return !!document.querySelector('#signin-email');"), false);
  assert.equal((await state()).showcase.installationId, 'old-browser-install');
  await press('Retry setup'); await wait("return !!document.querySelector('#signin-email');");
  empty(await state()); assert.equal((await directory()).users.length, previousDirectory.users.length);
  await signIn(); empty(await state()); assert.deepEqual(exceptions, []);
  console.log('Empty-workspace smoke passed: startup, cleanup, accounts, concurrent tabs, failure/retry, Google Drive routing, and mobile/desktop layouts. Drive responses simulated. Screenshots:', profile);
} finally { ws?.close(); browser.kill(); }
