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
  const wait = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=seedDemo(),request=fixture.requests.find(r=>r.id==='m1'),source=fixture.quotes.find(q=>q.id==='q1');fixture.role='Procurement';request.status='approved';request.archive=undefined;request.correction=undefined;fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);fixture.quotes=fixture.quotes.filter(q=>q.mrfId!==request.id);
  const makeLine=(quoteId,index)=>({id:`${quoteId}-line-${index+1}`,description:`Offered material ${index+1}`,quantity:20,unit:request.items[0].unit,unitPrice:50,brand:'',specification:'',requestItemId:request.items[0].id,conversionFactor:1,varianceReason:'',matchConfirmed:true,matchConfidence:'high',discountType:'none',discountValue:0,taxRate:0,printedTotal:null});
  for(let i=0;i<25;i++){const id=`sheet-${i}`;const lineCount=i===0?100:i===1?25:i===2?10:1;fixture.quotes.push({...structuredClone(source),id,ref:`QUOTE-${i}`,currency:i===0?'':'PHP',reviewStatus:i<2?'draft':'finalized',reviewedAt:i<2?undefined:'2026-10-08T00:00:00Z',supplierDetails:{name:`Supplier ${String(i).padStart(2,'0')} Industrial Materials Corporation`,address:'Project Avenue',tin:'123',contactName:'Supplier contact',email:'supplier@example.com',phone:'09123456789'},lines:Array.from({length:lineCount},(_,n)=>makeLine(id,n)),documents:[{name:`Supplier ${i} source quotation.pdf`,type:'application/pdf',fileId:'sheet-source-file'}],adjustments:[],archive:i<2?undefined:{status:'complete',files:[]}});}
  fixture.quotes.find(q=>q.id==='sheet-0').lines[60].quantity=0;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate('/requests/m1/quotes');
  const state=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));"),sheet=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='sheet-0');");
  const fillAny=async(selector,value)=>run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing field '+${JSON.stringify(selector)});const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const visible=async()=>{await wait("return !!document.querySelector('.quote-review');");assert.equal(await run("return document.querySelector('.quote-review').dataset.quotationId;"),'sheet-0');};await visible();
  assert.equal(await run("return document.querySelectorAll('[role=tab]').length;"),25);
  assert.equal(await run("return !!document.querySelector('.quotation-summary-table');"),false,'Old queue table is replaced');
  assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),10);
  assert.equal(await run("return [...document.querySelectorAll('.quote-review button')].find(b=>b.textContent==='Finalize quotation').disabled;"),true,'Off-page invalid material blocks finalization');
  await click('.quote-review-trigger');
  await wait("return document.querySelector('.quote-editor-issues').matches(':popover-open');");
  assert.equal(await run("return document.querySelector('.quote-review-trigger').textContent;"),'1 review item');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait("return !document.querySelector('.quote-editor-issues').matches(':popover-open');");
  assert.equal(await run("return document.activeElement.classList.contains('quote-review-trigger');"),true,'Escape restores review-count focus');
  await click('.quote-review-trigger');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:4,y:4,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:4,y:4,button:'left',clickCount:1});
  await wait("return !document.querySelector('.quote-editor-issues').matches(':popover-open');");
  await click('.quote-review-trigger');
  await run("[...document.querySelectorAll('.quote-editor-issues button')].find(b=>b.textContent.includes('Line 61:')).click();return true;");await sleep(100);
  assert.equal(await run("return !document.querySelector('.quote-editor-issues').matches(':popover-open');"),true,'Issue navigation closes the popover');
  assert.equal(await run("return document.querySelector('.quote-editor-lines tbody tr').dataset.lineId;"),'sheet-0-line-61');
  assert.equal(await run("return document.activeElement.id;"),'quote-sheet-0-sheet-0-line-61-quantity','Issue link reveals and focuses the correct material page');
  await fillAny('#quote-sheet-0-sheet-0-line-61-quantity','20');await sleep(100);assert.equal(await run("return document.querySelectorAll('input[id$=currency]').length;"),0,'Currency is not editable');
  assert.equal(await run("return [...document.querySelectorAll('.quote-review button')].find(b=>b.textContent==='Finalize quotation').disabled;"),false,'Full quotation validation updates after correcting hidden-page errors');
  assert.equal(await run("return !document.querySelector('.quote-review-trigger');"),true,'Resolved quotations have no review-count button');
  await fillAny('[aria-label="Search materials in QUOTE-0"]','Offered material 20');await sleep(100);
  assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),1);
  await click('[aria-label="Details for line 20"]');await wait("return !!document.querySelector('.record-dialog[open] .quote-material-details');");
  await fillAny('#quote-sheet-0-sheet-0-line-20-discountType','percentage');await sleep(80);await fillAny('#quote-sheet-0-sheet-0-line-20-discountValue','10');await sleep(80);await fillAny('#quote-sheet-0-sheet-0-line-20-printedTotal','800');await sleep(80);await fillAny('#quote-sheet-0-sheet-0-line-20-discrepancyReason','Supplier total verified against source');await sleep(80);
  const detail=(await sheet()).lines[19];assert.equal(detail.discountValue,10);assert.equal(detail.printedTotal,800);assert.equal(detail.discrepancyReason,'Supplier total verified against source','Discrepancy explanations save instead of being overwritten');
  await click('.record-dialog[open] .record-modal-close');assert.equal(await run("return document.activeElement.getAttribute('aria-label');"),'Details for line 20');
  await click('[data-quote-id="sheet-1"]');assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),10);
  await click('[data-quote-id="sheet-0"]');assert.equal((await sheet()).lines[19].discrepancyReason,'Supplier total verified against source');
  await click('.quotation-navigation-actions>.button');await wait("return !!document.querySelector('.record-dialog[open] .quotation-picker');");await fillAny('[aria-label="Search quotations"]','QUOTE-24');await sleep(80);assert.equal(await run("return document.querySelectorAll('.quotation-picker-list>button').length;"),1);await click('.quotation-picker-list>button');
  assert.equal(await run("return document.querySelector('.quote-review').dataset.quotationId;"),'sheet-24');assert.equal(await run("return document.querySelector('.quote-review').classList.contains('is-readonly');"),true);
  assert.equal(await run("return !document.querySelector('.quote-review [data-add-line]')&&[...document.querySelectorAll('.quote-editor-lines input,.quote-editor-lines textarea,.quote-editor-lines select')].every(el=>el.matches(':disabled'));"),true,'Finalized quotations have no editable fields');
  const beforeReadonly=await state();await fillAny('#quote-sheet-24-ref','SHOULD-NOT-SAVE');await sleep(80);assert.deepEqual(await state(),beforeReadonly,'Read-only edits cannot alter records');
  await click('[data-quote-id="sheet-0"]');await click('.quotation-view-modes button:last-child');assert.equal(await run("return document.querySelectorAll('.quote-review').length;"),25,'All quotations view is opt-in');assert.equal(await run("return [...document.querySelectorAll('.quote-review>details')].filter(d=>d.querySelector('summary strong')?.textContent==='Supplier and quotation details').every(d=>!d.open);"),true,'Supplier fields collapse in All quotations mode');await click('.quotation-view-modes button:first-child');
  await fillAny('[aria-label="Materials per page for sheet-0"]','25');await sleep(100);assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),25);
  await fillAny('[aria-label="Search materials in QUOTE-0"]','material 20');await sleep(80);await click('[aria-label="Details for line 20"]');await fillAny('#quote-sheet-0-sheet-0-line-20-printedTotal','700');await sleep(80);assert.equal((await sheet()).lines[19].discrepancyReason,'','Price edits clear outdated explanations');await fillAny('#quote-sheet-0-sheet-0-line-20-discrepancyReason','Reviewed revised supplier total');await sleep(80);await click('.record-dialog[open] .record-modal-close');
  await fillAny('[aria-label="Search materials in QUOTE-0"]','');await sleep(80);await click('[data-add-line]');await sleep(150);const added=(await sheet()).lines.at(-1);
  assert.equal(await run("return document.activeElement.id;"),`quote-sheet-0-${added.id}-description`,'Add line jumps to the new material and focuses its name');
  await fillAny('[aria-label="Filter material review in QUOTE-0"]','review');await sleep(80);assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),1);
  const beforeDelete=JSON.stringify(await sheet());await click('.quote-line-actions .text-link');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal(JSON.stringify(await sheet()),beforeDelete,'Cancel keeps the material intact');await click('.quote-line-actions .text-link');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(100);assert.equal((await sheet()).lines.length,100);
  await fillAny('[aria-label="Filter material review in QUOTE-0"]','all');await sleep(100);await click('[aria-label="Next material page for sheet-0"]');assert.equal(await run("return document.querySelector('.quote-editor-lines tbody tr').dataset.lineId;"),'sheet-0-line-26');
  await run("[...document.querySelectorAll('.quote-editor-adjustments button')].find(b=>b.textContent.includes('Add adjustment')).click();return true;");await sleep(100);await fillAny('[aria-label="Adjustment label"]','Freight');await sleep(80);await fillAny('[aria-label="Adjustment value"]','100');await sleep(80);assert.equal((await sheet()).adjustments[0].value,100);
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.quote-review');");await visible();assert.equal((await sheet()).lines[19].discrepancyReason,'Reviewed revised supplier total');assert.equal((await sheet()).adjustments[0].label,'Freight');
  await fillAny('#quote-sheet-0-sheet-0-line-1-quantity','');await sleep(100);
  for(const width of [2560,1920,1440,1200,1024,900,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await sleep(100);
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.quotation-review-navigation').scrollIntoView({block:'start'});return true;`);await sleep(100);
      const bounds=await run("const panel=document.querySelector('.quote-review');return {viewport:innerWidth,page:document.documentElement.scrollWidth,panel:panel.clientWidth,scroll:panel.scrollWidth,children:[...panel.children].map(el=>({class:el.className,width:el.clientWidth,scroll:el.scrollWidth}))};");
      assert.equal(bounds.page<=bounds.viewport+1&&bounds.scroll<=bounds.panel+1,true,`Quotation sheet fits ${width}/${theme}: ${JSON.stringify(bounds)}`);
      await run("document.querySelector('.quote-review-trigger').scrollIntoView({block:'center'});return true;");
      await click('.quote-review-trigger');
      await wait("return document.querySelector('.quote-editor-issues').matches(':popover-open');");
      assert.equal(await run("const r=document.querySelector('.quote-editor-issues').getBoundingClientRect();return r.width<=360&&r.left>=7&&r.right<=innerWidth-7&&r.top>=7&&r.bottom<=innerHeight-7;"),true,`Review popover fits ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`quote-review-popover-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await click('.quote-review-trigger');
      assert.equal(await run("const frame=document.querySelector('.quote-editor-lines'),table=frame.querySelector('table'),row=table.querySelector('tbody tr');frame.scrollLeft=150;return getComputedStyle(row).display==='table-row'&&getComputedStyle(row.cells[0]).display==='table-cell'&&table.getBoundingClientRect().width>=1800&&frame.scrollWidth>frame.clientWidth&&frame.scrollLeft>0;"),true,`Offered materials retain wide scrollable rows at ${width}/${theme}`);
      assert.equal(await run("const frame=document.querySelector('.quote-editor-lines'),root=frame.closest('.register'),footer=root.querySelector('.register-footer');frame.scrollTop=120;const header=frame.querySelector('thead th').getBoundingClientRect();return root.getBoundingClientRect().height<=521&&frame.scrollHeight>frame.clientHeight&&frame.scrollTop>0&&Math.abs(header.top-frame.getBoundingClientRect().top)<2&&footer.getBoundingClientRect().top>=frame.getBoundingClientRect().bottom-1;"),true,`Bounded dashboard viewport and sticky header at ${width}/${theme}`);
      await run("document.querySelector('.quote-editor-lines').scrollTo({left:0,top:0});return true;");
      assert.equal(await run("const message=document.querySelector('.quote-editor-lines .field-error'),range=document.createRange();range.selectNodeContents(message);const actions=document.querySelector('.quote-line-actions'),buttons=[...actions.children].map(el=>el.getBoundingClientRect());return getComputedStyle(message).whiteSpace==='nowrap'&&range.getClientRects().length===1&&Math.abs(buttons[0].top-buttons[1].top)<10;"),true,`Validation text and actions remain on single lines at ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`quote-sheet-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      if(width===1440||width===375){await run("document.querySelector('.quote-editor-material-heading').scrollIntoView({block:'start'});return true;");await sleep(100);await writeFile(path.join(profile,`quote-materials-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      await click('[aria-label="Details for line 1"]');await wait("return !!document.querySelector('.record-dialog[open]');");assert.equal(await run("const r=document.querySelector('.record-dialog[open]').getBoundingClientRect();return r.left>=8&&r.right<=innerWidth-8&&r.top>=0&&r.bottom<=innerHeight;"),true,`Material details fit ${width}/${theme}`);await click('.record-dialog[open] .record-modal-close');
    }
  }
  console.log(`Tabbed quotation editor smoke passed: 25 suppliers, 100 lines, issue navigation, pricing details, readonly versions, pagination, persistence and responsive themes. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
