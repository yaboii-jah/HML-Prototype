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
  const queued=path.join(profile,'Queued supplier.pdf');await writeFile(queued,'%PDF-1.4\nConfirmation smoke file');
  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');
  await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__processRequests=[];const processFetch=window.fetch;window.fetch=(input,init={})=>{if(init.method&&init.method!=='GET')window.__processRequests.push(String(input));return processFetch(input,init);};`});
  const fixture=seedDemo(), request=fixture.requests.find(r=>r.id==='m1'), original=fixture.quotes.find(q=>q.id==='q1');
  fixture.role='Procurement';request.status='approved';request.correction=undefined;request.archive=undefined;request.items[0].quantity=20;
  fixture.sites.find(site=>site.id===request.siteId).driveFolderId='confirmation-test-folder';
  fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);
  fixture.pendingAwards=fixture.pendingAwards.filter(a=>a.requestId!==request.id);
  const offer={id:'confirm-offer',description:'Supplier material',quantity:20,unit:request.items[0].unit,unitPrice:50,brand:'',specification:'',requestItemId:request.items[0].id,conversionFactor:1,varianceReason:'',matchConfirmed:true,matchConfidence:'high',discountType:'none',discountValue:0,taxRate:0,printedTotal:null};
  const quote={...original,ref:'CONFIRM-FINAL',reviewStatus:'finalized',reviewedAt:'2026-10-07T00:00:00Z',currency:'PHP',lines:[offer],documents:[{name:'Supplier source.pdf',type:'application/pdf',fileId:'confirm-shared-file'}],supplierDetails:{name:'MetroBuild Materials',address:'',tin:'',contactName:'',email:'',phone:''},adjustments:[],archive:{status:'complete',files:[{localFileId:'confirm-shared-file',driveFileId:'confirm-drive',url:'https://drive.google.com/file/d/confirm-drive/view',name:'Supplier source.pdf'}]}};
  const draft={...structuredClone(quote),id:'confirm-draft',ref:'CONFIRM-DRAFT',reviewStatus:'draft',archive:undefined,reviewedAt:undefined,lines:[{...offer,id:'draft-offer'},{...offer,id:'draft-extra',description:'Extra offered material'}],adjustments:[{id:'draft-adjustment',label:'Freight',kind:'shipping',calculation:'fixed',value:100}]};
  fixture.quotes=fixture.quotes.filter(q=>q.mrfId!==request.id);fixture.quotes.push(quote,draft);
  const load=async()=>{await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1/quotes');await wait("return document.querySelector('.quote-review')?.dataset.quotationId==='confirm-draft'&&!!document.querySelector('.supplier-upload-workbench');");};
  await load();
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await run("return !document.querySelector('.quotation-summary-table')&&document.querySelector('.quote-review').dataset.quotationId==='confirm-draft';"),true,'Supplier tabs replace the review queue and focus the current draft');
  await call('Runtime.evaluate',{expression:`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite');t.objectStore('files').put(new Blob(['%PDF-1.4 source'],{type:'application/pdf'}),'confirm-shared-file');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();return true;})()`,awaitPromise:true,returnByValue:true});
  const snapshot=()=>run("return localStorage.getItem('hml-constructsync-demo-v12');");
  const press=async(label,scope='document')=>{await run(`const button=[...${scope}.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.closest('.procurement-steps')&&b.textContent.includes(${JSON.stringify(label)}))&&!b.matches(':disabled'));if(!button)throw Error('Missing button '+${JSON.stringify(label)});button.focus();button.click();return true;`);await sleep(100);};
  const prompt=async(code,{escape=false,danger=false}={})=>{
    const before=await snapshot(),calls=await run('return window.__processRequests.length;');
    await run(code);await wait("return !!document.querySelector('.confirm-dialog[open]');");
    assert.equal(await run("return document.querySelectorAll('.confirm-dialog[open]').length;"),1);
    if(danger)assert.equal(await run("return document.querySelector('.confirm-dialog[open] .confirm-actions button:last-child').classList.contains('danger-outline');"),true);
    if(escape){await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}else await click('.confirm-dialog[open] .confirm-actions button:first-child');
    await wait("return !document.querySelector('.confirm-dialog[open]')&&!document.querySelector('fieldset.quotation-operation-fields').disabled;");await sleep(80);
    assert.equal(await snapshot(),before,'Cancel/Escape changes no persisted record');
    assert.equal(await run('return window.__processRequests.length;'),calls,'Cancel starts no external process');
  };
  const buttonCode=(label,scope='document')=>`const b=[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.focus();b.click();return true;`;
  await prompt(buttonCode('Enter manually'),{escape:true});
  const countBefore=JSON.parse(await snapshot()).quotes.length;
  await run("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Enter manually');b.click();b.click();return true;");
  await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.length===${countBefore+1};`);
  assert.equal(JSON.parse(await snapshot()).quotes.length,countBefore+1,'Rapid create clicks create exactly one draft');
  await load();
  await press('+ Supplier quotation group');
  const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.supplier-upload-detail input[type=file]'});await call('DOM.setFileInputFiles',{nodeId,files:[queued]});await sleep(100);
  await prompt(buttonCode('Remove group'),{danger:true});
  await prompt("document.querySelector('.quote-file-order button[aria-label^=Remove]').click();return true;",{danger:true});
  await prompt("document.querySelector('.quote-queue-footer .button.primary').click();return true;",{escape:true});
  await prompt(buttonCode('Enter manually using these files'));
  await prompt(buttonCode('Enter manually'));
  const finalRow="document.querySelector('.quote-review[data-quotation-id=\"q1\"]')";
  const draftRow="document.querySelector('.quote-review[data-quotation-id=\"confirm-draft\"]')";
  await click('[data-quote-id="q1"]');
  await prompt(buttonCode('Create revision',finalRow));
  await prompt(buttonCode('Reanalyze',finalRow));
  await click('[data-quote-id="confirm-draft"]');
  assert.equal(await run("const header=document.querySelector('.quote-review[data-quotation-id=\"confirm-draft\"] .quote-editor-header');return !header.querySelector('[popoverTarget]')&&[...header.querySelectorAll('button')].some(b=>b.textContent==='Delete draft'&&b.classList.contains('danger-outline'));"),true,'Delete draft is directly visible with no single-action dropdown');
  await prompt(buttonCode('Delete draft',draftRow),{danger:true});

  draft.archive={status:'pending',files:[],error:'Retry needed'};
  await load();await wait("return [...document.querySelector('.quote-editor-header').querySelectorAll('button')].some(b=>b.textContent==='Retry Drive archive');");
  assert.equal(await run("return !document.querySelector('.quote-editor-header [popoverTarget]');"),true,'A sole archive retry is directly visible');
  draft.archive=structuredClone(quote.archive);
  await load();await wait("return !!document.querySelector('.quote-editor-header a[href*=confirm-drive]');");
  assert.equal(await run("return !document.querySelector('.quote-editor-header [popoverTarget]');"),true,'A sole Drive link is directly visible');
  draft.archive.files.push({...draft.archive.files[0],driveFileId:'second-drive',url:'https://drive.google.com/file/d/second-drive/view',name:'Second file.pdf'});
  await load();await wait("return !!document.querySelector('.quote-editor-header [popoverTarget]');");
  draft.archive=undefined;await load();

  await prompt(buttonCode('Delete',"document.querySelector('.quote-review')"),{danger:true});
  await prompt("document.querySelector('.quote-adjustment-row button').click();return true;",{danger:true});
  await prompt("document.querySelector('.quote-document-attachment button').click();return true;",{danger:true});
  await prompt(buttonCode('Finalize quotation',"document.querySelector('.quote-review')"));
  for(const width of [1440,900,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<801});
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';return true;`);
      await run(buttonCode('Delete',"document.querySelector('.quote-review')"));await wait("return !!document.querySelector('.confirm-dialog[open]');");
      assert.equal(await run("const r=document.querySelector('.confirm-dialog[open]').getBoundingClientRect();return r.left>=8&&r.right<=innerWidth-8&&r.top>=0&&r.bottom<=innerHeight;"),true,`Confirmation fits ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`quotation-confirmation-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await click('.confirm-dialog[open] .confirm-actions button:first-child');await sleep(80);
    }
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await press('Compare & allocate');
  const quantitySelector='.quote-award-edit input';
  const beforeQuantity=await snapshot();await fill(quantitySelector,'8');await sleep(100);
  assert.equal(await snapshot(),beforeQuantity,'Typing an award saves no allocation');
  assert.equal(await run("return [...document.querySelectorAll('button')].find(b=>b.textContent==='Generate supplier PO drafts').disabled;"),true);
  await prompt(buttonCode('Apply allocations'));
  assert.equal(await run("return document.querySelector('.quote-award-edit input').value;"),'8','Cancel preserves typed award');
  await press('Upload & review');await press('Compare & allocate');assert.equal(await run("return document.querySelector('.quote-award-edit input').value;"),'8','Step navigation preserves unapplied quantities');
  await run(buttonCode('Apply allocations'));await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.some(a=>a.quoteLineId==='confirm-offer'&&a.quantity===8);");
  await fill(quantitySelector,'12');await sleep(100);await prompt(buttonCode('Apply allocations'),{escape:true});
  assert.equal(JSON.parse(await snapshot()).pendingAwards.find(a=>a.quoteLineId==='confirm-offer').quantity,8);
  await fill(quantitySelector,'0');await sleep(100);await prompt(buttonCode('Apply allocations'));
  await press('Reset',"document.querySelector('.allocation-material-actions')");assert.equal(await run("return document.querySelector('.quote-award-edit input').value;"),'8');
  for(const invalid of ['', '-1', '21']){await fill(quantitySelector,invalid);await press('Apply allocations');assert.equal(await run("return !document.querySelector('.confirm-dialog[open]')&&!!document.querySelector('.quote-award-edit .field-error');"),true,'Invalid award shows a field error before confirmation');await press('Reset',"document.querySelector('.allocation-material-actions')");}
  await press('Review allocations');const beforeReview=await snapshot();await click('.record-dialog[open] .record-modal-close');assert.equal(await snapshot(),beforeReview,'Cancelling supplier review changes no allocations');
  await fill(quantitySelector,'0');await press('Apply allocations');await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return !JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pendingAwards.some(a=>a.quoteLineId==='confirm-offer');");
  await load();await press('Compare & allocate');await run("[...document.querySelectorAll('details')].find(d=>d.querySelector('summary strong')?.textContent==='Comparison reports').open=true;return true;");await prompt(buttonCode('Generate bid comparison'));
  quote.archive={status:'pending',files:[],error:'Archive needs retry'};await load();
  await click('[data-quote-id="q1"]');
  await prompt(buttonCode('Retry Drive archive',finalRow));
  quote.archive={status:'complete',files:[]};await load();
  await run("const b=document.querySelector('.quote-document-attachment button');b.focus();b.click();return true;");await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='confirm-draft').documents.length===0;");
  const shared=await call('Runtime.evaluate',{expression:"(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('hml-quotation-files',1);r.onsuccess=()=>resolve(r.result)});const file=await new Promise(resolve=>{const r=db.transaction('files','readonly').objectStore('files').get('confirm-shared-file');r.onsuccess=()=>resolve(r.result)});db.close();return !!file;})()",awaitPromise:true,returnByValue:true});assert.equal(shared.result.value,true,'Removing an attachment retains a file still shared by a finalized quote');
  console.log(`Quotation confirmation smoke passed. Screenshots: ${profile}`);
} finally {ws?.close();browser.kill();}
