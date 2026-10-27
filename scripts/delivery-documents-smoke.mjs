import { syntheticPdf } from "./helpers/synthetic-documents.mjs";
import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../tests/fixtures/workspace.ts";

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
  const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}: ${await run("return JSON.stringify({body:document.body.innerText.slice(-1600),role:JSON.parse(localStorage.getItem(\"hml-constructsync-demo-v12\"))?.role});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const press = async (text, scope = 'document') => { await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click();return true;`); await sleep(100); };
  const signin = async role => { const account=ACCOUNT_FIXTURES.find(a=>a.role===role); await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');"); };
  const role = async name => { await click('.masthead-account');await wait("return !!document.querySelector('.account-modal[open]');");await press('Sign out',"document.querySelector('.account-modal')");await wait("return !!document.querySelector('#signin-email');");await signin(name); };
  const confirmed = async () => { await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child'); };
  const receiptPath = path.join(profile, "synthetic-receipt.pdf");
  await writeFile(receiptPath, await syntheticPdf(["Synthetic test receipt", "Payment reference: TEST-001", "Amount: PHP 2500.00"]));
  const upload = async () => { const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[aria-label="Upload accounting documents"]'});assert.ok(nodeId);await call('DOM.setFileInputFiles',{nodeId,files:[receiptPath]}); };
  const saved = "JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'))";
  await signin('Site Personnel');
  const fixture=seedDemo(),po=fixture.pos.find(p=>p.id==='po1'),request=fixture.requests.find(r=>r.id===po.mrfId);
  fixture.role='Site Personnel';fixture.movements=[];fixture.accounting=[];fixture.batches=[{id:'delivery-smoke',ref:'DEL-SMOKE',poId:po.id,leg:'supplier-site',origin:{name:'Demo Supplier',address:'Demo supplier address'},destination:{name:'Demo Site',address:'Demo site address'},status:'dispatched',scheduledDate:'2026-10-09',evidence:'DR-SMOKE',delayReason:'',createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z',lines:[{itemId:request.items[0].id,expected:10,accepted:0,issue:''}]}];
  fixture.sites.find(s=>s.id===request.siteId).driveFolderId='mock-project-folder';
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});localStorage.setItem('delivery-smoke-fail','true');return true;`);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`const original=window.fetch;window.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/api/drive/delivery-receipts')){const {receipt}=JSON.parse(init.body);if(localStorage.getItem('delivery-smoke-fail')==='true')return Response.json({error:'Simulated Drive outage'},{status:502});return Response.json({driveFileId:'receipt-'+receipt.id,url:'https://drive.google.com/file/d/receipt-'+receipt.id+'/view'});}if(url.endsWith('/api/drive/accounting-documents')){const {document}=JSON.parse(init.body);return Response.json({driveFileId:'doc-'+document.id,url:'https://drive.google.com/file/d/doc-'+document.id+'/view'});}if(url.includes('/api/drive/'))throw Error('Unexpected live Drive request');return original(input,init);};`});
  await navigate('/deliveries/delivery-smoke');
  await wait("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirm received quantities');");
  await press('Confirm received quantities');await confirmed();
  await wait(`return ${saved}.batches[0].receiptVersions?.[0]?.archive.error;`);
  assert.equal(await run(`return ${saved}.batches[0].status;`),'confirmed');
  await fill('input[name^="post-"]',9);await fill('input[name="reason"]','One unit damaged on inspection');
  await press('Post to site stock');await confirmed();await wait(`return ${saved}.batches[0].receiptVersions.length===2;`);
  await wait(`return ${saved}.batches[0].receiptVersions[1].archive.error;`);
  assert.equal(await run(`return ${saved}.movements[0].quantity;`),9);
  await run("localStorage.setItem('delivery-smoke-fail','false');return true;");
  await press('Retry archive',"document.querySelector('.generated-delivery-receipt')");
  await wait(`return ${saved}.batches[0].receiptVersions.every(r=>r.archive.status==='complete');`);
  await upload();await wait(`return ${saved}.accounting[0]?.documents?.[0]?.archive.status==='complete';`);
  assert.equal(await run(`return ${saved}.accounting[0].documents[0].kind;`),'Signed delivery receipt');
  assert.equal(await run(`return ${saved}.accounting[0].documents[0].receiptVersion;`),2);
  await role('Accounting');await navigate('/accounting/po1');await wait("return !!document.querySelector('input[name=invoice]');");
  await fill('input[name="invoice"]','INV-SMOKE');await fill('input[name="receipt"]','SIGNED-DR-SMOKE');await fill('select[name="review"]','Complete');await press('Save document review');await confirmed();
  await wait(`return ${saved}.accounting[0].review==='Complete';`);
  // Accounting can supply a missing invoice without associating it with a delivery.
  await upload();await wait(`return ${saved}.accounting[0].documents.length===2&&${saved}.accounting[0].documents[1].archive.status==='complete';`);
  assert.equal(await run(`return ${saved}.accounting[0].documents[1].batchId;`),undefined);
  assert.equal(await run(`return ${saved}.accounting[0].review;`),'Under Review');
  assert.equal(await run(`return ${saved}.accounting[0].reviewHistory[0].review;`),'Complete');
  for (const theme of ['light','dark']) for(const width of [320,375,414,768,1440]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800});
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(100);
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`${theme} layout fits ${width}px`);
    assert.equal(await run("const panel=document.querySelector('.accounting-evidence');return panel.scrollWidth<=panel.clientWidth+1;"),true,`Document panel fits ${width}px`);
  }
  console.log('Delivery documents browser checks passed: saved confirmation despite archive failure, corrected version, retry, signed site evidence, Accounting PO invoice, review reopening, mobile/desktop themes. Drive calls were mocked.');
} finally { ws?.close(); browser.kill(); }
