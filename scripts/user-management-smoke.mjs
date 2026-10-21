import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { blankWorkspace } from "../src/mock/fixtures/blank.ts";

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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}: ${await run("return JSON.stringify({body:document.body.innerText.slice(-1600),role:JSON.parse(localStorage.getItem(\"hml-constructsync-demo-v12\"))?.role});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Administrator');
  await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=blankWorkspace();fixture.role='Administrator';
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__folderCalls=[];window.__folderFailure=false;const originalFetch=window.fetch;window.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/api/drive/projects')){window.__folderCalls.push(JSON.parse(init.body));await new Promise(r=>setTimeout(r,150));return window.__folderFailure?Response.json({error:'Folder permission test failure'},{status:403}):Response.json({id:'automatic-project-folder',name:'Automatic project'});}if(url.endsWith('/api/drive/validate'))return Response.json({id:'manual-project-folder',name:'Manual folder'});return originalFetch(input,init);};`});
  await navigate('/admin');await wait("return [...document.querySelectorAll('.page-header button')].some(b=>b.textContent.trim()==='Add project');");
  const press=async(label,scope='document')=>{await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();return true;`);await sleep(100);};
  const add=async name=>{await press('Add project');await fill('.admin-add-project input[name=name]',name);await fill('.admin-add-project input[name=documentCode]','SMOKE-'+name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12));await fill('.admin-add-project input[name=location]','Pasig');await fill('.admin-add-project input[name=budget]','1,234,567.89');assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'1,234,567.89','Pasted budget retains separators and cents');await fill('.admin-add-project input[name=budget]','1000');await run("const input=document.querySelector('.admin-add-project input[name=budget]');input.focus();input.setSelectionRange(2,2);return true;");await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'0','Backspace beside a comma removes the adjacent digit');await fill('.admin-add-project input[name=budget]','100000');assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'100,000','Budget formats while entering');await run("document.querySelector('.admin-add-project').requestSubmit();document.querySelector('.admin-add-project').requestSubmit();return true;");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return !!document.querySelector('.record-dialog[open]');");};
  const accept=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');};
  const users=async()=>{await navigate('/admin');await press('Users');await wait("return !!document.querySelector('.admin-users');");};
  await users();await press('Add user');
  await fill('.record-dialog[open] input[name=name]','Browser manager');await fill('.record-dialog[open] input[name=email]','browser.manager@example.com');await fill('.record-dialog[open] select[name=role]','Project Manager');await fill('.record-dialog[open] input[name=password]','BrowserPassword123!');await press('Add user',"document.querySelector('.record-dialog[open]')");await accept();
  await wait("return document.querySelector('.admin-users').textContent.includes('Browser manager')&&!document.querySelector('.record-dialog[open]');");
  assert.equal(await run("return localStorage.getItem('hml-constructsync-users-v1').includes('BrowserPassword123!');"),false);
  const row="[...document.querySelectorAll('.admin-users tbody tr')].find(r=>r.textContent.includes('Browser manager'))";
  await press('Reset password',row);await fill('.record-dialog[open] input[name=password]','BrowserReplacement123!');await press('Reset password',"document.querySelector('.record-dialog[open]')");await accept();await wait("return !document.querySelector('.record-dialog[open]');");
  await press('Deactivate',row);await accept();await wait(`return ${row}.textContent.includes('Inactive');`);await press('Reactivate',row);await accept();await wait(`return ${row}.textContent.includes('Active');`);
  for(const theme of ['light','dark'])for(const width of [1440,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(100);
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`Users page fits ${width}/${theme}`);
    await press('Edit',row);await wait("return !!document.querySelector('.record-dialog[open]');");
    assert.equal(await run("const d=document.querySelector('.record-dialog[open]');return d.scrollWidth<=d.clientWidth+1;"),true,`User editor fits ${width}/${theme}`);await click('.record-dialog[open] .record-modal-close');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await click('.masthead-account');await wait("return !!document.querySelector('.role-options');");
  assert.equal(await run("return document.querySelector('.role-options').textContent.includes('Management');"),false);
  await run("[...document.querySelectorAll('.role-options button')].find(b=>b.textContent.includes('Browser manager')).click();return true;");await wait("return location.pathname==='/dashboard'&&JSON.parse(localStorage.getItem('hml-constructsync-session-v2')).email==='browser.manager@example.com'&&document.querySelector('.account-label strong')?.textContent==='Browser manager'&&!document.querySelector('.account-modal[open]');");
  await navigate('/projects');await add('PM-created project');
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0].driveFolderId;"),'automatic-project-folder');
  await press('Project');await press('Edit project');await fill('.record-dialog[open] .admin-edit-project .field:last-child input','125000.50');await press('Save project');await accept();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0].budget===125000.5;");
  await press('Scopes');await fill('select[name=scopeName]','General Requirement');await fill('input[name=scopeBudget]','50000');await press('Save scope allocation');await accept();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).scopes[0]?.budget===50000;");await click('.record-dialog[open] .record-modal-close');
  await navigate('/reports');assert.equal(await run("return document.querySelector('h1').textContent;"),'Operations report');
  await navigate('/admin');assert.equal(await run("return document.querySelector('h1').textContent;"),'Access unavailable');assert.equal(await run("return !!document.querySelector('.admin-users');"),false);
  await navigate('/admin/maintenance');assert.equal(await run("return document.querySelector('h1').textContent;"),'Access unavailable');
  await navigate('/projects');await click('.masthead-account');await press('Sign out');await wait("return !!document.querySelector('#signin-email');");
  await fill('#signin-email','browser.manager@example.com');await fill('#signin-password','BrowserReplacement123!');await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  // Simulate a change persisted by a second tab: the current session must end.
  await run("const key='hml-constructsync-users-v1',data=JSON.parse(localStorage.getItem(key));data.users.find(u=>u.email==='browser.manager@example.com').revision++;localStorage.setItem(key,JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key}));return true;");await wait("return !!document.querySelector('#signin-email');");
  console.log('User management smoke passed: add, reset, deactivate/reactivate, responsive controls in both themes, named presenter switching, PM project/folder/budget/scope controls, Reports, access restrictions, password sign-in and cross-tab invalidation.');
}finally{ws?.close();browser.kill();}
