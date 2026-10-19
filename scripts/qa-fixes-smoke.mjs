import { openQuotationReview } from "./helpers/workspace-fixture.mjs";
import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { poTotal } from "../src/domain/selectors.ts";
import { PDFDocument } from "pdf-lib";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-qa-"));
const port = 15000 + Math.floor(Math.random() * 1000);
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
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}; ${await run("return JSON.stringify({page:location.pathname,errors:[...document.querySelectorAll(\'.inline-error,.field-error\')].map(e=>e.textContent),quotes:JSON.parse(localStorage.getItem(\'hml-constructsync-demo-v12\')).quotes.filter(q=>q.mrfId===\'m1\').map(q=>({id:q.id,name:q.supplierDetails?.name,ref:q.ref}))});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route.split("?")[0])}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  const press = async (label, scope = 'document') => {
    await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&!b.matches(':disabled')&&(b.textContent.trim()===${JSON.stringify(label)}||b.closest('.procurement-steps')&&b.textContent.includes(${JSON.stringify(label)})));if(!b)throw Error('Missing action '+${JSON.stringify(label)});b.click();return true;`);await sleep(120);
  };
  const setRole = async role => { const account=ACCOUNT_FIXTURES.find(a=>a.role===role);await run(`localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:account.email,role}))});return true;`); };
  const load = async (fixture, route, role=fixture.role) => { await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await setRole(role);await navigate(route); };
  const saved = "JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'))";
  const confirm = async () => { await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child'); };
  const fit = async (width, theme) => {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<800});
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(120);
    assert.equal(await run("return document.querySelector('.workspace-content').scrollWidth<=document.querySelector('.workspace-content').clientWidth+1;"),true,`${theme} content fits ${width}`);
  };
  await wait("return !!document.querySelector('#signin-email');");
  const admin=ACCOUNT_FIXTURES.find(a=>a.role==='Administrator');
  await fill('#signin-email',admin.email);await fill('#signin-password',admin.password);await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`const originalFetch=window.fetch;window.fetch=(input,init)=>{if(String(input)==='/api/drive/quotes'){const body=JSON.parse(init.body);return Promise.resolve(Response.json(window.__failQaArchive===body.quote.id?{error:'Archive unavailable'}:{driveFileId:'qa-drive-'+body.quote.id,url:'https://drive.google.com/file/d/qa-'+body.quote.id+'/view'},{status:window.__failQaArchive===body.quote.id?503:200}));}if(String(input)==='/api/quotes/extract')return new Promise(resolve=>setTimeout(()=>resolve(Response.json({extraction:{supplier:'AI supplier '+Date.now(),reference:'AI-QA',currency:'PHP',lines:[{description:'Cement',quantity:2,unit:'bag',unitPrice:100}]}})),900));return originalFetch(input,init);};`});
  // The unused-project action is confirmed, cancellation preserves it, used projects are protected.
  const projects=seedDemo();projects.role='Administrator';projects.siteFilter='all';projects.sites.push({id:'qa-unused',name:'Accidental QA project',location:'Pasig',budget:1000,driveFolderId:'qa-retained-folder'});
  await load(projects,'/admin');await wait("return !!document.querySelector('[aria-label=\"Search projects\"]');");
  await fill('[aria-label="Search projects"]','Accidental QA project');await press('Details');
  await wait("return !!document.querySelector('.record-dialog[open] .admin-project-settings');");
  await press('Delete project');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');
  assert.equal(await run(`return ${saved}.sites.some(s=>s.id==='qa-unused');`),true);
  await press('Delete project');await confirm();await wait(`return !${saved}.sites.some(s=>s.id==='qa-unused');`);
  assert.equal(await run(`return ${saved}.activity[0].eventType;`),'project.removed');
  for(const width of [1920,2560]){await fit(width,'light');assert.equal(await run("const main=document.querySelector('.workspace-content');const r=main.getBoundingClientRect(),p=main.parentElement.getBoundingClientRect();return r.width<=1550&&Math.abs((r.left-p.left)-(p.right-r.right))<2;"),true,'Wide content is centered beside sidebar');}
  // Fifty-row Accounting editing stays mounted inside a bounded, horizontally scrollable table.
  const many=seedDemo();many.role='Accounting / Auditing';many.siteFilter='all';const request=many.requests.find(r=>r.id==='m1'),po=many.pos.find(p=>p.id==='po1');
  request.items=Array.from({length:50},(_,i)=>({...request.items[0],id:'qa-material-'+i,name:'QA material '+(i+1),quantity:20}));
  po.status='submitted';po.archive=undefined;po.lines=request.items.map(item=>({itemId:item.id,quoteLineId:'qa-line-'+item.id,quantity:2,unitPrice:100,discountType:'none',discountValue:0,fixedDiscountConfirmed:true}));
  await load(many,'/accounting/po1');await wait("return document.querySelectorAll('.qa-bounded-table tbody tr').length===50;");
  assert.equal(await run("return [...document.querySelectorAll('.accounting-po-form details')].every(el=>!el.open);"),true,'Accounting disclosures start collapsed');
  await fill('[aria-label="PO quantity 50"]','3');assert.equal(await run("return document.querySelector('[aria-label=\"PO quantity 50\"]').value;"),'3');
  await run("document.querySelector('.qa-bounded-table').scrollTop=99999;return true;");
  await press("Remove", "document.querySelector('.qa-bounded-table tbody tr:last-child')");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');
  assert.equal(await run("return document.querySelectorAll('.qa-bounded-table tbody tr').length;"),50,'Cancelling removal retains all rows');
  for(const theme of ['light','dark'])for(const width of [320,375,414,768,1440]){await fit(width,theme);assert.equal(await run("const t=document.querySelector('.qa-bounded-table');return (innerWidth>768||t.scrollWidth>t.clientWidth)&&t.scrollHeight>t.clientHeight;"),true,'Large material tables scroll locally');}
  await fit(1440,'light');await writeFile(path.join(profile,'qa-accounting-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));await press('Approve PO');await confirm();await wait("return document.querySelector('[name=financialReviewed]').closest('details').open;");
  assert.equal(await run(`return ${saved}.pos.find(p=>p.id==='po1').status;`),'submitted','Unreviewed tax settings block approval and are revealed');
  await load(many,'/purchase-orders/po1');await wait("return !!document.querySelector('.po-print');");
  assert.equal(await run("return !document.querySelector('.po-print table')&&!![...document.querySelectorAll('.po-print button')].find(b=>b.textContent.includes('Print preview'));"),true,'PO summary uses document preview without duplicate materials');
  // Warehouse default remains editable. Every scheduling row stays in FormData.
  const logistics=structuredClone(many);logistics.role='Logistics';logistics.pos.find(p=>p.id==='po1').status='released';logistics.batches=[];logistics.movements=[];
  await load(logistics,'/deliveries/new?poId=po1');await wait("return !!document.querySelector('[name=destinationAddress]');");
  await fill('[name=leg]','supplier-warehouse');assert.equal(await run("return document.querySelector('[name=destinationAddress]').value;"),"155 M. Paterno St., San Juan City");
  await fill('[name=destinationAddress]','QA edited warehouse address');await fill('[name=leg]','supplier-site');await fill('[name=leg]','supplier-warehouse');
  assert.equal(await run("return document.querySelector('[name=destinationAddress]').value;"),'QA edited warehouse address');
  assert.equal(await run("return [...new FormData(document.querySelector('form')).keys()].filter(k=>k.startsWith('expected-')).length;"),50);
  // The request wizard fits both themes; material removal is confirmed and Close uses an icon.
  const wizard=seedDemo();wizard.role='Site Personnel';wizard.siteFilter='all';
  await load(wizard,'/requests/new');await wait("return !!document.querySelector('#ref');");
  for(const theme of ['light','dark'])for(const width of [320,375,414,768,1440]){await fit(width,theme);assert.equal(await run("const el=document.querySelector('input[type=date]'),s=getComputedStyle(el,'::-webkit-calendar-picker-indicator');return getComputedStyle(el).colorScheme===document.documentElement.dataset.theme&&s.opacity==='1';"),true,'Date icon follows the selected theme');}
  await fit(1440,'light');await fill('#scopeId',wizard.scopes.find(scope=>scope.siteId===wizard.sites[0].id).id);await fill('#ref','QA-REQUEST-001');
  for(const name of ['requestedBy','approvedBy','purchaser','financeOfficer'])await fill('#'+name,'QA signatory');
  await press('Next');await wait("return !document.querySelector('.materials-panel').hidden;");await press('+ Add material');await wait("return !!document.querySelector('.material-add-dialog[open]');");
  assert.equal(await run("const b=document.querySelector('[aria-label=\"Close add material dialog\"]'),r=b.getBoundingClientRect();return !!b.querySelector('svg')&&r.width>=44&&r.height>=44&&!b.textContent.trim();"),true,'Material close icon has an accessible 44px target');
  await click('[aria-label="Close add material dialog"]');
  await press('+ Add material');await press('Add material',"document.querySelector('.material-add-dialog[open]')");await wait("return !!document.querySelector('.material-edit-dialog[open]');");
  await press('Remove material',"document.querySelector('.material-edit-dialog[open]')");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:first-child');
  assert.equal(await run("return document.querySelectorAll('.materials-panel [data-material-row]').length===2;"),true,'Cancelling keeps request materials');
  await click('[aria-label="Close material details"]');
  // Bulk finalization handles ready drafts, invalid drafts and retryable archive failure.
  const quotations=seedDemo();quotations.role='Procurement';quotations.siteFilter='all';quotations.pos=quotations.pos.filter(p=>p.mrfId!=='m1');quotations.pendingAwards=[];
  const req=quotations.requests.find(r=>r.id==='m1');quotations.sites.find(s=>s.id===req.siteId).driveFolderId='qa-project-folder';req.status='approved';req.archive=undefined;req.correction=undefined;req.items=[req.items[0],{...req.items[0],id:"qa-second-material",name:"Second QA material"}];req.items.forEach(i=>i.quantity=20);
  const template=quotations.quotes.find(q=>q.mrfId==='m1');
  const draft=(id,supplier,invalid=false)=>({...structuredClone(template),id,mrfId:'m1',supplierId:'',ref:id,reviewStatus:'draft',archive:undefined,supplierDetails:{name:supplier,address:'',tin:'',contactName:'',email:'',phone:''},documents:[{name:'QA quotation.pdf',type:'application/pdf',fileId:'qa-source'}],currency:'PHP',financial:{vatStatus:'NON-VAT',priceBasis:'inclusive',vatRate:12,reviewed:true},adjustments:[],lines:req.items.map(item=>({id:id+'-'+item.id,description:item.name,quantity:20,unit:item.unit,unitPrice:invalid?0:100,requestItemId:item.id,conversionFactor:1,varianceReason:'',brand:'',specification:'',matchConfirmed:true,discountType:'none',discountValue:0,taxRate:0,printedTotal:null}))});
  quotations.quotes=quotations.quotes.filter(q=>q.mrfId!=='m1');quotations.quotes.push(draft('qa-ready-a','QA Supplier A'),draft('qa-ready-b','QA Supplier B'),draft('qa-invalid','QA Supplier C',true));
  await load(quotations,'/requests/m1/quotes');await run(openQuotationReview);await sleep(160);await wait("return !!document.querySelector('.qa-bulk-toolbar');");
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=Array.from(await pdf.save());
  const stored=await call('Runtime.evaluate',{expression:`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob([new Uint8Array(${JSON.stringify(bytes)})],{type:'application/pdf'}),'qa-source');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return true;})()`,awaitPromise:true,returnByValue:true});assert.ok(!stored.exceptionDetails);
  await run("window.__failQaArchive='qa-ready-b';return true;");
  await press('Finalize ready drafts');await confirm();await wait(`return ${saved}.quotes.filter(q=>q.mrfId==='m1'&&q.reviewStatus==='finalized').length===2&&document.body.textContent.includes('archive needs retry');`);
  assert.equal(await run(`return ${saved}.quotes.find(q=>q.id==='qa-invalid').reviewStatus;`),'draft');
  assert.equal(await run(`return ${saved}.quotes.find(q=>q.id==='qa-ready-b').archive.status;`),'pending');
  assert.equal(await run("return document.querySelector('.procurement-steps .active').textContent.includes('Upload & review');"),true,'Bulk finalization keeps remaining review visible');
  // Retry B before comparing, then apply edits on both materials with one confirmation.
  await run("window.__failQaArchive='';return true;");
  await press('Compare & award');await wait("return !!document.querySelector('.comparative-bid-table');");
  for (const [index, quantity] of [[0, 2], [1, 3]]) {
    await run(`document.querySelectorAll('[data-split-material]')[${index}].click();return true;`);
    await wait("return !!document.querySelector('.comparison-split input:not(:disabled)');");
    await fill('.comparison-split input:not(:disabled)', String(quantity));
    await press('Use these quantities');
  }
  await press('Review & save awards');await press('Save awards');await wait(`return ${saved}.pendingAwards.length===2;`);
  await click('.record-dialog[open] .record-modal-close');
  assert.deepEqual((await run(`return ${saved}.pendingAwards.map(a=>a.quantity);`)).sort(),[2,3]);
  // Prominent progress remains visible while ready groups across the queue are read.
  await press('Upload & review');await press('+ Supplier quotation group');
  await run(`const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], 'QA extraction.pdf',{type:'application/pdf'}));const el=document.querySelector('.quote-group-drop input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await press('Extract all ready groups (1)');await confirm();await wait("return !!document.querySelector('dialog[open] .qa-extraction-progress');");
  assert.match(await run("return document.querySelector('.qa-extraction-progress').textContent;"),/1 of 1/);
  await wait(`return !document.querySelector('dialog[open] .qa-extraction-progress')&&${saved}.quotes.some(q=>q.mrfId==='m1'&&q.ref==='AI-QA'&&q.supplierDetails.name.startsWith('AI supplier'))&&[...document.querySelectorAll('.quote-review h2')].some(el=>el.textContent.startsWith('AI supplier'));`);
  // Settled Finance records are discoverable and their history describes settlement.
  const finance=seedDemo();finance.role='Finance';finance.siteFilter='all';const settled=finance.pos.find(p=>p.id==='po1');settled.workflow='pm-external-v1';settled.status='released';settled.paymentMode='upfront';settled.issuance={at:'2026-10-10T00:00:00Z',by:admin};
  settled.externalPayment={amount:poTotal(finance,settled),method:'Bank',reference:'QA paid',date:'2026-10-10',proofs:[],verifiedAt:'2026-10-10T00:00:00Z',verifiedBy:admin};settled.coordinationHistory=[{revision:1,status:'Pending',priority:'High',plannedDate:'',note:'',at:'2026-10-10T00:00:00Z',by:admin,reason:'Full payment verified',outcome:'Settled'}];
  await load(finance,'/finance');await wait("return !!document.querySelector('#finance-coordination-records-tab-1');");await click('#finance-coordination-records-tab-1');
  assert.equal(await run("return !!document.querySelector('a[href=\"/finance/po1\"]');"),true,'Settled payment remains listed');
  await navigate('/finance/po1');await wait("return !!document.querySelector('.payment-coordination-summary');");
  assert.equal(await run("return !document.querySelector('.payment-coordination-form')&&document.querySelector('.payment-coordination-summary details').textContent.includes('Settled');"),true,'Settled detail is read-only and shows its outcome');
  for(const theme of ['light','dark'])for(const width of [320,375,414,768,1440])await fit(width,theme);
  await writeFile(path.join(profile,'qa-finance-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  console.log('QA browser checks passed: project confirmation/deletion, centered wide layout, 50-row Accounting and delivery forms, validation reveals collapsed tax fields, PO summary, warehouse default/edit retention, bulk finalization/archive failure, atomic allocation, extraction progress and settled Finance history. External Drive/AI calls mocked. Screenshots:',profile);
} catch (error) {
  if(ws?.readyState===1) { console.error('QA browser failure; isolated profile:',profile); }
  throw error;
} finally { ws?.close(); browser.kill(); }
