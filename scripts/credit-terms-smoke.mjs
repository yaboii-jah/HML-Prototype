import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { initializePoDocument } from "../src/domain/po-document.ts";
import { writeFile } from "node:fs/promises";
import { philippineDate } from "../src/domain/credit-terms.ts";
import { poTotal } from "../src/domain/selectors.ts";

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
  const wait = async code => { for (let i = 0; i < 600; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}: ${await run("return JSON.stringify({body:document.body.innerText.slice(-1600),role:JSON.parse(localStorage.getItem(\"hml-constructsync-demo-v12\"))?.role});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => { await wait(`return [...document.querySelectorAll(${JSON.stringify(selector)})].some(el=>el.checkVisibility());`); return run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`); };
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Accounting / Auditing');
  await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture=seedDemo(),po=fixture.pos[0],request=fixture.requests.find(value=>value.id===po.mrfId),quote=fixture.quotes.find(value=>value.id===po.quoteId),project=fixture.sites.find(value=>value.id===request.siteId);
  project.driveFolderId='browser-credit-project';fixture.role='Accounting / Auditing';fixture.pos=[po];fixture.paymentRequests=[];fixture.payments=[];fixture.batches=[];fixture.movements=[];fixture.accounting=[];
  request.workflow='pm-external-v1';request.status='approved';request.archive={status:'complete',approvedAt:'2026-10-09T00:00:00Z',versions:[]};
  initializePoDocument(po,request,quote,project,'2026-10-09T00:00:00Z');po.document.vendorName=fixture.suppliers.find(value=>value.id===quote.supplierId).name;po.status='submitted';po.paymentMode=undefined;po.financial.reviewed=true;po.archive=undefined;
  const due=philippineDate(new Date(Date.now()-86400000)),date=philippineDate();
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__proofCalls=0;window.__proofFail=false;const originalFetch=window.fetch;window.fetch=async(input,init)=>{if(String(input).endsWith('/api/drive/purchase-orders'))return Response.json({fileId:'credit-po-drive',url:'https://drive.google.com/file/d/credit-po-drive/view'});if(String(input).endsWith('/api/drive/payment-proof')){window.__proofCalls++;return window.__proofFail?Response.json({error:'Test archive unavailable'},{status:502}):Response.json({driveFileId:'proof-test-'+window.__proofCalls,url:'https://drive.google.com/file/d/proof-test-'+window.__proofCalls+'/view'});}return originalFetch(input,init);};`});
  const press=async(label,scope='document')=>{await wait(`return [...${scope}.querySelectorAll('button')].some(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});`);await run(`const b=[...${scope}.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();return true;`);await sleep(100);};
  const confirmed=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');};
  const saved=`JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'))`;
  const role=async department=>{const user=ACCOUNT_FIXTURES.find(value=>value.role===department);await run(`localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:user.email,role:user.role}))});return true;`);};
  await navigate(`/accounting/${po.id}`);await wait("return !!document.querySelector('.accounting-po-form');");
  await fill('select[name=paymentMode]','credit');await wait("return !!document.querySelector('input[name=paymentDueDate]');");
  await press('Approve PO');assert.equal(await run("return !!document.querySelector('.confirm-dialog[open]');"),false,'Due date required before approval');
  await fill('input[name=paymentDueDate]',due);await click('input[name=financialReviewed]');await press('Approve PO');await confirmed();await wait(`return ${saved}.pos[0].archive?.status==='complete';`);
  assert.equal(await run(`return ${saved}.pos[0].externalCredit;`),true);
  assert.equal(await run("return [...document.querySelectorAll('.credit-payment-panel button')].find(b=>b.textContent==='Confirm delivery clearance').disabled;"),true,'Supplier issuance required');
  await role('Procurement');await navigate(`/purchase-orders/${po.id}`);await press('Confirm supplier issuance');await confirmed();await wait(`return !!${saved}.pos[0].issuance;`);
  await role('Finance');await navigate('/finance');await wait("return document.body.textContent.includes('Payment coordination');");
  assert.equal(await run("return document.querySelector('[role=tab][aria-selected=true]').textContent;"),'Payment coordination');
  await navigate(`/finance/${po.id}`);await wait("return !!document.querySelector('.payment-coordination-form');");
  const fillCoordination=async(status,priority='Urgent')=>{await fill('.payment-coordination-form select[name=priority]',priority);await fill('.payment-coordination-form select[name=status]',status);await fill('.payment-coordination-form input[name=date]',date);await fill('.payment-coordination-form textarea[name=note]','External payment coordination test');};
  await fillCoordination('Processing');await press('Save coordination');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal(await run(`return ${saved}.pos[0].paymentCoordination?.revision||0;`),0,'Cancelling leaves plan untouched');
  await press('Save coordination');await confirmed();await wait(`return ${saved}.pos[0].paymentCoordination?.revision===1;`);
  assert.equal(await run(`return ${saved}.pos[0].status;`),'approved','Finance cannot clear delivery');
  await fillCoordination('Awaiting Accounting verification');await press('Save coordination');await confirmed();await wait(`return ${saved}.pos[0].paymentCoordination?.revision===2;`);
  assert.equal(await run(`return ${saved}.pos[0].creditPayments?.length||0;`),0,'Reporting external payment does not verify money');
  await role('Accounting / Auditing');await navigate(`/accounting/${po.id}`);await wait("return !!document.querySelector('.credit-payment-panel');");
  await press('Confirm delivery clearance');await confirmed();await wait(`return ${saved}.pos[0].status==='released';`);
  assert.equal(await run(`return ${saved}.pos[0].creditPayments?.length||0;`),0,'Unpaid credit PO is cleared');
  const stored=await run(`return ${saved};`),total=poTotal(stored,stored.pos[0]),part=Math.round(total*.4*100)/100;
  const attach=async index=>{await run(`const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4 distinct credit payment proof '+${index}],'Credit proof '+${index}+'.pdf',{type:'application/pdf'}));const el=document.querySelector('.credit-payment-panel .proof-upload input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true;`);};
  await run('window.__proofFail=true;return true;');await attach(1);await wait(`return !!${saved}.pos[0].paymentProofs?.[0]?.archive.error;`);
  assert.equal(await run("return document.querySelector('.credit-payment-form button').disabled;"),true);
  await run('window.__proofFail=false;return true;');await press('Retry archive');await wait(`return ${saved}.pos[0].paymentProofs[0].archive.status==='complete';`);
  const pay=async(amount,ref,count)=>{await fill('.credit-payment-form input[name=amount]',amount);await fill('.credit-payment-form select[name=method]','Bank');await fill('.credit-payment-form input[name=reference]',ref);await fill('.credit-payment-form input[name=date]',date);await click('.credit-payment-form input[name=proofIds]');await press('Verify payment');await confirmed();await wait(`return ${saved}.pos[0].creditPayments?.length===${count};`);};
  await pay(part,'BANK-CREDIT-1',1);assert.equal(await run(`return ${saved}.pos[0].paymentCoordination.status;`),'Pending');assert.equal(await run(`return ${saved}.pos[0].paymentCoordination.plannedDate;`),'');assert.equal(await run("return document.querySelector('.credit-payment-panel').textContent.includes('Partly Paid');"),true);
  await attach(2);await wait(`return ${saved}.pos[0].paymentProofs?.[1]?.archive.status==='complete';`);await pay(Math.round((total-part)*100)/100,'BANK-CREDIT-2',2);
  assert.equal(await run("return !!document.querySelector('.credit-payment-form');"),false,'No further payments when settled');
  await role('Finance');await navigate('/finance');assert.equal(await run("return !!document.querySelector('.register table tbody tr');"),false,'Settled PO leaves active queue');
  await fill('select[aria-label="Coordination status"]','Settled');await wait("return !!document.querySelector('.register table tbody tr');");
  await navigate(`/finance/${po.id}`);assert.equal(await run("return !!document.querySelector('.payment-coordination-form');"),false,'Settled coordination is read-only');
  await role('Accounting / Auditing');await navigate(`/accounting/${po.id}`);

  await wait("return !!document.querySelector('.credit-payment-history details');");await run("document.querySelector('.credit-payment-history details').open=true;return true;");await press('Void incorrect payment');await fill('.credit-payment-history textarea[name=reason]','Incorrect payment recorded for correction');await press('Continue to confirmation');await confirmed();await wait(`return !!${saved}.pos[0].creditPayments[1].voided;`);
  assert.equal(await run(`return ${saved}.pos[0].status;`),'released','Voiding preserves delivery clearance');
  assert.equal(await run("return document.querySelector('.credit-payment-panel').textContent.includes('Payment is overdue');"),true);
  for(const theme of ['light','dark'])for(const width of [1440,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(100);
    assert.equal(await run("const p=document.querySelector('.credit-payment-panel');return document.documentElement.scrollWidth<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1;"),true,`Credit panel fits ${width}/${theme}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await run("document.documentElement.dataset.theme='light';document.querySelector('.credit-payment-panel').scrollIntoView();return true;");await writeFile(path.join(profile,'credit-payments.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.credit-payment-panel');");assert.equal(await run(`return ${saved}.pos[0].creditPayments.length;`),2);
  await role('Finance');await navigate(`/finance/${po.id}`);assert.equal(await run("return !!document.querySelector('.finance-disbursement-form');"),false);
  await wait("return !!document.querySelector('.payment-coordination-form');");assert.equal(await run("return document.querySelector('.payment-coordination-form select[name=priority]').value;"),'Urgent','Priority survives verification and void');
  for(const theme of ['light','dark'])for(const width of [1440,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=800});await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);await sleep(100);
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`Finance detail fits ${width}/${theme}`);
  }
  await navigate('/finance');await wait("return !!document.querySelector('select[aria-label=\"Coordination status\"]')&&!!document.querySelector('.register tbody tr');");
  for(const width of [320,1440]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800});await sleep(100);assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`Finance queue fits ${width}`);}
  await run("document.documentElement.dataset.theme='light';return true;");await writeFile(path.join(profile,'finance-coordination.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

  await role('Project Manager');await navigate('/reports');await wait("return document.body.textContent.includes('Credit payment balances');");assert.equal(await run("return document.body.textContent.includes('Credit payment balances')&&document.body.textContent.includes('Overdue');"),true);
  console.log('Credit terms and Finance coordination smoke passed: due-date approval, issuance, unpaid delivery clearance, post-clearance proof failure/retry, partial/full payment, void history, overdue reporting, Finance restrictions, persistence and responsive controls. Screenshot: '+path.join(profile,'credit-payments.png'));
}finally{ws?.close();browser.kill();}
