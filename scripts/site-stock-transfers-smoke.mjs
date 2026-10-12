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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { console.log("Checking " + route); await call("Page.navigate", { url: base + route }); await wait(`return location.pathname+location.search===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  const fixture=seedDemo(), request=fixture.requests.find(r=>r.id==='m1'), sourceSite=fixture.sites.find(site=>site.id!==request.siteId);
  fixture.pos=[];fixture.batches=[];fixture.movements=[];fixture.paymentRequests=[];fixture.payments=[];fixture.pendingAwards=[];fixture.stockTransfers=[];fixture.transferDeliveries=[];
  fixture.role='Procurement';request.status='approved';delete request.archive;delete request.correction;
  request.items=[{...request.items[0],id:'cement',name:'Cement',unit:'bag',quantity:100}];
  fixture.movements=[{id:'opening',siteId:sourceSite.id,itemName:'Spare cement bags',unit:'bag',quantity:80,kind:'opening',reason:'Opening stock',actor:'Site Personnel',at:'2026-10-12T00:00:00Z'}];
  fixture.sites.find(site=>site.id===request.siteId).driveFolderId='test-transfer-project-folder';
  const sourceQuote=fixture.quotes.find(quote=>quote.id==='q1');
  fixture.quotes=[{...sourceQuote,currency:'PHP',reviewStatus:'finalized',archive:{status:'complete',files:[]},financial:{vatStatus:'VAT',priceBasis:'exclusive',vatRate:12,reviewed:true},lines:[{id:'cement-offer',requestItemId:'cement',description:'Cement',quantity:100,unit:'bag',unitPrice:100,conversionFactor:1,matchConfirmed:true,brand:'',specification:'',varianceReason:'',discountType:'none',discountValue:0}]}];
  const state=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  await run("localStorage.setItem('hml-constructsync-demo-v12',"+JSON.stringify(JSON.stringify(fixture))+");return true;");
  const button=async text=>{await run("const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSON.stringify(text)+");if(!button)throw new Error('Missing button '+ "+JSON.stringify(text)+");button.click();return true;");await sleep(150);};
  const confirm=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(200);};
  const switchAccount=async name=>{await click('.masthead-account');await wait("return !!document.querySelector('.role-options');");await run("const button=[...document.querySelectorAll('.role-options button')].find(b=>b.textContent.includes("+JSON.stringify(name)+"));if(!button)throw new Error('Missing account');button.click();return true;");await sleep(200);};
  // Assign existing source personnel and create a separately assigned destination receiver through Administrator UI.
  await navigate('/dashboard');await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Administrator').name);await navigate('/admin');
  await wait("return !!document.querySelector('.user-row-actions');");
  const sourceName=ACCOUNT_FIXTURES.find(a=>a.role==='Site Personnel').name;
  await run("const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes("+JSON.stringify(sourceName)+"));row.querySelector('.user-row-actions button').click();return true;");
  await wait("return !!document.querySelector('.user-edit-form');");
  await click('.user-edit-form input[name=siteIds][value='+sourceSite.id+']');await click('.user-edit-form .button.primary');await confirm();
  await wait("return !document.querySelector('.user-edit-form');");
  await button('Add user');await wait("return !!document.querySelector('.user-edit-form');");
  await fill('.user-edit-form input[name=name]','Transfer destination receiver');await fill('.user-edit-form input[name=email]','transfer.receiver@example.test');await fill('.user-edit-form input[name=password]','TransferTest123!');
  await click('.user-edit-form input[name=siteIds][value='+request.siteId+']');await click('.user-edit-form .button.primary');await confirm();await wait("return !document.querySelector('.user-edit-form');");
  await switchAccount(account.name);await navigate('/requests/m1/quotes');await wait("return !!document.querySelector('.stock-sourcing-table');");
  await fill('select[aria-label="Source project"]',sourceSite.id);
  await fill('select[aria-label="Source stock for Cement"]',await run("return document.querySelector('select[aria-label=\"Source stock for Cement\"] option:nth-child(2)').value;"));
  await fill('input[aria-label="Transfer quantity for Cement"]',40);await click('input[aria-label="Confirm suitable stock for Cement"]');await button('Request source release');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers.length===1;");
  const transfer=(await state()).stockTransfers[0], route='/stock-transfers/'+transfer.id;
  await click('.procurement-steps button:nth-child(3)');await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.match(await run("return document.querySelector('.bid-fixed-quantity').parentElement.parentElement.parentElement.innerText;"),/To buy/);
  assert.equal(await run("return document.querySelector('.comparative-bid-table tbody .bid-fixed-quantity').textContent.startsWith('60');"),true);
  // Source account can approve but cannot receive for the destination.
  await switchAccount(sourceName);await navigate('/dashboard');assert.match(await run("return document.body.innerText;"),/Confirm stock release/);
  await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Confirm release for Cement\"]');");
  await button('Confirm stock release');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].status==='approved';");
  await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Logistics').name);await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Trip quantity for Spare cement bags\"]');");
  await fill('input[aria-label="Trip quantity for Spare cement bags"]',20);await button('Schedule trip');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries.length===1;");
  await button('Record dispatch');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].status==='dispatched';");
  assert.equal((await state()).movements.filter(m=>m.kind==='transfer-out').length,1);
  await switchAccount(sourceName);await navigate(route);assert.equal(await run("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirm receiving');"),false);
  // Mock Drive without touching company files; deliberately fail first receipt archive.
  let failArchive=true;
  await call('Fetch.enable',{patterns:[{urlPattern:'*/api/drive/transfer-receipts',requestStage:'Request'},{urlPattern:'*/api/drive/transfer-evidence',requestStage:'Request'}]});
  const originalMessage=ws.onmessage;ws.onmessage=async event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused'){const failed=failArchive&&data.params.request.url.includes('transfer-receipts');const response=failed?{error:'Simulated receipt archive failure'}:{driveFileId:'mock-transfer-receipt',url:'https://drive.google.com/file/d/mock-transfer-receipt/view'};await call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:failed?502:200,responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from(JSON.stringify(response)).toString('base64')});return;}originalMessage(event);};
  await switchAccount('Transfer destination receiver');await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Accepted quantity for Cement\"]');");
  await fill('input[aria-label="Accepted quantity for Cement"]',18);await fill('input[aria-label="Issue for Cement"]','Two bags damaged during transit');await button('Confirm receiving');await confirm();
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].receiptVersions[0].archive.error;");
  assert.equal((await state()).transferDeliveries[0].status,'confirmed','Archive failure does not undo receiving');
  await button('Post accepted stock');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].status==='posted';");
  assert.equal((await state()).movements.filter(m=>m.kind==='transfer-in')[0].quantity,18);
  failArchive=false;await button('Retry receipt archive');await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].receiptVersions[0].archive.status==='complete';");
  await run("const input=document.querySelector('input[type=file]');const files=new DataTransfer();files.items.add(new File(['%PDF-1.4\\nSigned transfer receipt'], 'Signed transfer receipt.pdf', {type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;");
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documents?.[0]?.archive.status==='complete';");
  await navigate('/inventory');await wait("return document.body.innerText.includes('Reserved');");assert.match(await run("return document.body.innerText;"),/Available/);
  await switchAccount(account.name);await navigate('/requests/m1/quotes');await wait("return !!document.querySelector('.stock-sourcing-table');");
  // Only two lost bags return to purchasing: 40 allocated minus 2 shortage => 62 to buy.
  await click('.procurement-steps button:nth-child(3)');await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.equal(await run("return document.querySelector('.comparative-bid-table tbody .bid-fixed-quantity').textContent.startsWith('62');"),true);
  for(const width of [1440,768,375,320])for(const theme of ['light','dark']){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    await run("localStorage.setItem('constructsync-theme',"+JSON.stringify(theme)+");document.documentElement.dataset.theme="+JSON.stringify(theme)+";return true;");
    await navigate(route);await wait("return !!document.querySelector('.transfer-review-table');");
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+2;"),true,'No page overflow '+width+'/'+theme);
    if(width===1440||width===375){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(profile,'transfer-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
  }
  await navigate('/deliveries');await wait("return document.body.innerText.includes('Site stock transfers');");
  await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Accounting / Auditing').name);await navigate('/accounting');await wait("return document.body.innerText.includes('Stock transfer document review');");
  await navigate(route);await wait("return document.body.innerText.includes('Accounting document review');");
  await run("const form=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Review status'));const el=form.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Complete');el.dispatchEvent(new Event('change',{bubbles:true}));return true;");
  await button('Save document review');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documentReview.status==='Complete';");
  console.log('Site transfer browser smoke passed: Administrator assignments, Procurement reservations and remaining comparison quantity, source approval, Logistics trip/dispatch, destination-only receiving, shortage/posting, archive failure/retry, signed evidence upload, Accounting completion, inventory columns and responsive themes. Screenshots: '+profile);
} finally {ws?.close();browser.kill();}
