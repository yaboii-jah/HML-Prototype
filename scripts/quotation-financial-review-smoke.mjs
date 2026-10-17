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
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-quotation-review-"));
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
    const result = await call("Runtime.evaluate", { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");


  const fixture=seedDemo(),request=fixture.requests.find(value=>value.id==='m1'),source=fixture.quotes.find(value=>value.id==='q1');
  request.status='approved';request.archive=undefined;request.correction=undefined;request.items=[{...request.items[0],quantity:12,unit:'PAIL'}];
  fixture.role='Procurement';fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);fixture.batches=fixture.batches.filter(batch=>fixture.pos.some(po=>po.id===batch.poId));fixture.quotes=fixture.quotes.filter(q=>q.mrfId!==request.id);
  const names=['Northbridge','Harborline','Pillarstone','Crestmark','Historical supplier'];
  for(let index=0;index<5;index++)fixture.quotes.push({...structuredClone(source),id:`review-${index}`,ref:`Q-REVIEW-${index}`,reviewStatus:index===4?'finalized':'draft',supplierDetails:{name:names[index],address:'Sample address',tin:'123-456-789',contactName:'Supplier contact',email:'sample@example.com',phone:'09123456789'},quoteDate:'2026-10-12',validity:'2026-11-12',available:'In stock',leadDays:3,terms:'30 days',documents:[{name:'Supplier quotation.pdf',type:'application/pdf',fileId:'review-source'}],financial:index===4?undefined:{vatStatus:'VAT',priceBasis:'inclusive',vatRate:12,reviewed:false},lines:[{id:`review-${index}-line`,description:'CONCRETE PRIMER, WATER-BASED, 16 L',quantity:12,unit:'PAIL',unitPrice:100,brand:'',specification:'',requestItemId:request.items[0].id,conversionFactor:1,varianceReason:'',matchConfirmed:true,matchConfidence:'high',discountType:'none',discountValue:0,taxRate:0,printedTotal:null}],adjustments:index===0?[{id:'delivery',label:'Delivery fee',kind:'shipping',calculation:'fixed',value:100},{id:'discount',label:'Quotation discount',kind:'discount',calculation:'percentage',value:10},{id:'tax',label:'Extracted VAT',kind:'tax',calculation:'percentage',value:12}]:[],archive:index===4?{status:'complete',files:[]}:undefined});
  const finalized=fixture.quotes.find(value=>value.id==='review-3');finalized.reviewStatus='finalized';finalized.financial.reviewed=true;finalized.archive={status:'complete',files:[]};
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});await navigate('/requests/m1/quotes');await run(openQuotationReview);await sleep(160);
  const sheet=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='review-0');");
  const fillAny=async(selector,value)=>run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const totals=()=>run("return {gross:document.querySelector('.quote-summary-gross dd')?.textContent,net:document.querySelector('.quote-summary-net dd')?.textContent};");
  assert.equal(await run("return document.querySelectorAll('.quote-core-details>.collapsible-body>fieldset>.quote-editor-field-grid input').length;"),13,'All supplier fields share one grid');
  assert.equal(await run("return document.querySelector('.quote-core-details').open;"),false,'Supplier details start collapsed on initial visit');
  assert.equal(await run("return !!document.querySelector('.quote-core-details details');"),false,'No nested More quotation details disclosure');
  assert.equal(await run("return !!document.querySelector('.quote-documents-section');"),false,'No separate supplier documents container');
  await run("[...document.querySelectorAll('.quote-editor-header-actions button')].find(button=>button.textContent==='View documents').click();return true;");await wait("return !!document.querySelector('.quote-documents-dialog[open]');");
  await click('.quote-document-management .danger-outline');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal((await sheet()).documents.length,1);
  await click('.quote-document-management .danger-outline');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return !document.querySelector('.quote-documents-list button');");assert.equal((await sheet()).documents.length,0,'Removing last attachment updates the open viewer');
  await run("const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'Supplier source.png',{type:'image/png'}));const input=document.querySelector('.quote-document-management input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;");await wait("return document.querySelector('.quote-documents-list button')?.textContent.includes('Supplier source.png');");assert.equal((await sheet()).documents.length,1,'New attachment updates the open viewer');
  await click('.quote-documents-dialog[open] [aria-label="Close document preview"]');
  assert.equal(await run("return !!document.querySelector('.quote-financial-inputs>.quote-tax-controls')&&!document.querySelector('.quote-financial-card .quote-tax-controls');"),true,'VAT settings appear above adjustments in the left column');
  assert.equal(await run("return !!document.querySelector('.quote-finalize-actions .quote-tax-confirm')&&!document.querySelector('.quote-tax-controls .quote-tax-confirm');"),true,'VAT confirmation stays beside the totals and finalization');
  assert.equal(await run("return document.querySelector('.quote-summary-help').open;"),false,'Long computation explanations are initially collapsed');
  assert.equal(await run("return !!document.querySelector('.quote-editor-header .button.primary');"),false,'Finalization is beside the final totals');
  assert.equal(await run("return document.querySelector('.quote-finalize-actions .button').disabled;"),true,'VAT review is still mandatory');
  assert.deepEqual(await totals(),{gross:'\u20b11,180.00',net:'\u20b11,167.50'});
  assert.match(await run("return document.querySelector('.quote-computation-summary').textContent;"),/VAT already included/);
  assert.equal(await run("return [...document.querySelectorAll('.quotation-tab-scroll')].every(el=>el.hidden);"),true,'Five compact supplier tabs need no arrow clutter');
  await click('.quote-review-trigger');await run("[...document.querySelectorAll('.quote-editor-issues button')].find(el=>el.textContent.includes('VAT')).click();return true;");await wait("return document.activeElement.id==='quote-review-0-financial';");
  await click('input[name="quote-review-0-price-basis"][value="exclusive"]');await sleep(100);
  assert.deepEqual(await totals(),{gross:'\u20b11,321.60',net:'\u20b11,307.60'});assert.equal((await sheet()).financial.reviewed,false);
  assert.match(await run("return document.querySelector('.quote-adjustment-amount').textContent;"),/Including VAT.*112\.00/);
  assert.match(await run("return document.querySelector('.quote-computation-summary dl>div:nth-child(2) dt').textContent;"),/before VAT/);
  await click('[aria-label="Confirm quotation VAT review-0"]');await sleep(80);assert.equal(await run("return document.querySelector('.quote-finalize-actions .button').disabled;"),false);
  await click('.quote-finalize-actions .button');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal((await sheet()).reviewStatus,'draft','Cancel never finalizes or archives');
  await click('input[name="quote-review-0-vat-status"][value="NON-VAT"]');await sleep(80);
  assert.equal(await run("return !!document.querySelector('input[name=\"quote-review-0-price-basis\"]')||!!document.querySelector('[aria-label=\"Quotation VAT rate review-0\"]');"),false,'NON-VAT hides irrelevant controls');
  assert.equal((await sheet()).financial.priceBasis,'exclusive');assert.equal((await sheet()).financial.vatRate,12);assert.deepEqual(await totals(),{gross:'\u20b11,180.00',net:'\u20b11,180.00'});
  assert.equal(await run("return document.querySelector('.quote-finalize-actions .button').disabled;"),true,'Changing VAT status clears review');
  await click('input[name="quote-review-0-vat-status"][value="VAT"]');await sleep(80);assert.equal(await run("return document.querySelector('input[name=\"quote-review-0-price-basis\"][value=exclusive]').checked;"),true);
  await fillAny('[aria-label="Quotation VAT rate review-0"]','10');await sleep(80);assert.deepEqual(await totals(),{gross:'\u20b11,298.00',net:'\u20b11,284.00'});assert.equal((await sheet()).financial.reviewed,false);
  await fillAny('[aria-label="Quotation VAT rate review-0"]','12');await sleep(80);
  const beforeRemove=JSON.stringify(await sheet());await click('[aria-label="Remove adjustment 3"]');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal(JSON.stringify(await sheet()),beforeRemove);
  await click('[aria-label="Remove adjustment 3"]');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(100);assert.equal((await sheet()).adjustments.length,2);assert.deepEqual(await totals(),{gross:'\u20b11,321.60',net:'\u20b11,307.60'},'Removing an ignored tax changes no cost');
  await click('.quote-editor-adjustments>.panel-heading button');await wait("return document.activeElement.getAttribute('aria-label')==='Adjustment label'&&document.querySelectorAll('.quote-adjustment-card').length===3;");
  await fillAny('.quote-adjustment-card:last-child [aria-label="Adjustment label"]','Handling fee');await sleep(80);await fillAny('.quote-adjustment-card:last-child [aria-label="Adjustment value"]','50');await sleep(80);
  assert.deepEqual(await totals(),{gross:'\u20b11,377.60',net:'\u20b11,362.60'});
  await run("const key='hml-constructsync-demo-v12',data=JSON.parse(localStorage.getItem(key));data.quotes.find(q=>q.id==='review-0').adjustments[2].taxable=false;localStorage.setItem(key,JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(data)}));return true;");await sleep(100);assert.deepEqual(await totals(),{gross:'\u20b11,371.60',net:'\u20b11,357.60'});
  assert.match(await run("return document.querySelector('.quote-adjustment-card:last-child').textContent;"),/Non-taxable service/);
  await fillAny('#quote-review-0-ref','');await sleep(80);await click('.quote-review-trigger');await run("[...document.querySelectorAll('.quote-editor-issues button')].find(el=>el.textContent.includes('quotation reference')).click();return true;");await wait("return document.activeElement.id==='quote-review-0-ref';");await fillAny('#quote-review-0-ref','Q-REVIEW-0');await sleep(80);
  await fillAny('#quote-review-0-contactName','Updated contact');await sleep(80);assert.equal((await sheet()).supplierDetails.contactName,'Updated contact');
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.procurement-steps');");await run(openQuotationReview);await sleep(160);await wait("return !!document.querySelector('.quote-financial-card');");assert.equal((await sheet()).supplierDetails.contactName,'Updated contact');assert.equal((await sheet()).adjustments[2].value,50);
  assert.equal(await run("return document.querySelector('.quote-core-details').open;"),false,'Reload returns supplier details to the collapsed state');
  for(const width of [1600,1440,1280,1200,1000,900,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1050,deviceScaleFactor:1,mobile:width<=800});await sleep(140);
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.quote-financial-workspace').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;`);await sleep(80);
      const bounds=await run("const workspace=document.querySelector('.quote-financial-workspace'),card=document.querySelector('.quote-financial-card'),inputs=document.querySelector('.quote-financial-inputs'),tax=document.querySelector('.quote-tax-controls'),adjustments=document.querySelector('.quote-editor-adjustments'),box=workspace.getBoundingClientRect();return {viewport:innerWidth,page:document.documentElement.scrollWidth,workspace:workspace.clientWidth,overflow:workspace.scrollWidth,card:card.getBoundingClientRect().toJSON(),inputs:inputs.getBoundingClientRect().toJSON(),tax:tax.getBoundingClientRect().toJSON(),adjustments:adjustments.getBoundingClientRect().toJSON(),display:[inputs,tax,adjustments].map(el=>getComputedStyle(el).display),box:box.toJSON()};");
      assert.ok(bounds.tax.height>0&&bounds.adjustments.height>0,`VAT controls and adjustments remain visible at ${width}/${theme}`);
      assert.equal(await run("return [...document.querySelectorAll('.quote-editor-adjustments h3,.quote-adjustment-card input,.quote-adjustment-card select')].every(element=>element.getBoundingClientRect().height>0&&element.getBoundingClientRect().width>0);"),true,`Adjustment headings and fields remain rendered at ${width}/${theme}`);
      assert.equal(bounds.page<=bounds.viewport+1&&bounds.overflow<=bounds.workspace+1,true,`Financial review fits ${width}/${theme}: ${JSON.stringify(bounds)}`);
      assert.equal(bounds.tax.top<bounds.adjustments.top,true,`VAT settings precede adjustments at ${width}/${theme}: ${JSON.stringify(bounds)}`);
      assert.equal(width>=1000?bounds.card.left>bounds.inputs.left&&Math.abs(bounds.card.top-bounds.tax.top)<1:bounds.card.top>=bounds.inputs.bottom-1,true,`Financial columns stack appropriately at ${width}`);
      assert.equal(await run("return [...document.querySelectorAll('.quote-radio-group label')].every(label=>label.scrollWidth<=label.clientWidth+1);"),true,'Radio labels fit without wrapping or clipping');
      if(width===1440||width===375)await writeFile(path.join(profile,`financial-review-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      if(width===375){await run("document.querySelector('.quote-financial-card').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;");await writeFile(path.join(profile,`financial-summary-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      if(width===1440||width===375){await run("document.querySelector('.quotation-review-navigation').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;");await writeFile(path.join(profile,`quotation-details-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      assert.equal(await run("const table=document.querySelector('.quote-editor-lines table'),frame=table.parentElement;frame.scrollLeft=100;return table.querySelectorAll('th').length===8&&getComputedStyle(table.querySelector('tbody tr')).display==='table-row'&&frame.scrollLeft>0;"),true,'Accepted worksheet retains its columns and horizontal scrolling');
    }
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});await click('[data-quote-id="review-1"]');await sleep(120);
  assert.equal(await run("return document.querySelectorAll('.quote-computation-summary dl>div').length;"),6,'The complete breakdown remains immediately visible without adjustments');
  const compactHeight=await run("return document.querySelector('.quote-financial-card').getBoundingClientRect().height;");
  assert.ok(compactHeight<550,`Empty-adjustment financial review remains compact (${compactHeight}px)`);
  await run("document.documentElement.dataset.theme='light';document.querySelector('.quote-financial-workspace').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;");
  await writeFile(path.join(profile,'financial-empty-1440-light.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const beforeHelp=await totals();await click('.quote-summary-help>summary');
  assert.equal(await run("return document.querySelector('.quote-summary-help').open;"),true);
  assert.deepEqual(await totals(),beforeHelp,'Expanding explanatory text does not change totals');
  await click('.quote-summary-help>summary');await click('[data-quote-id="review-3"]');await sleep(120);
  assert.equal(await run("return document.querySelector('.quote-review').classList.contains('is-readonly');"),true);
  assert.equal(await run("return !!document.querySelector('.quote-finalize-actions');"),false,'Recorded quotations cannot be finalized again');
  assert.equal(await run("return [...document.querySelectorAll('.quote-tax-controls input')].every(input=>input.matches(':disabled'));"),true,'Financial settings of recorded quotations remain readonly');
  const recorded=await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='review-3').financial;");
  await click('input[name="quote-review-3-vat-status"][value="NON-VAT"]');
  assert.deepEqual(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='review-3').financial;"),recorded);
  await click('[data-quote-id="review-4"]');await sleep(120);
  assert.equal(await run("return document.querySelector('.quote-review').classList.contains('is-readonly');"),true);
  assert.equal(await run("return !!document.querySelector('.quote-finalize-actions')||!!document.querySelector('.quote-tax-controls');"),false,'Legacy readonly records do not receive invented financial controls');
  assert.match(await run("return document.querySelector('.quote-computation-summary').textContent;"),/not been reviewed/);
  await click('.quotation-view-modes button:last-child');assert.equal(await run("return document.querySelectorAll('.quote-review').length;"),5);assert.equal(await run("return [...document.querySelectorAll('.quote-core-details')].every(el=>!el.open);"),true);
  await click('.quotation-view-modes button:first-child');await click('.quotation-navigation-actions>.button');await wait("return !!document.querySelector('.quotation-picker');");await fillAny('[aria-label="Search quotations"]','Northbridge');await click('.quotation-picker-list>button');assert.equal(await run("return document.querySelector('.quote-review').dataset.quotationId;"),'review-0');
  console.log(`Quotation financial review smoke passed: VAT above adjustments, compact computations (${compactHeight}px with no adjustments), radio controls, reconciled totals, confirmation resets, removals, focus, legacy records and responsive themes. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
