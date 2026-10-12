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
  const fixture=seedDemo(),request=fixture.requests.find(r=>r.id==='m1'),source=fixture.quotes.find(q=>q.id==='q1');
  fixture.role='Procurement';request.status='approved';request.archive=undefined;request.correction=undefined;fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);fixture.pendingAwards=[];
  request.items=Array.from({length:100},(_,i)=>({...structuredClone(request.items[0]),id:'material-'+i,name:'Material '+String(i+1).padStart(3,'0')+' construction supplies',quantity:10}));
  fixture.quotes=Array.from({length:5},(_,i)=>({...structuredClone(source),id:'supplier-'+i,supplierId:'supplier-'+i,ref:'Q-'+i,currency:'PHP',reviewStatus:'finalized',financial:{vatStatus:'VAT',priceBasis:i===1?'inclusive':'exclusive',vatRate:12,reviewed:true},archive:{status:'complete',files:[]},supplierDetails:{name:'Supplier '+i+' construction materials',address:'Address',tin:'',contactName:'',email:'',phone:''},lines:request.items.map((item,n)=>({id:'offer-'+i+'-'+n,requestItemId:item.id,description:'Supplier offer for '+item.name,quantity:i===2&&n===0?6:10,unit:item.unit,unitPrice:i===1?112:100+i*10,conversionFactor:1,brand:'',specification:'',varianceReason:'',matchConfirmed:true,discountType:'none',discountValue:0,taxRate:0,printedTotal:null})).filter(line=>!(i===2&&line.requestItemId==='material-1'))}));
  const setState=async data=>run("localStorage.setItem('hml-constructsync-demo-v12',"+JSON.stringify(JSON.stringify(data))+");return true;");
  const state=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  const route='/requests/m1/quotes?materialId=material-0';
  await setState(fixture);await navigate(route);await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.equal(await run("return document.querySelectorAll('.comparative-bid-table tbody [data-comparison-material]').length;"),100,'All materials are shown');
  assert.equal(await run("return document.querySelectorAll('.bid-supplier-heading').length;"),5,'Five grouped supplier columns');
  assert.equal(await run("return document.querySelectorAll('[data-comparison-material=material-0] .bid-lowest').length;"),2,'VAT-normalized tied prices');
  const before=await state();
  await click('[data-choose-offer=offer-0-0]');assert.deepEqual(await state(),before,'Choosing is temporary');
  await click('[data-split-material=material-0]');await wait("return !!document.querySelector('.record-dialog[open] .comparison-split');");
  await fill('[data-split-offer=offer-0-0] input',4);await fill('[data-split-offer=offer-1-0] input',6);
  await click('.comparison-split .form-actions .button.primary');await wait("return !document.querySelector('.record-dialog[open] .comparison-split');");
  assert.match(await run("return document.querySelector('[data-comparison-material=material-0] .bid-award-summary').innerText;"),/4.*Supplier 0[\s\S]*6.*Supplier 1/);
  await click('[data-award-supplier=supplier-2]');await wait("return !!document.querySelector('.record-dialog[open] .comparison-bulk');");
  assert.match(await run("return document.querySelector('.comparison-bulk').innerText;"),/Not quoted/);
  await click('.comparison-bulk .form-actions .button.secondary');
  assert.match(await run("return document.querySelector('[data-comparison-material=material-0] .bid-award-summary').innerText;"),/4.*Supplier 0[\s\S]*6.*Supplier 1/,'Cancelled bulk preview preserves choices');
  await click('[data-award-supplier=supplier-2]');await click('.comparison-bulk .form-actions .button.primary');
  assert.deepEqual(await state(),before,'Bulk choices are not saved automatically');
  assert.match(await run("return document.querySelector('[data-comparison-material=material-0] .bid-award-summary').innerText;"),/4.*Supplier 0[\s\S]*6.*Supplier 2/,'Partial supplier retains another supplier for its gap');
  await click('.comparative-bid-toolbar>.button');await wait("return !!document.querySelector('.record-dialog[open] .allocation-review');");
  await click('.record-dialog[open] .record-modal-close');assert.deepEqual(await state(),before,'Closing review saves nothing');
  await click('.comparative-bid-toolbar>.button');await click('.allocation-review .form-actions .button.primary');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.length===100;");
  assert.equal((await state()).pos.filter(po=>po.mrfId==='m1').length,0,'Saving does not create POs');
  await click('.record-dialog[open] .record-modal-close');
  await navigate(route);await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.match(await run("return document.querySelector('[data-comparison-material=material-0] .bid-award-summary').innerText;"),/6.*Supplier 2/,'Saved awards survive refresh');
  await fill('.comparative-bid-toolbar input','Material 002');assert.equal(await run("return document.querySelectorAll('[data-comparison-material]').length;"),1,'Search filters materials');
  await fill('.comparative-bid-toolbar input','');
  for(const width of [1600,1440,1280,1000,768,414,375,320])for(const theme of ['light','dark']){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await run("document.documentElement.dataset.theme="+JSON.stringify(theme)+";return true;");await sleep(120);
    const geometry=await run("const s=document.querySelector('.comparative-bid-scroll'),t=document.querySelector('.comparative-bid-table');return {overflow:document.documentElement.scrollWidth>innerWidth+1,horizontal:s.scrollWidth>s.clientWidth,bar:s.offsetHeight-s.clientHeight,display:getComputedStyle(t).display,first:t.querySelector('tbody th').getBoundingClientRect().width};");
    assert.equal(geometry.overflow,false,'No page overflow at '+width+'/'+theme+': '+JSON.stringify(geometry));
    assert.equal(geometry.horizontal,true,'Table scrolls horizontally at '+width+'/'+theme);
    assert.ok(geometry.bar>=10||await run("return !!document.querySelector('.bid-horizontal-control input[type=range]');"),'Visible horizontal scroll control at '+width+'/'+theme);
    assert.equal(geometry.display,'table','Table does not collapse on mobile');
    await run("const s=document.querySelector('.comparative-bid-scroll');s.scrollLeft=300;s.scrollTop=250;return true;");
    const pinned=await run("const s=document.querySelector('.comparative-bid-scroll'),first=s.querySelector('tbody th');return {left:first.getBoundingClientRect().left,edge:s.getBoundingClientRect().left,header:s.querySelector('thead').getBoundingClientRect().top,top:s.getBoundingClientRect().top};");
    assert.ok(Math.abs(pinned.left-pinned.edge)<3,'Material stays fixed while scrolling');
    assert.ok(Math.abs(pinned.header-pinned.top)<3,'Headers remain fixed vertically');
    await run("const s=document.querySelector('.comparative-bid-scroll');s.scrollLeft=0;s.scrollTop=0;s.scrollIntoView({block:'start'});window.scrollBy(0,-85);return true;");
    if(width===1440||width===375)await writeFile(path.join(profile,'comparative-bid-'+width+'-'+theme+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const saved=await state(),current=saved.quotes[0];saved.quotes.push({...structuredClone(current),id:'revision-0',supersedesId:current.id,version:2,lines:current.lines.map(line=>({...line,id:line.id+'-new'}))});
  await setState(saved);await navigate(route);await wait("return !!document.querySelector('.comparative-bid-table');");
  await click('[data-split-material=material-0]');
  await wait("return !!document.querySelector('[data-split-offer=offer-0-0]');");
  assert.equal(await run("return document.querySelector('[data-split-offer=offer-0-0] input').disabled;"),true,'Stale offer cannot receive new quantities');
  await click('[data-split-offer=offer-0-0]>div:last-child .text-link');
  await click('.comparison-split .form-actions .button.primary');await click('.comparative-bid-toolbar>.button');await click('.allocation-review .form-actions .button.primary');
  await wait("return !JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.some(a=>a.quoteId==='supplier-0');");
  await click('.allocation-review .form-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal((await state()).pos.filter(po=>po.mrfId==='m1').length,0,'Cancelled PO generation changes nothing');
  await click('.allocation-review .form-actions .button.primary');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.some(po=>po.mrfId==='m1');");
  assert.equal((await state()).pendingAwards.length,0,'Explicit PO generation consumes saved awards');
  console.log('Comparative bid browser smoke passed: 100 materials, 5 suppliers, normalized prices, splits, bulk gaps/cancellation, atomic save, stale removal, persistence, PO confirmation and responsive light/dark layouts. Screenshots: '+profile);
}finally{ws?.close();browser.kill();}
