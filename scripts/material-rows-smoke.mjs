import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import { browserCallTimeout, navigateDocument } from "./helpers/browser-environment.mjs";
import { workspaceFixtureScript, openQuotationReview } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../tests/fixtures/workspace.ts";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-material-rows-"));
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, browserCallTimeout(method, 15000));
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}\n${JSON.stringify(await run("return {url:location.href,text:document.body.innerText.slice(-1800),role:JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')||'null')?.role};"))}`); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Procurement");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  const fixture = seedDemo();
  const request = fixture.requests.find(r => r.id === 'm1');
  request.archive = undefined;
  fixture.pos = fixture.pos.filter(po => po.mrfId !== request.id);
  fixture.batches = fixture.batches.filter(batch => fixture.pos.some(po => po.id === batch.poId));
  const quote = fixture.quotes.find(q => q.id === 'q1');
  quote.financial = {vatStatus:'VAT',priceBasis:'inclusive',vatRate:12,reviewed:true};
  quote.archive = {status:'complete',files:[]};
  fixture.pendingAwards = [{id:'row-award',requestId:'m1',itemId:request.items[0].id,quoteId:quote.id,quoteLineId:quote.lines[0].id,supplierId:quote.supplierId,quantity:5}];
  const load = async (route, role='Procurement', data=fixture) => {
    await run(workspaceFixtureScript(data, role));
    await navigateDocument(call,base+route);
    await wait(`return location.pathname+location.search===${JSON.stringify(route)}&&!!document.querySelector('h1');`);
    await sleep(250);
    if(route.endsWith("/quotes")){await run(openQuotationReview);await sleep(160);}
  };
  const openCount = () => run("return document.querySelectorAll('dialog[open]').length;");
  const escape = async () => { await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150); };
  const noModal = async label => assert.equal(await openCount(),0,label);
  const closeRecord = () => click('.record-dialog[open] .record-modal-close');
  const cellClick = async selector => { await run(`const cell=document.querySelector(${JSON.stringify(selector)});if(!cell)throw Error('Missing cell '+${JSON.stringify(selector)});cell.click();return true;`); await wait("return !!document.querySelector('dialog[open]');"); };
  const textSelection = async (row, cell) => {
    await run(`const el=document.querySelector(${JSON.stringify(cell)});const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);document.querySelector(${JSON.stringify(row)}).click();return true;`);
    await sleep(100);await noModal('Selecting row text does not open details');await run('getSelection().removeAllRanges();return true;');
  };

  await load('/requests/m1');
  await wait("return !!document.querySelector('.request-materials-panel .material-details-row');");
  await cellClick('.request-materials-panel tbody td.numeric');
  assert.equal(await run("return document.querySelector('.material-view-dialog[open] h2').textContent;"),request.items[0].name);
  await escape();
  assert.equal(await run("return document.activeElement.matches('.request-materials-panel [data-material-details-trigger]');"),true,'Request row restores material focus');
  await click('.request-materials-panel button[aria-label="View material 1"]');await escape();
  await textSelection('.request-materials-panel tbody tr','.request-materials-panel tbody td.numeric');

  await load('/requests/new','Site Personnel');
  await wait("return !!document.querySelector('#scopeId');");
  await fill('#scopeId','site-a-scope');
  for(const id of ['requestedBy','approvedBy','purchaser','financeOfficer'])await fill('#'+id,'Sample Person');
  await click('.request-wizard-actions button[type=button].primary');
  await wait("return document.querySelector('.materials-panel').checkVisibility();");
  await cellClick('.materials-panel tbody td.numeric');
  await wait("return !!document.querySelector('.material-edit-dialog[open]');");
  await fill('.material-edit-dialog input[name^=material-]','Sample clickable material');
  await fill('.material-edit-dialog input[name^=location-]','Site staging');
  await click('.material-edit-dialog .button.primary');
  await click('.materials-panel button[aria-label="Edit material 1"]');await escape();
  await click('.request-wizard-actions button[type=button].primary');
  await wait("return document.querySelector('.request-review-table').checkVisibility();");
  await cellClick('.request-review-table td.numeric');await escape();
  console.log('Request creation, review and request details passed.');

  const draftData = structuredClone(fixture);draftData.quotes.find(q=>q.id==='q1').reviewStatus='draft';
  await load('/requests/m1/quotes','Procurement',draftData);
  await wait("return !!document.querySelector('.quote-editor-lines .material-details-row');");
  await click('.quote-editor-lines input[type=number]');await noModal('Inline quantity input stays editable');
  await click('.quote-editor-lines textarea');await noModal('Inline description stays editable');
  await cellClick('.quote-editor-lines td[data-label="Amount"]');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('Quoted quantity');"),true);
  await closeRecord();
  assert.equal(await run("return document.activeElement.matches('[data-material-details-trigger]');"),true,'Quotation row restores material focus');
  await click('.quote-editor-lines [data-line-details]');await closeRecord();
  assert.equal(await run("return document.activeElement.hasAttribute('data-line-details');"),true,'Existing Details button restores focus');
  await click('.quote-editor-lines button[aria-label="Delete line 1"]');
  assert.equal(await run("return !!document.querySelector('.confirm-dialog[open]')&&!document.querySelector('.record-dialog[open]');"),true,'Delete opens only its confirmation');await escape();
  console.log('Quotation row clicks, buttons, inline fields and delete isolation passed.');

  await load('/requests/m1/quotes?materialId='+request.items[0].id);
  await wait("return document.querySelector('.comparative-bid-table').checkVisibility();");
  await cellClick('.comparative-bid-table td.numeric');await closeRecord();
  await click('.bid-offer-price .text-link');await closeRecord();
  await click('[data-split-material]');await click('.comparison-split input');
  assert.equal(await openCount(),1,'Award input stays inside its quantity dialog without opening details');await closeRecord();
  await click('.comparative-bid-toolbar>.button');
  await wait("return !!document.querySelector('.record-dialog[open] .allocation-review');");
  await cellClick('.allocation-review tbody td:nth-child(2)');
  await wait("return !!document.querySelector('.record-dialog[open] h3');");
  assert.equal(await openCount(),1,'Allocation review suspends before opening offer details');
  await closeRecord();
  await wait("return !!document.querySelector('.record-dialog[open] .allocation-review');");
  assert.equal(await openCount(),1,'Closing offer details restores exactly one review modal');
  await closeRecord();
  console.log('Supplier comparison and allocation modal restoration passed.');

  const deliveryData = seedDemo();deliveryData.batches.find(b=>b.id==='b2').status='dispatched';
  const schedulingData = structuredClone(deliveryData);schedulingData.batches = schedulingData.batches.filter(batch => batch.id !== 'b2');
  await load('/deliveries/new?poId=po1','Logistics',schedulingData);
  await wait("return !!document.querySelector('[aria-label="+'"Goods to schedule"'+"] .material-details-row');");
  await fill('input[name^=expected-]',12);await click('input[name^=expected-]');await noModal('Schedule input does not open details');
  await cellClick('[aria-label="Goods to schedule"] tbody td:nth-child(3)');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('12 bag');"),true,'Scheduling details reflect inline edits');await closeRecord();
  await load('/deliveries/b2','Site Personnel',deliveryData);
  await wait("return !!document.querySelector('[aria-label="+'"Received material quantities"'+"] .material-details-row');");
  await fill('input[name^=accepted-]',35);await fill('input[name^=issue-]','Five bags damaged');await click('input[name^=issue-]');await noModal('Receiving note stays editable');
  await cellClick('[aria-label="Received material quantities"] tbody td:nth-child(2)');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('35 bag')&&document.querySelector('.record-dialog[open]').textContent.includes('Five bags damaged');"),true,'Receiving details reflect unsaved quantities and notes');await closeRecord();
  deliveryData.batches.find(b=>b.id==='b2').status='confirmed';deliveryData.batches.find(b=>b.id==='b2').lines[0].accepted=35;
  await load('/deliveries/b2','Site Personnel',deliveryData);
  await fill('input[name^=post-]',33);
  await cellClick('[aria-label="Site stock posting quantities"] tbody td:nth-child(2)');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('63 bag');"),true,'Stock details use live posting preview');await closeRecord();
  console.log('Delivery scheduling, receiving and stock posting details passed.');

  await load('/accounting/po3','Accounting',deliveryData);
  await wait("return !!document.querySelector('[aria-label="+'"Editable purchase order materials"'+"] .material-details-row');");
  await fill('input[aria-label="PO quantity 1"]',12);await click('input[aria-label="PO quantity 1"]');await noModal('PO quantity stays editable');
  await cellClick('[aria-label="Editable purchase order materials"] tbody td:nth-child(5)');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('12 sheet');"),true,'PO details use live draft quantity');await closeRecord();
  await click('[aria-label="Remove PO material 1"]');
  assert.equal(await run("return !!document.querySelector('.confirm-dialog[open]')&&!document.querySelector('.record-dialog[open]');"),true);await escape();
  console.log('Accounting PO material details and action isolation passed.');

  await load('/inventory','Site Personnel',deliveryData);
  await wait("return !!document.querySelector('.register .material-details-row');");
  await cellClick('.register tbody td:nth-child(3)');
  assert.equal(await run("return document.querySelector('.record-dialog[open]').textContent.includes('30 bag');"),true,'Inventory opens current balance');
  assert.ok(await run("return document.querySelector('.record-dialog[open] a').getAttribute('href').startsWith('/inventory/');"));
  await escape();
  assert.equal(await run("return document.activeElement.matches('[data-material-details-trigger]');"),true);
  await textSelection('.register tbody tr','.register tbody td:nth-child(3)');
  await run("document.querySelector('[data-material-details-trigger]').focus();return true;");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("return !!document.querySelector('.record-dialog[open]');");await escape();
  for(const width of [1440,375])for(const theme of ['light','dark']){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await run(`localStorage.setItem('constructsync-theme',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);
    await cellClick('.register tbody td:nth-child(3)');
    assert.equal(await run("const r=document.querySelector('.record-dialog[open]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;"),true,`Details fit ${width}/${theme}`);
    await writeFile(path.join(profile,`inventory-material-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));await closeRecord();
  }
  console.log(`Material rows smoke passed: every targeted table, retained buttons, live details, control isolation, text selection, keyboard/focus and responsive modals. Screenshots: ${profile}`);
} finally { ws?.close(); browser.kill(); }
