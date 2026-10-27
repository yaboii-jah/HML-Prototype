import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../tests/fixtures/workspace.ts";
import { validTransferState } from "../src/domain/transfer-document.ts";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-registers-"));
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}\n${await run("return document.body.innerText.slice(-3500);")}`); };
  const navigate = async route => { console.log("Checking " + route); await call("Page.navigate", { url: base + route }); await wait(`return location.pathname+location.search===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  const fixture=seedDemo(), request=fixture.requests.find(r=>r.id==='m1'), sourceSite=fixture.sites.find(site=>site.id!==request.siteId);
  fixture.pos=[];fixture.batches=[];fixture.movements=[];fixture.paymentRequests=[];fixture.payments=[];fixture.pendingAwards=[];fixture.stockTransfers=[];fixture.transferDeliveries=[];
  fixture.role='Procurement';request.status='approved';delete request.archive;delete request.correction;
  request.items=[{...request.items[0],id:'cement',name:'Cement',unit:'bag',quantity:100}];
  fixture.movements=[{id:'opening',siteId:sourceSite.id,itemName:'Cement',unit:'bag',quantity:80,kind:'opening',reason:'Opening stock',actor:'Site Personnel',at:'2026-10-12T00:00:00Z'}];
  fixture.movements.push({...fixture.movements[0],id:'alternative-opening',itemName:'Cemnt',unit:'bags',quantity:30});
  const glassName='TEMPERED GLASS PANEL 10MM CLEAR, 900 X 2100MM, POLISHED EDGES AND STAINLESS STEEL FITTINGS';
  request.items.push({...request.items[0],id:'glass',name:glassName,unit:'PCS',quantity:12});
  fixture.movements.push({...fixture.movements[0],id:'glass-opening',itemName:glassName,unit:'PCS',quantity:12});
  const otherSource={...sourceSite,id:'site-c',documentCode:'SPARE',name:'Additional source project'};
  fixture.sites.push(otherSource);
  fixture.movements.push({...fixture.movements[0],id:'other-opening',siteId:otherSource.id,quantity:20});
  fixture.sites.find(site=>site.id===request.siteId).driveFolderId='test-transfer-project-folder';
  const sourceQuote=fixture.quotes.find(quote=>quote.id==='q1');
  fixture.quotes=[{...sourceQuote,currency:'PHP',reviewStatus:'finalized',archive:{status:'complete',files:[]},financial:{vatStatus:'VAT',priceBasis:'exclusive',vatRate:12,reviewed:true},lines:[{id:'cement-offer',requestItemId:'cement',description:'Cement',quantity:100,unit:'bag',unitPrice:100,conversionFactor:1,matchConfirmed:true,brand:'',specification:'',varianceReason:'',discountType:'none',discountValue:0}]}];
  fixture.movements.push({...fixture.movements[0],id:'destination-opening',siteId:request.siteId,itemName:'Cemnt',unit:'bags',quantity:12});
  const state=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  await run("localStorage.setItem('hml-constructsync-demo-v12',"+JSON.stringify(JSON.stringify(fixture))+");return true;");
  const button=async text=>{await run("const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSON.stringify(text)+");if(!button)throw new Error('Missing button '+ "+JSON.stringify(text)+");button.click();return true;");await sleep(150);};
  const confirm=async()=>{await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await sleep(200);};
  const switchAccount=async name=>{await click('.masthead-account');await wait("return !!document.querySelector('.role-options');");await run("const button=[...document.querySelectorAll('.role-options button')].find(b=>b.textContent.includes("+JSON.stringify(name)+"));if(!button)throw new Error('Missing account');button.click();return true;");await sleep(200);};
  // Start with explicit empty assignments, then exercise Administrator assignment controls.
  await run("const key='hml-constructsync-users-v1',d=JSON.parse(localStorage.getItem(key));for(const u of d.users.filter(u=>u.role==='Site Personnel'))u.siteIds=[];localStorage.setItem(key,JSON.stringify(d));return true;");
  // Assign existing source personnel and create a separately assigned destination receiver through Administrator UI.
  await navigate('/dashboard');await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Administrator').name);await navigate('/admin');await button('Users');
  await wait("return !!document.querySelector('.user-row-actions');");
  const sourceName=ACCOUNT_FIXTURES.find(a=>a.role==='Site Personnel').name;
  await run("const row=[...document.querySelectorAll('.admin-users tr')].find(r=>r.textContent.includes("+JSON.stringify(sourceName)+"));row.querySelector('.user-row-actions button').click();return true;");
  await wait("return !!document.querySelector('.user-edit-form');");
  await click('.user-edit-form input[name=siteIds][value='+sourceSite.id+']');await click('.user-edit-form .button.primary');await confirm();
  await wait("return !document.querySelector('.user-edit-form');");
  await button('Add user');await wait("return !!document.querySelector('.user-edit-form');");
  await fill('.user-edit-form input[name=name]','Transfer destination receiver');await fill('.user-edit-form input[name=email]','transfer.receiver@example.test');await fill('.user-edit-form input[name=password]','TransferTest123!');
  await click('.user-edit-form input[name=siteIds][value='+request.siteId+']');await click('.user-edit-form .button.primary');await confirm();await wait("return !document.querySelector('.user-edit-form');");
  await switchAccount(account.name);await navigate('/requests/m1/quotes');await wait("return !!document.querySelector('.stock-sourcing-table');");
  await fill('select[aria-label="Source project"]',sourceSite.id);
  assert.equal(await run("return [...document.querySelector('[data-stock-material=cement] select').options].some(o=>o.textContent==='Cemnt (bags)');"),true,'Differently named stock with a unit alias is available');
  const typoId=await run("return [...document.querySelector('[data-stock-material=cement] select').options].find(o=>o.textContent==='Cemnt (bags)').value;");
  await fill('[data-stock-material="cement"] select',typoId);
  await fill('[data-stock-material="cement"] input[type=number]',30);
  await button('Review selections');
  assert.match(await run("return document.querySelector('[data-stock-material=cement]').innerText;"),/Explain why/,'Differing names require an explanation');
  await fill('textarea[aria-label="Match explanation for Cemnt"]','Spelling differs; same cement grade and bag size');
  await button('Review selections');
  await wait("return !!document.querySelector('.record-dialog[open]');");
  assert.match(await run("return document.querySelector('.record-dialog[open]').innerText;"),/Requesting-site specification review/);
  await click('.record-dialog[open] .stock-final-verification input');
  await button('Send requests');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockSuitabilityReviews?.length===1;");
  assert.equal((await state()).stockTransfers.length,0,'Differing name waits for the requesting site');
  const stockSelector='[data-stock-material="cement"] select';
  const exactId=await run("return [...document.querySelector('[data-stock-material=cement] select').options].find(o=>o.textContent==='Cement (bag)').value;");
  await run("document.querySelector('[data-stock-material=cement] select').focus();return true;");
  assert.equal(await run("return document.activeElement.tagName;"),'SELECT','Stock selector accepts keyboard focus');
  await fill(stockSelector,exactId);
  await button('Review selections');
  assert.match(await run("return document.querySelector('[data-stock-selection]').innerText;"),/positive quantity/);
  assert.equal(await run("return document.activeElement===document.querySelector('[data-stock-selection] input[type=number]');"),true,'Validation focuses the invalid field');
  const exactChoice='[data-stock-selection]';
  assert.equal(await run("return document.querySelector('[data-stock-selection] input[type=number]').value;"),'','Quantity is entered manually');
  await fill(exactChoice+' input[type=number]',40);
  assert.match(await run("return document.querySelector('[data-stock-material=cement] .stock-match-control').innerText;"),/Matches description/);
  assert.equal(await run("return document.querySelectorAll('.stock-match-control input[type=checkbox]').length;"),0,'Routine row checkboxes removed');
  assert.equal(await run("return [...document.querySelectorAll('button')].some(b=>['Ask site to review','Cancel site review'].includes(b.textContent.trim()));"),false,'Optional site-review actions removed');
  assert.equal(await run("return !!document.querySelector('.stock-source-control textarea');"),false,'Draft explanation field removed');
  // Long descriptions remain readable and controls stay inside their cells.
  const glassSelector='[data-stock-material="glass"] select';
  const glassId=await run("return document.querySelector('[data-stock-material=glass] select').options[1].value;");
  await fill(glassSelector,glassId);
  assert.equal(await run("return document.querySelector('[data-stock-material=glass] select').title;"),glassName,'Full selected description remains available as a tooltip');
  assert.equal(await run("return document.querySelectorAll('.stock-selected-description').length;"),0,'Repeated stock descriptions removed');
  assert.equal(await run("return document.querySelector('[data-stock-material=glass] .stock-match-control button').textContent;"),'Remove','Remove sits below match status');
  for(const width of [1440,375]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    assert.equal(await run("const cell=document.querySelector('[data-stock-material=glass] .stock-source-control');const select=cell.querySelector('select').getBoundingClientRect();const balance=cell.querySelector('.stock-cell-note').getBoundingClientRect();return balance.top>=select.bottom&&cell.scrollWidth<=cell.clientWidth+1;"),true,'Stock availability stacks below selector '+width);
    assert.equal(await run("const button=document.querySelector('[data-stock-material=cement] .stock-match-control button');return getComputedStyle(button).borderTopStyle;"),'solid','Remove has a visible button border');
    if(width<700) assert.equal(await run("return getComputedStyle(document.querySelector('.stock-row-button')).minHeight;"),'44px','Phone actions retain touch targets');
    await run("document.activeElement.blur();document.querySelector('.mobile-close')?.click();document.querySelector('.stock-table-scroll').scrollLeft=0;document.querySelector('.stock-sourcing').scrollIntoView({block:'start'});return true;");
    await sleep(200);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(profile,'stock-table-long-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('[data-stock-material="glass"] .stock-match-control button');
  // Switching source projects preserves drafts and validation reveals hidden selections.
  await fill('select[aria-label="Source project"]',otherSource.id);
  assert.match(await run("return document.querySelector('[data-stock-material=glass]').innerText;"),/No stock matches this search and unit/s,'Empty results explain the next step');
  const otherId=await run("return document.querySelector('[data-stock-material=cement] select').options[1].value;");
  await fill(stockSelector,otherId);
  await fill('select[aria-label="Source project"]',sourceSite.id);
  assert.equal(await run("return document.querySelector('[data-stock-material=cement] input[type=number]').value;"),'40');
  await button('Review selections');
  assert.equal(await run("return document.querySelector('select[aria-label=\"Source project\"]').value;"),otherSource.id,'Invalid selection reveals its source project');
  assert.equal(await run("return document.activeElement===document.querySelector('[data-stock-material=cement] input[type=number]');"),true);
  await fill('[data-stock-material="cement"] input[type=number]',5);
  await fill('select[aria-label="Source project"]',sourceSite.id);
  await button('Review selections');
  assert.match(await run("return document.querySelector('.record-dialog[open]').innerText;"),/Additional source project/,'Combined review includes hidden project choices');
  await button('Edit selections');
  await fill('select[aria-label="Source project"]',otherSource.id);
  assert.equal(await run("return document.querySelector('[data-stock-material=cement] input[type=number]').value;"),'5');
  await click('[data-stock-material="cement"] .stock-match-control button');
  await fill('select[aria-label="Source project"]',sourceSite.id);
  // Draft persists through tabs and page reload, without reserving source stock or demand.
  await button('Supplier quotations');await click('.procurement-steps button:first-child');
  await wait("return !!document.querySelector('.stock-sourcing-table');");
  await navigate('/requests/m1/quotes');
  assert.equal(await run("return document.querySelector('[data-stock-selection] input[type=number]').value;"),'40');
  assert.equal((await state()).stockTransfers.length,0);
  // Older matching drafts marked for review now need fresh verification and source release.
  await run("const key=Object.keys(localStorage).find(k=>k.startsWith('constructsync-stock-draft-v1/')&&k.endsWith('/m1'));const draft=JSON.parse(localStorage.getItem(key));draft.choices[0].needsReview=true;draft.choices[0].matchConfirmed=true;draft.choices[0].explanation='';localStorage.setItem(key,JSON.stringify(draft));return true;");
  await navigate('/requests/m1/quotes');
  assert.match(await run("return document.querySelector('[data-stock-material=cement] .stock-match-control').innerText;"),/Matches description/,'Recovered matching draft routes to source release');
  // Older differing-description drafts require an explanation and requesting-site review.
  await run("const key=Object.keys(localStorage).find(k=>k.startsWith('constructsync-stock-draft-v1/')&&k.endsWith('/m1'));const draft=JSON.parse(localStorage.getItem(key));draft.choices.push({...draft.choices[0],id:'legacy-alternative-draft',sourceName:'Cemnt',quantity:'30',needsReview:true,explanation:''});localStorage.setItem(key,JSON.stringify(draft));return true;");
  await navigate('/requests/m1/quotes');
  await button('Review selections');
  assert.match(await run("return document.querySelector('[data-stock-selection=\"legacy-alternative-draft\"]').innerText;"),/Explain why/);
  assert.equal(await run("return !!document.querySelector('.record-dialog[open]');"),false,'Differing-description draft blocks submission');
  await click('[data-stock-selection="legacy-alternative-draft"] .stock-match-control button');
  await button('Review selections');
  await wait("return !!document.querySelector('.record-dialog[open]');");
  assert.match(await run("return document.querySelector('.record-dialog[open]').innerText;"),/40 bag/);
  assert.match(await run("return document.querySelector('.record-dialog[open]').innerText;"),/Source release request/);
  assert.doesNotMatch(await run("return document.querySelector('.record-dialog[open]').innerText;"),/Suitability review/,'Recovered review flag cannot create a new suitability review');
  for(const width of [1440,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    assert.equal(await run("const d=document.querySelector('.record-dialog[open]');return d.scrollWidth<=d.clientWidth+2;"),true,'Review dialog does not overflow '+width);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  assert.equal(await run("return document.querySelector('.record-dialog[open] .button.primary').disabled;"),true,'Matching selections require final verification');
  await click('.record-dialog[open] .stock-final-verification input');
  await button('Edit selections');
  await button('Review selections');
  assert.equal(await run("return document.querySelector('.record-dialog[open] .stock-final-verification input').checked;"),false,'Reopening review requires fresh verification');
  await click('.record-dialog[open] .stock-final-verification input');
  await button('Send requests');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers.length===1;");
  await wait("return [...document.querySelectorAll('.toast-success')].some(t=>t.textContent.includes('Stock requests sent.'));");
  assert.equal(await run("return !!document.querySelector('.stock-success');"),false,'Submission uses one bottom-right success notification');
  assert.equal((await state()).stockSuitabilityReviews[0].proposed,30);
  assert.equal((await state()).stockSuitabilityReviews.length,1,'New submissions leave the existing review unchanged');
  assert.equal((await state()).stockTransfers[0].lines[0].proposed,40);
  // Destination suitability approval does not reserve source stock; Procurement explicitly converts it.
  const reviewId=(await state()).stockSuitabilityReviews[0].id;
  await switchAccount(sourceName);await navigate('/requests/m1');
  assert.equal(await run("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirm same material');"),false);
  await switchAccount('Transfer destination receiver');await navigate('/dashboard');
  assert.match(await run("return document.body.innerText;"),/Review alternative stock/);
  await navigate('/requests/m1');
  assert.equal(await run("return [...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm same material').disabled;"),true,'Specification confirmation is required');
  await click('input[aria-label="Confirm same specifications for Cemnt"]');await button('Confirm same material');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockSuitabilityReviews[0].status==='approved';");
  assert.equal((await state()).stockTransfers.length,1);
  await switchAccount(account.name);await navigate('/requests/m1');
  await fill('input[aria-label="Release quantity for Cemnt"]',30);
  await button('Request stock release');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockSuitabilityReviews[0].status==='used';");
  assert.equal((await state()).stockTransfers.length,2);
  assert.equal((await state()).stockSuitabilityReviews[0].id,reviewId);
  await navigate('/requests/m1/quotes');
  const transfer=(await state()).stockTransfers[0], route='/stock-transfers/'+transfer.id;
  await click('.procurement-steps button:nth-child(3)');await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.match(await run("return document.querySelector('.bid-fixed-quantity').parentElement.parentElement.parentElement.innerText;"),/To buy/);
  assert.equal(await run("return document.querySelector('.comparative-bid-table tbody .bid-fixed-quantity').textContent.startsWith('30');"),true);
  // Source account can approve but cannot receive for the destination.
  await switchAccount(sourceName);await navigate('/dashboard');assert.match(await run("return document.body.innerText;"),/Confirm stock release/);
  await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Confirm release for Cement\"]');");
  await button('Confirm stock release');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].status==='approved';");
  await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Logistics').name);await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Trip quantity for Cement\"]');");
  assert.equal(await run("const form=document.querySelector('.transfer-schedule');return form.querySelector('input[type=date]').getBoundingClientRect().height===form.querySelector('input[name=evidence]').getBoundingClientRect().height;"),true,'Schedule fields have equal heights');
  assert.equal(await run("const section=document.querySelector('.transfer-schedule');const table=section.querySelector('.qa-bounded-table').getBoundingClientRect();const button=section.querySelector('.transfer-form-actions').getBoundingClientRect();return button.top-table.bottom>=15;"),true,'Schedule action has space above it');
  await fill('input[aria-label="Trip quantity for Cement"]',20);await button('Schedule trip');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries.length===1;");
  await button('Record dispatch');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].status==='dispatched';");
  assert.equal((await state()).movements.filter(m=>m.kind==='transfer-out').length,1);
  await switchAccount(sourceName);await navigate(route);assert.equal(await run("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirm receiving');"),false);
  // Mock Drive without touching company files; deliberately fail first receipt archive.
  let failArchive=true,failEvidence=true,delayArchive=true;
  const held=[];
  await call('Fetch.enable',{patterns:[{urlPattern:'*/api/drive/transfer-receipts',requestStage:'Request'},{urlPattern:'*/api/drive/transfer-evidence',requestStage:'Request'}]});
  const fulfillArchive=async request=>{
    const failed=request.request.url.includes('transfer-receipts')?failArchive:failEvidence;
    const response=failed?{error:'Simulated '+(request.request.url.includes('transfer-receipts')?'receipt':'evidence')+' archive failure'}:{driveFileId:'mock-transfer-receipt',url:'https://drive.google.com/file/d/mock-transfer-receipt/view'};
    await call('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:failed?502:200,responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from(JSON.stringify(response)).toString('base64')});
  };
  const releaseArchives=async()=>{delayArchive=false;for(const request of held.splice(0))await fulfillArchive(request);};
  const originalMessage=ws.onmessage;ws.onmessage=async event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused'){if(delayArchive)held.push(data.params);else await fulfillArchive(data.params);return;}originalMessage(event);};
  await switchAccount('Transfer destination receiver');await navigate(route);await wait("return !!document.querySelector('input[aria-label=\"Accepted quantity for Cement\"]');");
  assert.equal(await run("const section=document.querySelector('.transfer-trip');return section.querySelector('.qa-bounded-table').getBoundingClientRect().top-section.querySelector('.transfer-preview').getBoundingClientRect().bottom>=15;"),true,'Preview has space before trip table');
  await fill('input[aria-label="Accepted quantity for Cement"]',18);await fill('input[aria-label="Issue for Cement"]','Two bags damaged during transit');await button('Confirm receiving');await confirm();
  await wait("return !!document.querySelector('.transfer-document-row[aria-busy=true] .qa-spinner')&&!!document.querySelector('.archive-job[aria-busy=true]');");
  assert.equal((await state()).transferDeliveries[0].status,'confirmed','Receiving saves before archive completion');
  await releaseArchives();
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].receiptVersions[0].archive.error;");
  assert.equal((await state()).transferDeliveries[0].status,'confirmed','Archive failure does not undo receiving');
  await button('Post accepted stock');await confirm();
  await wait("return [...document.querySelectorAll('.inline-error')].some(e=>e.textContent.includes('Choose destination inventory'));");
  assert.equal((await state()).transferDeliveries[0].status,'confirmed','Posting requires an explicit destination choice');
  await fill('select[aria-label="Destination stock for Cement"]','new');
  await button('Post accepted stock');await confirm();
  await wait("return [...document.querySelectorAll('.inline-error')].some(e=>e.textContent.includes('Explain why a separate material'));");
  const targetId=await run("return [...document.querySelector('select[aria-label=\"Destination stock for Cement\"]').options].find(option=>option.textContent.startsWith('Cemnt (bags)')).value;");
  await fill('select[aria-label="Destination stock for Cement"]',targetId);
  await button('Post accepted stock');await confirm();
  await wait("return [...document.querySelectorAll('.inline-error')].some(e=>e.textContent.includes('Confirm the selected inventory'));");
  await click('input[aria-label="Confirm destination specifications for Cement"]');
  for (const width of [375,1440]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    assert.equal(await run('return document.documentElement.scrollWidth<=innerWidth+2;'),true,'Destination picker fits '+width);
    await run("document.activeElement.blur();document.querySelector('.mobile-close')?.click();document.querySelectorAll('.archive-job button').forEach(button=>button.click());return true;");
    await sleep(180);
    await run("document.querySelector('.transfer-stock-choice').scrollIntoView({block:'start'});window.scrollBy(0,-100);return true;");
    assert.equal(await run("const select=document.querySelector('[aria-label=\"Destination stock for Cement\"]');const rect=select.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&!document.querySelector('.mobile-scrim');"),true,'Destination selection remains visible '+width);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(profile,'stock-posting-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
  await button('Post accepted stock');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].status==='posted';");
  const mapped=await state();
  assert.equal(mapped.transferDeliveries[0].lines[0].stockPosting.materialId,targetId);
  assert.equal(mapped.movements.filter(value=>value.siteId===request.siteId&&value.itemName==='Cemnt'&&value.unit==='bags').reduce((sum,value)=>sum+value.quantity,0),30);
  assert.equal(validTransferState(mapped),true);

  assert.equal((await state()).movements.filter(m=>m.kind==='transfer-in')[0].quantity,18);
  await wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Retry receipt archive'&&!b.disabled);");
  failArchive=false;delayArchive=true;await button('Retry receipt archive');
  await wait("return !!document.querySelector('.transfer-document-row[aria-busy=true]');");
  await releaseArchives();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries[0].receiptVersions[0].archive.status==='complete';");
  await wait("return !document.querySelector('.transfer-upload input[type=file]').disabled;");
  delayArchive=true;
  await run("const input=document.querySelector('.transfer-upload input[type=file]');const files=new DataTransfer();files.items.add(new File(['%PDF-1.4\\nSigned transfer receipt'], 'Signed transfer receipt.pdf', {type:'application/pdf'}));files.items.add(new File(['%PDF-1.4\\nReceiving attachment'], 'Transfer receiving attachment.pdf', {type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;");
  await wait("return !!document.querySelector('.transfer-upload .qa-file-upload[aria-busy=true] .qa-spinner')&&!!document.querySelector('.archive-job progress');");
  assert.equal((await state()).stockTransfers[0].documents.length,2,'Multiple documents attach before archival');
  assert.equal(await run("return document.querySelector('.transfer-upload input[type=file]').disabled;"),true,'Upload controls lock while archiving');
  await releaseArchives();
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documents[0].archive.error;");
  assert.equal((await state()).stockTransfers[0].documents.length,2,'Failed archive retains both attachments');
  await wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Retry evidence archive'&&!b.disabled);");
  failEvidence=false;delayArchive=true;await button('Retry evidence archive');
  await wait("return !!document.querySelector('.transfer-document-row[aria-busy=true] .qa-spinner');");
  await releaseArchives();
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documents[0].archive.status==='complete';");
  await wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Retry evidence archive'&&!b.disabled);");
  await button('Retry evidence archive');
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documents.every(d=>d.archive.status==='complete');");
  assert.equal((await state()).stockTransfers[0].documents.length,2,'Retries reuse saved attachments');
  await navigate('/inventory');await wait("return document.body.innerText.includes('Reserved');");assert.match(await run("return document.body.innerText;"),/Available/);
  await switchAccount(account.name);await navigate('/requests/m1/quotes');await wait("return !!document.querySelector('.stock-sourcing-table');");
  // Only two lost bags return to purchasing: 70 allocated minus 2 shortage => 32 to buy.
  await click('.procurement-steps button:nth-child(3)');await wait("return !!document.querySelector('.comparative-bid-table');");
  assert.equal(await run("return document.querySelector('.comparative-bid-table tbody .bid-fixed-quantity').textContent.startsWith('32');"),true);
  for(const width of [1440,768,414,375,320])for(const theme of ['light','dark']){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    await run("localStorage.setItem('constructsync-theme',"+JSON.stringify(theme)+");document.documentElement.dataset.theme="+JSON.stringify(theme)+";return true;");
    await navigate('/requests/m1/quotes');await wait("return !!document.querySelector('.stock-sourcing-table');");
    assert.equal(await run("return getComputedStyle(document.querySelector('.stock-sourcing-table')).tableLayout;"),'fixed','Table spacing stylesheet is loaded');
    assert.equal(await run("return document.querySelectorAll('.stock-sourcing-table thead th').length;"),8,'Original eight table columns are retained');
    assert.equal(await run("return getComputedStyle(document.querySelector('.stock-sourcing-table thead th')).paddingTop;"),'12px','Compact vertical cell spacing');
    assert.equal(await run("return getComputedStyle(document.querySelector('.stock-sourcing-table thead th')).position;"),'sticky','Table header remains visible while scrolling');
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+2;"),true,'Sourcing has no page overflow '+width+'/'+theme);
    if(width===1440||width===375){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(profile,'stock-sourcing-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
    await navigate(route);await wait("return !!document.querySelector('.transfer-review-table');");
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+2;"),true,'No page overflow '+width+'/'+theme);
    if(width===1440||width===375){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(profile,'transfer-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
  }
  await navigate('/deliveries');await wait("return document.body.innerText.includes('Site stock transfers');");
  await switchAccount(ACCOUNT_FIXTURES.find(a=>a.role==='Accounting').name);await navigate('/accounting');await wait("return document.body.innerText.includes('Stock transfer document review');");
  await navigate(route);await wait("return document.body.innerText.includes('Accounting document review');");
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  assert.equal(await run("const section=document.querySelector('.transfer-accounting-review');const fields=[...section.querySelectorAll('.form-grid>.field')];return Math.abs(fields[0].getBoundingClientRect().top-fields[1].getBoundingClientRect().top)<=1;"),true,'Accounting fields align at the top');
  assert.equal(await run("return parseFloat(getComputedStyle(document.querySelector('.transfer-accounting-review textarea')).minHeight)>=88;"),true,'Review note has readable height');
  for(const width of [1440,768,414,375,320])for(const theme of ['light','dark']){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    await run("localStorage.setItem('constructsync-theme',"+JSON.stringify(theme)+");document.documentElement.dataset.theme="+JSON.stringify(theme)+";return true;");
    assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+2;"),true,'Accounting has no page overflow '+width+'/'+theme);
    assert.equal(await run("const section=document.querySelector('.transfer-accounting-review');const fields=[...section.querySelectorAll('.form-grid>.field')];return innerWidth<=768?fields[1].getBoundingClientRect().top>=fields[0].getBoundingClientRect().bottom+15:Math.abs(fields[0].getBoundingClientRect().top-fields[1].getBoundingClientRect().top)<=1;"),true,'Accounting fields align or stack with space '+width+'/'+theme);
    assert.equal(await run("return document.querySelectorAll('.transfer-upload .qa-file-upload').length===1&&document.querySelectorAll('.transfer-document-list .qa-document-record').length===3;"),true,'Shared uploader and document rows remain visible '+width+'/'+theme);
    if(width===1440||width===375){
      await run("document.querySelector('.transfer-documents').scrollIntoView({block:'start'});return true;");
      const uploadShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(profile,'transfer-documents-'+width+'-'+theme+'.png'),Buffer.from(uploadShot.data,'base64'));
      await run("document.querySelector('.transfer-accounting-review').scrollIntoView({block:'start'});return true;");
      const reviewShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(profile,'transfer-accounting-'+width+'-'+theme+'.png'),Buffer.from(reviewShot.data,'base64'));
    }
  }
  await run("const form=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Review status'));const el=form.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Complete');el.dispatchEvent(new Event('change',{bubbles:true}));return true;");
  await button('Save document review');await confirm();await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).stockTransfers[0].documentReview.status==='Complete';");
  console.log('Site sourcing and transfer browser smoke passed: eight-column table, manual quantities, automatic draft recovery, combined submission, destination suitability approval, Procurement conversion, Administrator assignments, Procurement reservations and remaining comparison quantity, source approval, Logistics trip/dispatch, destination-only receiving, shortage/posting, archive failure/retry, signed evidence upload, Accounting completion, inventory columns and responsive themes. Screenshots: '+profile);
} finally {ws?.close();browser.kill();}
