import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import { openQuotationReview } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

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
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  const file1=path.join(profile,'Supplier01.pdf'),file50a=path.join(profile,'Supplier50-A-very-long-quotation-filename-with-source-pages-and-project-reference.pdf'),file50b=path.join(profile,'Supplier50-B.pdf');
  await Promise.all([file1,file50a,file50b].map(file=>writeFile(file,'%PDF-1.4\nSupplier workbench smoke')));
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=seedDemo();fixture.role='Procurement';const request=fixture.requests.find(r=>r.id==='m1');request.status='approved';request.archive=undefined;request.correction=undefined;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate('/requests/m1/quotes');await run(openQuotationReview);await sleep(160);
  const before=await run("return localStorage.getItem('hml-constructsync-demo-v12');");
  const add=async()=>click('.supplier-upload-section .panel-heading .button-row button:first-child');
  for(let i=1;i<=50;i++){
    await add();
    if([1,10,25,50].includes(i)){
      assert.equal(await run("return document.querySelectorAll('.supplier-queue-row').length;"),i % 10 || 10,'Queue shows the last page containing the new supplier');
      assert.equal(await run("return document.querySelector('.quote-group-heading h3').textContent;"),`Supplier quotation ${i}`,'New group is selected and visible');
      assert.equal(await run("const r=document.querySelector('.supplier-upload-workbench').getBoundingClientRect();return r.height<=561;"),true,'Many suppliers never grow the workbench');
      assert.equal(await run("const box=document.querySelector('.supplier-upload-file-empty').getBoundingClientRect(),text=document.querySelector('.supplier-upload-file-empty p').getBoundingClientRect();return Math.abs((text.left+text.right)/2-(box.left+box.right)/2)<2&&Math.abs((text.top+text.bottom)/2-(box.top+box.bottom)/2)<2;"),true,'Exact empty-file message is centered horizontally and vertically');
    }
  }
  assert.equal(await run("return document.querySelector('.supplier-queue-pagination>span').textContent;"),'41–50 of 50');
  assert.equal(await run("return document.querySelector('.supplier-queue-row .badge').textContent;"),'Needs files');
  const upload=async(files)=>{const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.supplier-upload-detail input[type=file]'});assert.ok(nodeId);await call('DOM.setFileInputFiles',{nodeId,files});await sleep(120);};
  await upload([file50a,file50b]);
  const names=()=>run("return [...document.querySelectorAll('.supplier-upload-file-name strong')].map(el=>el.title);");
  assert.deepEqual(await names(),[path.basename(file50a),path.basename(file50b)]);
  await fill('[aria-label="Search supplier quotation groups"]','Supplier quotation 1');await sleep(100);
  await run("[...document.querySelectorAll('.supplier-queue-row')].find(b=>b.querySelector('strong').textContent==='Supplier quotation 1').click();return true;");await sleep(100);await upload([file1]);
  await fill('[aria-label="Search supplier quotation groups"]','Supplier50');await sleep(100);
  assert.equal(await run("return document.querySelectorAll('.supplier-queue-row').length;"),1);
  assert.deepEqual(await names(),[path.basename(file50a),path.basename(file50b)],'Switching/search preserves each supplier file group');
  assert.equal(await run("return document.querySelector('.quote-queue-footer .button.primary').textContent;"),'Extract all ready groups (2)','Filtered queue does not change extraction scope');
  await click('.quote-queue-footer .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  assert.equal(await run("return document.querySelector('.confirm-dialog[open] p').textContent.includes('2 supplier groups containing 3 files');"),true);
  await click('.confirm-dialog[open] .confirm-actions button:first-child');await sleep(100);
  await fill('[aria-label="Filter upload group status"]','empty');await sleep(100);assert.equal(await run("return document.querySelector('.supplier-queue-pagination>span').textContent;"),'0–0 of 0','Combined filters show a clear empty result');
  await fill('[aria-label="Search supplier quotation groups"]','');await fill('[aria-label="Filter upload group status"]','all');await fill('[aria-label="Supplier groups per page"]','25');await sleep(100);
  assert.equal(await run("return document.querySelectorAll('.supplier-queue-row').length;"),25);
  assert.equal(await run("const list=document.querySelector('.supplier-queue-list');return list.scrollHeight>list.clientHeight;"),true,'Long queue scrolls internally');
  for(const width of [1440,1024,1000,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=1000});await sleep(100);
    if(width<=1000&&await run("return document.querySelector('.supplier-upload-back').checkVisibility();"))await click('.supplier-upload-back');
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.supplier-upload-section').scrollIntoView({block:'start'});return true;`);await sleep(100);
      assert.equal(await run("const r=document.querySelector('.supplier-upload-workbench').getBoundingClientRect();return r.height<=561&&document.documentElement.scrollWidth<=innerWidth+1;"),true,`Bounded queue fits ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`supplier-queue-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await fill('[aria-label="Search supplier quotation groups"]','Supplier50');await sleep(100);await click('.supplier-queue-row');
      assert.deepEqual(await names(),[path.basename(file50a),path.basename(file50b)]);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`Selected file panel fits ${width}/${theme}`);
      assert.equal(await run("const list=document.querySelector('.supplier-upload-files');return list.scrollWidth<=list.clientWidth+1;"),true,`File actions never require horizontal scrolling at ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`supplier-detail-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      if(width<=1000)await click('.supplier-upload-back');
      await fill('[aria-label="Search supplier quotation groups"]','');await sleep(100);
    }
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await fill('[aria-label="Search supplier quotation groups"]','Supplier50');await sleep(100);
  await run("window.__extractFiles=[];const realFetch=window.fetch;window.fetch=(input,init)=>{if(String(input)==='/api/quotes/extract'){window.__extractFiles.push(init.body.getAll('files').map(file=>file.name));return Promise.resolve(new Response(JSON.stringify({error:'Simulated extraction error'}),{status:503,headers:{'Content-Type':'application/json'}}));}return realFetch(input,init);};return true;");
  await click('.quote-queue-footer .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return window.__extractFiles.length===2&&!document.querySelector('fieldset.quotation-operation-fields').disabled;");
  assert.deepEqual(await run("return window.__extractFiles;"),[[path.basename(file1)],[path.basename(file50a),path.basename(file50b)]],'AI batch includes each ready supplier once across all queue pages');
  await fill('[aria-label="Filter upload group status"]','failed');await sleep(100);assert.equal(await run("return document.querySelectorAll('.supplier-queue-row').length;"),1,'Failed filter retains matching supplier');
  await click(`[aria-label="Move ${path.basename(file50b)} earlier"]`);
  assert.deepEqual(await names(),[path.basename(file50b),path.basename(file50a)],'Reorder targets selected supplier only');
  await click(`[aria-label="Remove ${path.basename(file50b)}"]`);await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');await sleep(100);assert.equal((await names()).length,2,'Cancel preserves queued files');
  await click(`[aria-label="Remove ${path.basename(file50b)}"]`);await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(100);assert.deepEqual(await names(),[path.basename(file50a)]);
  await click('.quote-group-actions button');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(100);
  await fill('[aria-label="Filter upload group status"]','all');await fill('[aria-label="Search supplier quotation groups"]','Supplier01');await sleep(100);assert.deepEqual(await names(),[path.basename(file1)],'Removing selected group preserves other suppliers');
  assert.equal(await run("return localStorage.getItem('hml-constructsync-demo-v12');"),before,'Queue management and failed extraction change no saved quotations');
  console.log(`Supplier upload workbench smoke passed. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
