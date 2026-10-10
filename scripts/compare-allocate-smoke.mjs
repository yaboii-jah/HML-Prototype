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
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname+location.search===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=seedDemo(),request=fixture.requests.find(r=>r.id==='m1'),source=fixture.quotes.find(q=>q.id==='q1');fixture.role='Procurement';request.status='approved';request.archive=undefined;request.correction=undefined;fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);fixture.pendingAwards=[];
  request.items=Array.from({length:100},(_,i)=>({...structuredClone(request.items[0]),id:'material-'+i,name:'Material '+String(i+1).padStart(3,'0')+' construction supplies',quantity:10}));
  fixture.quotes=Array.from({length:5},(_,i)=>({...structuredClone(source),id:'supplier-'+i,supplierId:'supplier-'+i,ref:'Q-'+i,currency:'PHP',reviewStatus:'finalized',archive:{status:'complete',files:[]},supplierDetails:{name:'Supplier '+i+' construction materials',address:'Address',tin:'',contactName:'',email:'',phone:''},lines:request.items.map((item,n)=>({id:'offer-'+i+'-'+n,requestItemId:item.id,description:'Supplier offer for '+item.name,quantity:10,unit:item.unit,unitPrice:100+i*10,conversionFactor:1,brand:'',specification:'',varianceReason:'',matchConfirmed:true,discountType:'none',discountValue:0,taxRate:0,printedTotal:null}))}));
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1/quotes?materialId=material-0');await wait("return !!document.querySelector('.allocation-offer-table input');");
  const state=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  const quantity=id=>'[data-allocation-offer="'+id+'"] input';
  assert.equal(await run("return document.querySelectorAll('.procurement-steps button').length;"),3);
  const before=await state();await fill(quantity('offer-0-0'),4);assert.deepEqual(await state(),before,'Typing is temporary');
  await click('[data-allocation-material="material-1"]');await click('[data-allocation-material="material-0"]');assert.equal(await run("return document.querySelector('[data-allocation-offer=offer-0-0] input').value;"),'4','Navigation retains edits');
  await click('[data-allocation-offer="offer-1-0"] .text-link');assert.equal(await run("return document.querySelector('[data-allocation-offer=offer-1-0] input').value;"),'6','Fill remaining accounts for other edits');
  await click('.allocation-material-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.deepEqual(await state(),before,'Cancel saves nothing');
  await click('.allocation-material-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.length===2;");
  await fill(quantity('offer-0-0'),0);await fill(quantity('offer-1-0'),10);await click('.allocation-material-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.length===1;");
  await click('[data-allocation-material="material-1"]');await fill(quantity('offer-0-1'),2);await click('.allocation-footer .button.secondary');await wait("return !!document.querySelector('.record-dialog[open] .allocation-review');");assert.equal(await run("return document.querySelector('.allocation-review .button.primary').disabled;"),true,'Dirty material blocks PO generation');await click('.record-dialog[open] .record-modal-close');await click('.allocation-material-actions .button.secondary');
  for(const width of [1440,1024,768,414,375,320]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});for(const theme of ['light','dark']){
    await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.compare-allocate').scrollIntoView({block:'start'});return true;`);await sleep(100);
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,'Workspace fits '+width+'/'+theme);
    assert.equal(await run("const table=document.querySelector('.allocation-offer-table');table.scrollLeft=100;return table.scrollWidth<=table.clientWidth||table.scrollLeft>0;"),true,'Offers scroll within their frame');
    if(width<=800){const rect=await run("const el=document.querySelector('.allocation-offer-table input'),r=el.getBoundingClientRect(),table=document.querySelector('.allocation-offer-table table');return {left:r.left,right:r.right,viewport:innerWidth,width:table.getBoundingClientRect().width,display:getComputedStyle(table).display,visible:el.checkVisibility()};");assert.equal(rect.visible&&rect.left>=0&&rect.right<=rect.viewport,true,'Mobile award input stays in view: '+JSON.stringify(rect));await click('.allocation-back');assert.equal(await run("return document.querySelector('.allocation-materials').checkVisibility()&&!document.querySelector('.allocation-offers').checkVisibility();"),true,'Mobile materials list');await click('[data-allocation-material="material-1"]');}
    if(width===1440||width===375)await writeFile(path.join(profile,'allocation-'+width+'-'+theme+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }}
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.allocation-offer-table');");assert.equal((await state()).pendingAwards.length,1,'Applied awards survive reload');
  await run("const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));const original=state.quotes.find(q=>q.id==='supplier-1');state.quotes.push({...structuredClone(original),id:'revised',supersedesId:original.id,version:2,lines:original.lines.map(line=>({...line,id:'revised-'+line.id}))});localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(state));return true;");
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('[data-allocation-offer=offer-1-0]');");
  await click('[data-allocation-offer="offer-1-0"] .quote-award-edit button');await click('.allocation-material-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.length===0;");
  await fill(quantity('revised-offer-1-0'),10);await click('.allocation-material-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.length===1;");
  await click('.allocation-footer .button.secondary');await wait("return !!document.querySelector('.record-dialog[open] .allocation-review');");await click('.allocation-review .button.primary');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.some(po=>po.mrfId==='m1');");assert.equal((await state()).pendingAwards.length,0,'Partial PO generation consumes saved awards');
  console.log('Compare and allocate browser smoke passed: 100 materials, 5 suppliers, atomic swaps, confirmations, retained edits, fill remaining, generation guards, persistence and responsive themes. Screenshots: '+profile);
}finally{ws?.close();browser.kill();}
