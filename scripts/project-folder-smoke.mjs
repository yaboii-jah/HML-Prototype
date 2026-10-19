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
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__folderCalls=[];window.__folderFailure=false;const originalFetch=window.fetch;window.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/api/drive/projects')){window.__folderCalls.push(JSON.parse(init.body));await new Promise(r=>setTimeout(r,600));return window.__folderFailure?Response.json({error:'Folder permission test failure'},{status:403}):Response.json({id:'automatic-project-folder',name:'Automatic project'});}if(url.endsWith('/api/drive/validate'))return Response.json({id:'manual-project-folder',name:'Manual folder'});return originalFetch(input,init);};`});
  await navigate('/admin');await wait("return [...document.querySelectorAll('.page-header button')].some(b=>b.textContent.trim()==='Add project');");
  const press=async(label,scope='document')=>{await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();return true;`);await sleep(100);};
  const add=async name=>{await press('Add project');await fill('.admin-add-project input[name=name]',name);await fill('.admin-add-project input[name=documentCode]','SMOKE-'+name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12));await fill('.admin-add-project input[name=location]','Pasig');await fill('.admin-add-project input[name=budget]','1,234,567.89');assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'1,234,567.89','Pasted budget retains separators and cents');await fill('.admin-add-project input[name=budget]','1000');await run("const input=document.querySelector('.admin-add-project input[name=budget]');input.focus();input.setSelectionRange(2,2);return true;");await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'0','Backspace beside a comma removes the adjacent digit');await fill('.admin-add-project input[name=budget]','100000');assert.equal(await run("return document.querySelector('.admin-add-project input[name=budget]').value;"),'100,000','Budget formats while entering');await run("document.querySelector('.admin-add-project').requestSubmit();document.querySelector('.admin-add-project').requestSubmit();return true;");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("const t=document.querySelector('.toast-stack .toast.toast-progress');const s=t?.querySelector('strong')?.textContent||'';return !!t&&!!t.querySelector('.toast-spinner')&&(s.startsWith('Adding project')||s.startsWith('Project saved. Creating the Google Drive project folder'));");assert.equal(await run("return !!document.querySelector('.toast-stack');"),true,'Add project opens a progress notification with an activity spinner in the bottom-right toast stack');await wait("return !!document.querySelector('.record-dialog[open]');");};
  const toastText=()=>run("return [...document.querySelectorAll('.toast')].map(t=>({tone:t.className,title:t.querySelector('strong')?.textContent}));");
  await add('Automatic project');
  assert.ok((await toastText()).some(t=>t.tone.includes('toast-success')&&t.title==='Project added. Google Drive folder ready.'),'Folder-ready project reports success');
  assert.equal(await run("return window.__folderCalls.length;"),1);
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0].driveFolderId;"),'automatic-project-folder');
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0].budget;"),100000,'Formatted budget persists as a number');
  assert.equal(await run("return !!document.querySelector('.drive-folder-form[hidden]');"),true);
  await click('.record-dialog[open] .record-modal-close');
  await run("window.__folderFailure=true;return true;");await add('Pending project');
  assert.equal(await run("const s=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[1];return !s.driveFolderId&&s.driveFolderSetup.error==='Folder permission test failure';"),true);
  assert.ok((await toastText()).some(t=>t.tone.includes('toast-warning')&&t.title==='Project added. Folder setup is pending.'),'Failed folder setup reports a warning, not a success');
  await press('Link an existing folder');await fill('.drive-folder-form input','https://drive.google.com/drive/folders/manual-project-folder');await run("[...document.querySelectorAll('.drive-folder-form')].find(el=>el.checkVisibility()).requestSubmit();return true;");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[1].driveFolderId==='manual-project-folder';");
  await click('.record-dialog[open] .record-modal-close');
  await run("window.__folderFailure=true;return true;");await add('Retry project');
  await run("window.__folderFailure=false;return true;");await press('Retry folder creation');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[2].driveFolderId==='automatic-project-folder';");
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('[aria-label=\"Details for Retry project\"]');");await click('[aria-label="Details for Retry project"]');await wait("return !!document.querySelector('.record-dialog[open]');");await press('Documents');
  assert.equal(await run("const sites=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites;return sites[1].driveFolderId==='manual-project-folder'&&sites[2].driveFolderSetup.status==='ready';"),true,'Folder mappings and setup status survive reload');
  for(const width of [1440,768,375,320]) {await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await sleep(100);assert.equal(await run("const d=document.querySelector('.record-dialog[open]');return d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;"),true,`Project folder controls fit ${width}: ${await run("const d=document.querySelector('.record-dialog[open]');return JSON.stringify({viewport:innerWidth,page:document.documentElement.scrollWidth,modal:d.clientWidth,scroll:d.scrollWidth,children:[...d.children].map(e=>({class:e.className,width:e.clientWidth,scroll:e.scrollWidth}))});")}`);}
  await press('Project');await press('Edit project');
  assert.equal(await run("return document.querySelector('.admin-edit-project .field:last-child input').value;"),'100,000','Existing budget opens formatted');
  await fill('.admin-edit-project .field:last-child input','125000.50');
  assert.equal(await run("return document.querySelector('.admin-edit-project .field:last-child input').value;"),'125,000.50');
  await press('Save project');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[2].budget===125000.5;");
  await press('Scopes');await fill('select[name=scopeName]','Structural Works');await fill('input[name=scopeBudget]','50000.75');
  assert.equal(await run("return [...document.querySelectorAll('input[name=scopeBudget]')].find(el=>el.checkVisibility()).value;"),'50,000.75');
  await press('Save scope allocation');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).scopes[0]?.budget===50000.75;");
  assert.ok((await toastText()).some(t=>t.tone.includes('toast-success')&&t.title==='Scope of work added.'),'Scope allocation reports success');
  assert.equal(await run("return !!document.querySelector('.toast.toast-error');"),false,'A successful scope save raises no error notification');
  await press('Edit allocation');assert.equal(await run("return [...document.querySelectorAll('input[name=scopeBudget]')].find(el=>el.checkVisibility()).value;"),'50,000.75','Existing scope opens formatted');
  const stacking=await run("const s=document.querySelector('.toast-stack');if(!s)return null;const r=s.getBoundingClientRect();return {visible:s.checkVisibility(),right:Math.round(innerWidth-r.right),bottom:Math.round(innerHeight-r.bottom),inside:r.right<=innerWidth+1&&r.left>=0};");
  if(stacking){assert.equal(stacking.visible,true,`Toast stack is visible: ${JSON.stringify(stacking)}`);assert.ok(stacking.right>=16&&stacking.right<=40&&stacking.bottom>=16&&stacking.bottom<=40,`Toast stack sits near the bottom-right corner with 16-40px spacing: ${JSON.stringify(stacking)}`);assert.equal(stacking.inside,true,'Toast stack stays inside the viewport');}
  for(const width of [1440,375,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await sleep(150);const box=await run("const s=document.querySelector('.toast-stack');if(!s)return null;const r=s.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,inside:r.left>=0&&r.right<=innerWidth+1};");if(box)assert.equal(box.inside&&!box.overflow,true,`Toast stack fits ${width}px: ${JSON.stringify(box)}`);}
  await call('Emulation.clearDeviceMetricsOverride');
  console.log('Project folder smoke passed: automatic creation, duplicate clicks, saved failures, manual linking, retry, bottom-right progress/success/warning notifications, and responsive controls.');
}finally{ws?.close();browser.kill();}
