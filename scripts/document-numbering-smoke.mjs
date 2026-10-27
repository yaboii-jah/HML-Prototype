import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import { browserCallTimeout, navigateDocument } from "./helpers/browser-environment.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../tests/fixtures/workspace.ts";
import { PDFDocument } from "pdf-lib";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-registers-"));
const port = 11000 + Math.floor(Math.random() * 1000);
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(p => p.type === "page" && (p.url.startsWith(base)||p.url==='about:blank')); } catch {}
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, browserCallTimeout(method, 15000));
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await navigateDocument(call, base + route); await wait(`return location.pathname===${JSON.stringify(route.split("?")[0])}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Administrator');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  await call('Page.addScriptToEvaluateOnNewDocument', { source: `const originalFetch=window.fetch;window.fetch=(input,init)=>{if(String(input)==='/api/drive/projects')return Promise.resolve(Response.json({id:'numbering-test-folder'}));if(String(input)==='/api/requests/extract')return Promise.resolve(Response.json({extraction:{details:{projectName:'Numbered project',ref:'PAPER-111',requestDate:'2026-10-12',requestedBy:'AI Site',approvedBy:'PM',purchaser:'Buyer',financeOfficer:'Finance',specialInstructions:''},items:[{name:'Cement',quantity:2,unit:'bag',neededDate:'2026-10-13',purpose:'',location:'San Juan',remarks:''}]},warnings:[]}));return originalFetch(input,init)};` });
  const fixture = seedDemo(); fixture.role = 'Administrator'; fixture.siteFilter = 'all';
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  const state = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));" );
  const press = async (label, scope = 'document') => {
    await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing action '+${JSON.stringify(label)});b.focus();b.click();return true;`); await sleep(100);
  };
  const confirm = async () => { await wait("return !!document.querySelector('.confirm-dialog[open]');"); await click('.confirm-dialog[open] .confirm-actions button:last-child'); };
  const role = async name => {
    await click('.masthead-account');
    await run(`[...document.querySelectorAll('.role-options button')].find(b=>b.querySelector('strong').textContent===${JSON.stringify(name)}).click();return true;`);
    await sleep(120);
  };
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/admin'); await press('Add project');
  await fill('.admin-add-project [name=name]', 'Numbered project');
  await fill('.admin-add-project [name=documentCode]', 'hml');
  await fill('.admin-add-project [name=location]', 'San Juan');
  await fill('.admin-add-project [name=budget]', '10000');
  assert.equal(await run("return document.querySelector('[name=documentCode]').value;"), 'HML');
  assert.equal(await run("return document.querySelector('.admin-add-project').textContent.includes('HML-MRF-0001 / HML-PO-0001');"), true);
  for (const width of [1440, 375, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme='${theme}';return true;`); await sleep(100);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"), true, 'Project creation fits '+width+'/'+theme);
      if (width !== 320) await writeFile(path.join(profile, `project-code-${width}-${theme}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await run("document.querySelector('.admin-add-project').requestSubmit();return true;"); await confirm();
  await wait("return !!document.querySelector('.record-dialog[open] .admin-project-settings');");
  const project = (await state()).sites.at(-1);
  assert.equal(project.documentCode, 'HML');
  assert.equal(project.driveFolderId, 'numbering-test-folder');
  await press('Project', "document.querySelector('.record-dialog[open]')");
  await press('Edit project');
  await fill('.admin-edit-project [aria-label="Project code"]', 'HML-X');
  await run("document.querySelector('.admin-edit-project').requestSubmit();return true;"); await confirm();
  await wait("return !document.querySelector('.admin-edit-project');");
  await click('.record-dialog[open] .record-modal-close');
  await run(`const key='hml-constructsync-users-v1',d=JSON.parse(localStorage.getItem(key));for(const u of d.users.filter(u=>u.role==='Site Personnel'))u.siteIds=[...new Set([...u.siteIds,${JSON.stringify(project.id)}])];localStorage.setItem(key,JSON.stringify(d));return true;`);
  await role('Site Personnel'); await navigate('/requests/new');
  await fill('#siteId', project.id);
  assert.equal(await run("return document.querySelector('#ref').readOnly;"), true);
  assert.equal(await run("return document.querySelector('#ref').value;"), 'HML-X-MRF-0001');
  await fill('#sourceRef', 'MANUAL-PAPER-372');
  await press('Save draft'); await wait("return !!document.querySelector('.record-header');");
  const first = (await state()).requests.at(-1);
  assert.equal(first.ref, 'HML-X-MRF-0001');
  assert.equal(first.sourceRef, 'MANUAL-PAPER-372');
  assert.deepEqual((await state()).requests.slice(0, fixture.requests.length), fixture.requests, 'Existing references stay unchanged');
  await navigate('/requests/'+first.id+'/edit');
  assert.equal(await run("return document.querySelector('#siteId').disabled;"), true);
  assert.equal(await run("return document.querySelector('#ref').value;"), first.ref);
  for (const width of [1440, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme='${theme}';return true;`); await sleep(100);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"), true, 'Numbered MRF fits '+width+'/'+theme);
      await writeFile(path.join(profile, `numbered-mrf-${width}-${theme}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await role('Administrator'); await navigate('/admin');
  await fill('[aria-label="Search projects"]', 'Numbered project'); await press('Details');
  await wait("return !!document.querySelector('.record-dialog[open] .admin-project-settings');"); await press('Edit project');
  assert.equal(await run("return document.querySelector('.admin-edit-project [aria-label=\"Project code\"]').readOnly;"), true, 'Code locks after the first draft save');
  await click('.record-dialog[open] .record-modal-close');
  await run(`const key='hml-constructsync-users-v1',d=JSON.parse(localStorage.getItem(key));for(const u of d.users.filter(u=>u.role==='Site Personnel'))u.siteIds=[...new Set([...u.siteIds,${JSON.stringify(project.id)}])];localStorage.setItem(key,JSON.stringify(d));return true;`);
  await role('Site Personnel'); await navigate('/requests/new');
  assert.equal(await run("return document.querySelector('#ref').value;"), 'HBR-MRF-0001', 'Different project counter is independent');
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Source MRF PAPER-111', { x: 50, y: 700 });
  const bytes = await pdf.save();
  await run(`const file=new File([Uint8Array.from(atob('${Buffer.from(bytes).toString('base64')}'),c=>c.charCodeAt(0))],'paper-mrf.pdf',{type:'application/pdf'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('[aria-label="Choose MRF extraction sources"]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await wait("return !!document.querySelector('.mrf-ai-sources li');"); await press('Extract with AI');
  await wait("return !!document.querySelector('.mrf-ai-result');"); await press('Apply to form');
  await wait("return document.querySelector('#sourceRef').value==='PAPER-111';");
  assert.equal(await run("return document.querySelector('#siteId').value;"), '');
  await fill('#siteId', project.id);
  assert.equal(await run("return document.querySelector('#ref').value;"), 'HML-X-MRF-0002');
  await press('Save draft'); await wait("return !!document.querySelector('.record-header');");
  assert.equal((await state()).requests.at(-1).sourceRef, 'PAPER-111');
  assert.equal((await state()).requests.at(-1).ref, 'HML-X-MRF-0002');
  await role('Logistics'); await navigate('/deliveries/new?poId=po1');
  await fill('[name=leg]', 'supplier-warehouse');
  assert.equal(await run("return document.querySelector('[name=destinationAddress]').value;"), '155 M. Paterno St., San Juan City');
  await fill('[name=destinationAddress]', 'Custom depot address');
  await fill('[name=leg]', 'supplier-site'); await fill('[name=leg]', 'supplier-warehouse');
  assert.equal(await run("return document.querySelector('[name=destinationAddress]').value;"), 'Custom depot address', 'Switching routes preserves the entered address');
  console.log(`Project numbering smoke passed: code creation/edit/locking, immutable automatic MRF refs, separate source numbers including AI imports, independent project counters, preserved history, warehouse default, route switching and desktop/mobile themes. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
