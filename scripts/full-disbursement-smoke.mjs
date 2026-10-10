import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { initializePoDocument } from "../src/domain/po-document.ts";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

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
  const wait = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}: ${await run("return JSON.stringify({body:document.body.innerText.slice(-1600),role:JSON.parse(localStorage.getItem(\"hml-constructsync-demo-v12\"))?.role});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');
  await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=seedDemo(),po=fixture.pos[0],request=fixture.requests.find(value=>value.id===po.mrfId),quote=fixture.quotes.find(value=>value.id===po.quoteId),project=fixture.sites.find(value=>value.id===request.siteId);
  project.driveFolderId='browser-project-folder';
  fixture.role='Procurement';fixture.pos=[po];fixture.paymentRequests=[];fixture.payments=[];fixture.batches=[];fixture.movements=[];fixture.accounting=[];
  request.workflow='pm-external-v1';request.status='approved';request.archive={status:'complete',approvedAt:'2026-10-09T00:00:00Z',versions:[]};
  initializePoDocument(po,request,quote,project,'2026-10-09T00:00:00Z');po.status='approved';po.paymentMode='upfront';po.financial.reviewed=true;po.archive={status:'complete',fileId:'po-drive',url:'https://drive.google.com/file/d/po-drive/view'};
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__proofCalls=0;window.__mrfArchiveCalls=0;window.__proofFail=false;const originalFetch=window.fetch;window.fetch=async(input,init)=>{if(String(input).endsWith('/api/drive/archive')){window.__mrfArchiveCalls++;return Response.json({formFileId:'pm-form',supportFileId:'pm-support',formUrl:'https://drive.google.com/file/d/pm-form/view',supportUrl:'https://drive.google.com/file/d/pm-support/view'});}if(String(input).endsWith('/api/drive/payment-proof')){window.__proofCalls++;return window.__proofFail?Response.json({error:'Test archive unavailable'},{status:502}):Response.json({driveFileId:'proof-test-1',url:'https://drive.google.com/file/d/proof-test-1/view'});}return originalFetch(input,init);};`});
  const press=async(label,scope='document')=>{await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();return true;`);await sleep(100);};
  const confirmed=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');};
  const saved=`JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'))`;
  await navigate(`/purchase-orders/${po.id}`);await wait("return !![...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm supplier issuance');");
  await press('Confirm supplier issuance');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');
  assert.equal(await run(`return !!${saved}.pos[0].issuance;`),false);
  await press('Confirm supplier issuance');await confirmed();await wait(`return !!${saved}.pos[0].issuance;`);
  const accounting=ACCOUNT_FIXTURES.find(a=>a.role==='Accounting / Auditing');
  await run(`localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:accounting.email,role:accounting.role}))});return true;`);
  await navigate(`/accounting/${po.id}`);await wait("return !!document.querySelector('.external-payment-panel');");
  assert.equal(await run("return [...document.querySelectorAll('.external-payment-panel button')].find(b=>b.textContent==='Confirm full payment').disabled;"),true);
  await run(`window.__proofFail=true;const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4 payment proof for browser smoke'],'Bank transaction proof.pdf',{type:'application/pdf'}));const el=document.querySelector('.qa-file-upload input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await wait(`return !!${saved}.pos[0].paymentProofs?.[0]?.archive.error;`);
  assert.equal(await run("return [...document.querySelectorAll('.external-payment-panel button')].find(b=>b.textContent==='Confirm full payment').disabled;"),true);
  await run('window.__proofFail=false;return true;');await press('Retry archive');await wait(`return ${saved}.pos[0].paymentProofs[0].archive.status==='complete';`);
  await fill('.external-payment-panel select[name=method]','Bank');await fill('.external-payment-panel input[name=reference]','BANK-BROWSER-001');
  await press('Confirm full payment');await confirmed();await wait(`return !!${saved}.pos[0].externalPayment;`);
  assert.equal(await run(`return ${saved}.pos[0].status;`),'approved');
  assert.equal(await run(`return ${saved}.payments.length;`),0);
  for(const theme of ['light','dark'])for(const width of [1440,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(120);
    assert.equal(await run("const p=document.querySelector('.external-payment-panel');return document.documentElement.scrollWidth<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1;"),true,`Payment panel fits ${theme}/${width}: ${await run("return JSON.stringify({viewport:innerWidth,page:document.documentElement.scrollWidth,panel:document.querySelector('.external-payment-panel').clientWidth,scroll:document.querySelector('.external-payment-panel').scrollWidth});")}`);
    assert.equal(await run("return [...document.querySelectorAll('.external-payment-panel button')].every(b=>!b.checkVisibility()||getComputedStyle(b).whiteSpace==='nowrap');"),true,`Buttons stay on one line ${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await run("document.documentElement.dataset.theme='light';document.querySelector('.external-payment-panel').scrollIntoView();return true;");
  const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(profile,'payment-verification.png'),Buffer.from(shot.data,'base64'));
  await press('Reopen verification');await fill('.external-payment-panel textarea[name=reason]','Correct transaction reference');await press('Continue to confirmation');await confirmed();await wait(`return !${saved}.pos[0].externalPayment;`);
  assert.equal(await run(`return ${saved}.pos[0].verificationHistory.length;`),1);
  await fill('.external-payment-panel select[name=method]','Bank');await fill('.external-payment-panel input[name=reference]','BANK-CORRECTED-002');
  await press('Confirm full payment');await confirmed();await wait(`return !!${saved}.pos[0].externalPayment;`);
  await press('Confirm delivery clearance');await confirmed();await wait(`return ${saved}.pos[0].status==='released';`);
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.external-payment-panel');");
  assert.equal(await run("return document.querySelector('.external-payment-panel').textContent.includes('Delivery cleared');"),true);
  assert.equal(await run("return [...document.querySelectorAll('.external-payment-panel button')].some(b=>b.textContent==='Reopen verification');"),false);
  const pmFixture=structuredClone(fixture);pmFixture.pos=[];pmFixture.quotes=[];pmFixture.requests=[structuredClone(request)];pmFixture.requests[0].status='submitted';pmFixture.requests[0].archive=undefined;pmFixture.requests[0].documents=[{name:'Signed supporting.pdf',type:'Supporting PDF',fileId:'pm-support-local'}];
  const pdf=await PDFDocument.create();pdf.addPage([612,792]);const bytes=Array.from(await pdf.save());
  const cached=await call('Runtime.evaluate',{expression:`(async()=>{await new Promise((resolve,reject)=>{const open=indexedDB.open('hml-quotation-files',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob([new Uint8Array(${JSON.stringify(bytes)})],{type:'application/pdf'}),'pm-support-local');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});return true;})()`,awaitPromise:true,returnByValue:true});assert.equal(cached.exceptionDetails,undefined);
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(pmFixture))});localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:account.email,role:account.role}))});return true;`);
  await navigate(`/requests/${request.id}`);
  assert.equal(await run("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Approve request');"),false,'Procurement cannot review a revised MRF');
  const pm=ACCOUNT_FIXTURES.find(a=>a.role==='Project Manager');await run(`localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:pm.email,role:pm.role}))});return true;`);
  await navigate(`/requests/${request.id}`);await wait("return document.body.textContent.includes('Project Manager decision');");
  await press('Approve request');await confirmed();await wait(`return ${saved}.requests[0].archive?.status==='complete';`);
  assert.equal(await run('return window.__mrfArchiveCalls;'),1,'PM approval automatically starts archive');
  assert.equal(await run(`return ${saved}.activity[0].actor;`),'Project Manager');
  console.log('Full disbursement smoke passed: PM review and automatic MRF archive, issuance cancellation/confirmation, proof failure/retry, verification, reopening, separate clearance, persistence and responsive light/dark controls. Screenshot: '+path.join(profile,'payment-verification.png'));
}finally{ws?.close();browser.kill();}
