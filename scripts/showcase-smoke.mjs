import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-showcase-"));
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
  let nextId = 0; const pending = new Map(), exceptions = [], driveCalls = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if(message.method==="Runtime.exceptionThrown")exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==="Network.requestWillBeSent"&&message.params.request.url.includes("/api/drive/"))driveCalls.push(message.params.request.url);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 600; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}; ${await run("return document.body.innerText.slice(0,600);")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable"); await call("Network.enable");
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Administrator");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const state = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  let seeded = await state();
  assert.equal(seeded.sites.length,5); assert.equal(seeded.requests.length,30); assert.equal(seeded.pos.length,45); assert.equal(seeded.batches.length,37);
  assert.ok(seeded.showcase); assert.ok(seeded.bidReports.every(r=>r.archive.status==='complete'&&r.pdf.archive.status==='complete'));
  const workbookBytes=await run(`return (async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('hml-quotation-files',1);r.onsuccess=()=>resolve(r.result)});const blob=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').get(${JSON.stringify(seeded.bidReports[0].localFileId)});r.onsuccess=()=>resolve(r.result)});db.close();return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))})()`);
  const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(workbookBytes,'base64'));
  const links=[];workbook.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value?.hyperlink)links.push(cell.value.hyperlink)})));
  assert.ok(links.some(link=>/^https?:\/\/[^/]+\/demo-files\//.test(link)),'Downloaded comparison has working absolute local source links');
  assert.equal(await run("const d=JSON.parse(localStorage.getItem('hml-constructsync-users-v1'));return d.users.filter(u=>u.active&&u.role==='Site Personnel').every(u=>u.siteIds.length===5);"),true);
  console.log('Checking local documents, role screens and persisted edits');
  const po = seeded.pos.find(p=>p.archive?.status==='complete');
  await navigate('/demo-files/'+po.archive.fileId);
  await wait("return !!document.querySelector('.pdfViewer .page canvas');");
  await navigate('/projects/'+seeded.sites[0].id);
  assert.equal(await run("return !!document.querySelector('input[aria-label=\"Search project documents\"]')&&!document.querySelector('.drive-project-files');"),true);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const switchRole = async label => {
    await click('.masthead-account');
    await run(`const button=[...document.querySelectorAll('.role-options button')].find(el=>el.querySelector('strong').textContent===${JSON.stringify(label)});button.click();return true;`);
    await wait(`return document.querySelector('.account-label small').textContent===${JSON.stringify(label)};`);
  };
  for(const [role,route] of [['Site Personnel','/inventory'],['Project Manager','/requests'],['Procurement','/purchase-orders'],['Finance','/finance'],['Logistics','/deliveries'],['Accounting','/accounting']]){
    console.log("Checking department",role);await switchRole(role);await navigate(route);
    assert.equal(await run("return document.querySelectorAll('.register:not(.is-embedded) tbody tr').length>0||document.querySelectorAll('.payment-coordination').length>0;"),true,role+' has visible work');
    await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(profile,role.replaceAll(/[^a-z]/gi,'-')+'.png'),Buffer.from(r.data,'base64')));
  }
  for(const theme of ['light','dark'])for(const route of ['/dashboard','/accounting']){
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await navigate(route);
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);
    assert.equal(await run('return document.documentElement.scrollWidth<=innerWidth+1;'),true,'Populated mobile page fits');
    await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(profile,`mobile-${route.slice(1)}-${theme}.png`),Buffer.from(r.data,'base64')));
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await run("document.documentElement.dataset.theme='light';return true;");
  console.log('Continuing upfront payment, credit settlement and transfer receipt workflows');
  const { PDFDocument } = await import('pdf-lib');const proofPdf=await PDFDocument.create();proofPdf.addPage().drawText('Demonstration payment confirmation - no real transaction');
  const proofPath=path.join(profile,'payment-confirmation.pdf');await writeFile(proofPath,await proofPdf.save());
  const upload=async selector=>{const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector});assert.ok(nodeId,'Upload input exists');await call('DOM.setFileInputFiles',{nodeId,files:[proofPath]});};
  const press=async label=>run(`const button=[...document.querySelectorAll('button')].find(el=>el.checkVisibility()&&el.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing '+${JSON.stringify(label)});button.click();return true;`);
  const confirm=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .button.primary');};
  const upfront=(await state()).pos.find(p=>p.status==='approved'&&p.issuance&&p.paymentMode==='upfront'&&!p.externalPayment);
  await navigate('/accounting/'+upfront.id);await upload('.external-payment-panel input[type=file]');
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.find(p=>p.id===${JSON.stringify(upfront.id)}).paymentProofs?.some(p=>p.archive.status==='complete');`);
  await fill('.external-payment-panel select[name=method]','Bank');await fill('.external-payment-panel input[name=reference]','DEMO-LIVE-UPFRONT');
  await press('Confirm full payment');await confirm();
  await wait(`return !!JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.find(p=>p.id===${JSON.stringify(upfront.id)}).externalPayment;`);
  await press('Confirm delivery clearance');await confirm();
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.find(p=>p.id===${JSON.stringify(upfront.id)}).status==='released';`);
  const credit=(await state()).pos.find(p=>p.status==='released'&&p.externalCredit&&p.creditPayments?.length);
  await navigate('/accounting/'+credit.id);await upload('.credit-payment-panel input[type=file]');
  await wait("return !!document.querySelector('.credit-proof-selection input');");
  await fill('.credit-payment-panel input[name=amount]',100);await fill('.credit-payment-panel select[name=method]','Bank');await fill('.credit-payment-panel input[name=reference]','DEMO-LIVE-CREDIT');await click('.credit-proof-selection input');
  await press('Verify payment');await confirm();
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.find(p=>p.id===${JSON.stringify(credit.id)}).creditPayments.length>${credit.creditPayments.length};`);
  const transfer=(await state()).transferDeliveries.find(d=>d.status==='posted');
  await navigate('/stock-transfers/'+transfer.transferId);await press('Retry receipt archive');
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries.find(d=>d.id===${JSON.stringify(transfer.id)}).receiptVersions.every(r=>r.archive.status==='complete');`);
  await switchRole('Project Manager');
  const request=(await state()).requests.find(r=>r.status==='submitted');
  await navigate('/requests/'+request.id);
  await run("const button=[...document.querySelectorAll('button')].find(el=>el.checkVisibility()&&el.textContent.trim()==='Approve request');if(!button)throw Error('Approve missing');button.click();return true;");
  await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click('.confirm-dialog[open] .button.primary');
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).requests.find(r=>r.id===${JSON.stringify(request.id)}).archive?.status==='complete';`);
  assert.equal((await state()).requests.find(r=>r.id===request.id).archive.versions.at(-1).formUrl.startsWith('/demo-files/'),true,'Approval generates and archives locally');
  await navigate('/dashboard');assert.equal((await state()).requests.find(r=>r.id===request.id).status,'approved','Edits survive reload without reseeding');
  await switchRole('Administrator');
  const directoryBefore=await run("return localStorage.getItem('hml-constructsync-users-v1');");
  // Replace an existing legacy workspace, with real existing IndexedDB bytes.
  const original=seedDemo();original.sites[0].budget=1234567;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(original))});localStorage.removeItem('hml-constructsync-showcase-installed-v1');return true;`);
  await run("return (async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['original evidence'],{type:'text/plain'}),'original-backup-file');tx.oncomplete=resolve;tx.onerror=reject});db.close();return true})()");
  await navigate('/dashboard');seeded=await state();
  const installation=seeded.showcase.installationId;
  const backup = await run("return (async()=>{const marker=JSON.parse(localStorage.getItem('hml-constructsync-showcase-installed-v1'));const db=await new Promise(resolve=>{const r=indexedDB.open('hml-constructsync-showcase-backups',1);r.onsuccess=()=>resolve(r.result)});const b=await new Promise(resolve=>{const r=db.transaction('backups').objectStore('backups').get(marker.backupId);r.onsuccess=()=>resolve(r.result)});db.close();const original=JSON.parse(b.records.find(([key])=>key==='hml-constructsync-demo-v12')[1]);return {budget:original.sites[0].budget,hasFile:b.files.some(f=>f.id==='original-backup-file'),directory:b.directory}})()");
  assert.equal(backup.budget,1234567);assert.equal(backup.hasFile,true);assert.equal(backup.directory,directoryBefore);
  assert.equal(await run(`const old=JSON.parse(${JSON.stringify(directoryBefore)}),current=JSON.parse(localStorage.getItem('hml-constructsync-users-v1'));return old.users.every(user=>JSON.stringify(user.credential)===JSON.stringify(current.users.find(u=>u.id===user.id).credential));`),true,'Credentials preserved');
  await navigate('/dashboard');assert.equal((await state()).showcase.installationId,installation,'Installation runs once');
  console.log('Checking interrupted installation, storage failure and clearing without reseeding');
  // Replaying a staged installation must restore its backup before installing.
  await run(`localStorage.setItem('hml-constructsync-showcase-installing-v1',${JSON.stringify(installation)});localStorage.removeItem('hml-constructsync-showcase-installed-v1');localStorage.setItem('hml-constructsync-demo-v12','interrupted write');return true;`);
  await navigate('/dashboard');
  assert.equal((await state()).sites.length,5);assert.equal(await run("return localStorage.getItem('hml-constructsync-showcase-installing-v1');"),null,'Interrupted journal recovered');
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(original))});localStorage.removeItem('hml-constructsync-showcase-installed-v1');return true;`);
  const fault=await call('Page.addScriptToEvaluateOnNewDocument',{source:"const realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='hml-constructsync-demo-v12'&&String(value).includes('installationId'))throw new DOMException('Simulated quota failure','QuotaExceededError');return realSet.call(this,key,value)};"});
  await call('Page.reload');
  await wait("return document.body?.innerText.includes('Simulated quota failure');");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).sites[0].budget;"),1234567,'Failed publish restores original records');
  assert.equal(await run("return localStorage.getItem('hml-constructsync-showcase-installed-v1');"),null,'Failed install is not marked complete');
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:fault.identifier});
  await navigate('/dashboard');
  await call('Page.navigate',{url:base+'/admin/maintenance'});
  await wait("return location.pathname==='/admin'&&!!document.querySelector('h1');");
  assert.equal(await run("return !!document.querySelector('a[href=\"/admin/maintenance\"]');"),false,'Normal workspace clearing is hidden');
  assert.equal((await state()).sites.length,5,'Retired maintenance route preserves workspace records');
  assert.deepEqual(driveCalls,[],'Local showcase never calls Drive endpoints');
  assert.deepEqual(exceptions,[],'No uncaught browser errors');
  console.log('Showcase smoke passed: initial population, local PDF/XLSX, department work, local approval archive, preservation and replacement backup. Screenshots:',profile);
} finally {ws?.close();browser.kill();}
