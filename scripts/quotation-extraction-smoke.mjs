import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import { openQuotationReview } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-extraction-dialog-"));
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
  const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}\n${JSON.stringify(await run("return {url:location.href,text:document.body.innerText.slice(-1800),role:JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')||'null')?.role};"))}`); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Procurement");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");


  const fixture=seedDemo();fixture.role='Procurement';fixture.requests.find(r=>r.id==='m1').archive=undefined;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Page.navigate',{url:base+'/requests/m1/quotes'});await wait("return !!document.querySelector('.procurement-steps');");await run(openQuotationReview);await sleep(160);
  await wait("return !!document.querySelector('.supplier-upload-section');");
  const mock=()=>run("window.__quoteRequests=[];window.__originalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/quotes/extract'?new Promise(resolve=>window.__quoteRequests.push(resolve)):window.__originalFetch(url,options);return true;");
  await mock();
  const add=async name=>{
    await click('.supplier-upload-section .panel-heading button:first-child');
    await run(`const input=document.querySelector('.quote-group-drop input');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify("%PDF-1.4\nSample quotation")}],${JSON.stringify(name)},{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;`);await sleep(150);
  };
  await add('Supplier One.pdf');await add('Supplier Two.pdf');
  await click('.quote-queue-footer button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait("return !!document.querySelector('.quotation-extraction-dialog[open]')&&window.__quoteRequests.length===1;");
  assert.equal(await run("return !!document.querySelector('.supplier-upload-section .qa-extraction-progress');"),false,'Extraction progress is not inline');
  assert.equal(await run("return document.querySelector('.quotation-extraction-dialog').textContent.includes('Supplier group 1 of 2');"),true);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(100);
  assert.equal(await run("return document.querySelector('.quotation-extraction-dialog').open;"),true,'Escape does not hide an active extraction');
  for(const width of [1440,375]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await run("const r=document.querySelector('.quotation-extraction-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;"),true,`Progress dialog fits ${width}`);
    await writeFile(path.join(profile,`extraction-${width}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await run("window.__quoteRequests[0](new Response(JSON.stringify({error:'Sample unreadable quotation'}),{status:422,headers:{'Content-Type':'application/json'}}));return true;");
  await wait("return window.__quoteRequests.length===2;");
  assert.equal(await run("return document.querySelector('.quotation-extraction-dialog').textContent.includes('Supplier group 2 of 2')&&document.querySelector('.quotation-extraction-dialog').textContent.includes('1 failed');"),true,'Batch progress advances after a failed group');
  const extraction={supplier:'Sample Supplier',reference:'Q-DIALOG',currency:'PHP',lines:[{description:'Portland cement',requestedMaterialId:'m1-i1',quantity:100,unit:'bag',unitPrice:100,conversionFactor:1}]};
  await run(`window.__quoteRequests[1](new Response(JSON.stringify({extraction:${JSON.stringify(extraction)}}),{status:200,headers:{'Content-Type':'application/json'}}));return true;`);
  await wait("return !document.querySelector('.quotation-extraction-dialog').open&&!!document.querySelector('.quote-review');");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.some(q=>q.ref==='Q-DIALOG');"),true,'Successful extraction creates a draft');
  assert.equal(await run("return !!document.querySelector('.supplier-upload-queue .badge.bad');"),true,'Failed group retains its retry status');
  await call('Emulation.clearDeviceMetricsOverride');
  await run("const data=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));const quote=data.quotes.find(q=>q.ref==='Q-DIALOG');quote.reviewStatus='finalized';quote.financial.reviewed=true;quote.lines.forEach(line=>line.matchConfirmed=true);localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(data));return true;");
  await call('Page.navigate',{url:base+'/requests/m1/quotes'});await wait("return !!document.querySelector('.procurement-steps');");await run(openQuotationReview);await sleep(160);await wait("return !!document.querySelector('.quote-review');");await mock();
  await run("const tab=[...document.querySelectorAll('[role=tab]')].find(button=>button.textContent.includes('Sample Supplier'));if(!tab)throw Error('Missing extracted supplier tab');tab.click();return true;");await sleep(150);
  await run("const button=[...document.querySelectorAll('.quote-review button')].find(b=>b.textContent==='Reanalyze');if(!button)throw Error('Missing Reanalyze');button.focus();button.click();return true;");
  await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait("return !!document.querySelector('.quotation-extraction-dialog[open]')&&window.__quoteRequests.length===1;");
  assert.equal(await run("return document.querySelector('.quotation-extraction-dialog').textContent.includes('Reading supplier quotation');"),true,'Single reanalysis uses the same dialog');
  await run("window.__quoteRequests[0](new Response(JSON.stringify({error:'Sample reanalysis failure'}),{status:422,headers:{'Content-Type':'application/json'}}));return true;");
  await wait("return !document.querySelector('.quotation-extraction-dialog').open;");
  assert.equal(await run("return document.body.textContent.includes('Sample reanalysis failure');"),true,'Failure closes the dialog and shows its error');
  console.log(`Quotation extraction dialog smoke passed: no inline progress, sequential batch status, success/failure cleanup, Escape handling, responsive layout and single reanalysis. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
