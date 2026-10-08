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
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Procurement");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create(), page = pdf.addPage([595,842]), font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('MATERIAL REQUEST FORM', {x:45,y:780,size:21,font});
  page.drawText('Pasig City Rehabilitation', {x:45,y:742,size:14,font});
  page.drawText('MRF-379 | Requested by: Site Personnel', {x:45,y:700,size:12,font});
  page.drawText('Materials', {x:45,y:640,size:16,font});
  for(let i=0;i<8;i++)page.drawText(`${i+1}. Sample material - ${i+2} pieces`, {x:45,y:600-i*45,size:12,font});
  pdf.addPage([595,842]).drawText('Key plan - second page',{x:45,y:780,size:18,font});
  const bytes=Buffer.from(await pdf.save()).toString('base64');
  const fixture=seedDemo(), request=fixture.requests.find(r=>r.id==='m1');
  request.scopeDocument=undefined;
  request.documents=[{name:'Supporting MRF and key plan.pdf',type:'Supporting PDF',fileId:'gallery-pdf'}, {name:'Site photo.png',type:'image/png',fileId:'gallery-image'}, {name:'Missing legacy attachment.pdf',type:'application/pdf',fileId:'gallery-missing'}, {name:'Damaged PDF.pdf',type:'application/pdf',fileId:'gallery-broken'}];
  request.archive=undefined;request.correction=undefined;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  const seeded=await call('Runtime.evaluate',{expression:`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite'),s=t.objectStore('files');s.put(new Blob([Uint8Array.from(atob('${bytes}'),c=>c.charCodeAt(0))],{type:'application/pdf'}),'gallery-pdf');s.put(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),'gallery-image');s.put(new Blob(['%PDF-broken'],{type:'application/pdf'}),'gallery-broken');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();return true;})()`,awaitPromise:true,returnByValue:true});
  assert.equal(seeded.result.value,true);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/requests/m1');
  await wait("return !!document.querySelector('.document-gallery-page:not([hidden])');");
  assert.equal(await run("const c=document.querySelector('.document-gallery-page');return c.width>0&&c.height>0;"),true,'PDF worker renders a real first page');
  await run("document.querySelector('.document-gallery').scrollIntoView({block:'center'});return true;");
  await writeFile(path.join(profile,'gallery-desktop-light.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('.document-gallery-slide:not([inert]) .document-gallery-card');
  await wait("return !!document.querySelector('.document-gallery-modal[open] canvas:not([hidden])');");
  assert.equal(await run("return document.querySelector('.pdf-document-toolbar [aria-live=polite]').textContent;"),'of 2','Desktop modal renders the full PDF with page controls');
  assert.equal(await run("return document.querySelectorAll('.pdf-document-scroll .page').length;"),2,'All pages share a continuous scrolling viewer');
  await wait("return document.querySelectorAll('.pdf-document-thumbnail canvas:not([hidden])').length===2;");
  await click('[aria-label="Go to page 2"]');
  await wait("return document.querySelector('[aria-label=\"PDF page number\"]').value==='2'&&document.querySelector('[aria-label=\"Go to page 2\"]').getAttribute('aria-current')==='page';");
  await click('[aria-label="Go to page 1"]');
  await wait("return document.querySelector('[aria-label=\"PDF page number\"]').value==='1';");
  await click('[aria-label="Toggle thumbnails"]');
  assert.equal(await run("return !document.querySelector('.pdf-document-sidebar');"),true,'Thumbnail sidebar can be hidden');
  await click('[aria-label="Toggle thumbnails"]');
  await click('[aria-label="Find in document"]');
  await fill('[aria-label="Search PDF text"]','Key plan');
  await wait("return document.querySelector('.pdf-document-findbar [role=status]').textContent.includes('1 of 1 matches')&&document.querySelector('[aria-label=\"PDF page number\"]').value==='2';");
  await click('[aria-label="Find in document"]');
  await click('[aria-label="Previous page"]');
  await wait("return document.querySelector('[aria-label=\"PDF page number\"]').value==='1';");
  assert.equal(await run("return document.querySelector('[aria-label=\"Download PDF\"]').download;"),'Supporting MRF and key plan.pdf','Download retains the original filename');
  assert.equal(await run("return !document.querySelector('[aria-label=\"Print PDF\"]').disabled&&!!document.querySelector('[aria-label=\"Fullscreen\"]');"),true,'Print and fullscreen controls are available');
  await click('[aria-label="Rotate clockwise"]');
  await wait("const r=document.querySelector('.pdf-document-scroll .page').getBoundingClientRect();return r.width>r.height;");
  for(let i=0;i<3;i++)await click('[aria-label="Rotate clockwise"]');
  await click('.pdf-document-toolbar [aria-label="Next page"]');
  await wait("return document.querySelector('[aria-label=\"PDF page number\"]').value==='2'&&!!document.querySelector('.pdf-document-scroll .page[data-page-number=\"2\"] canvas');");
  await run("document.querySelector('.pdf-document-scroll').scrollTop=0;return true;");
  await wait("return document.querySelector('[aria-label=\"PDF page number\"]').value==='1';");
  await fill('[aria-label="PDF zoom"]','100');await sleep(150);
  const pageWidth=await run("return document.querySelector('.pdf-document-scroll .page').getBoundingClientRect().width;");
  await click('[aria-label="Zoom in"]');await sleep(150);
  assert.equal(await run("return document.querySelector('.pdf-document-scroll .page').getBoundingClientRect().width;" )>pageWidth,true,'Zoom changes actual page size');
  await fill('[aria-label="PDF zoom"]','page-width');await sleep(150);
  await click('.document-gallery-modal[open] button');
  assert.equal(await run("return document.activeElement.classList.contains('document-gallery-card');"),true,'Closing restores focus');
  await click('[aria-label="Next document"]');await sleep(450);
  assert.equal(await run("return document.querySelector('.document-gallery-caption strong').textContent;"),'Site photo.png');
  await click('.document-gallery-slide:not([inert]) .document-gallery-card');
  assert.equal(await run("return !!document.querySelector('.document-gallery-modal[open] .document-gallery-image-viewer img');"),true,'Legacy images open in the modal');
  await click('.document-gallery-modal[open] button');
  await click('[aria-label="Next document"]');await sleep(450);
  await wait("return document.querySelector('.document-gallery-slide:not([inert]) .document-gallery-card').disabled;");
  assert.equal(await run("return document.querySelector('.document-gallery-slide:not([inert])').textContent.includes('unavailable');"),true,'Missing attachments have an honest disabled fallback');
  await click('[aria-label="Next document"]');await sleep(450);
  await wait("return document.querySelector('.document-gallery-slide:not([inert])').textContent.includes('Page preview unavailable');");
  await click('.document-gallery-slide:not([inert]) .document-gallery-card');
  assert.equal(await run("return !!document.querySelector('.document-gallery-modal[open]');"),true,'A failed thumbnail still allows opening the source');
  await click('.document-gallery-modal[open] button');
  await click('[aria-label="Previous document"]');await sleep(450);
  await click('[aria-label="Previous document"]');await sleep(450);
  await click('[aria-label="Previous document"]');await sleep(450);
  for(const width of [1440,900,801,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<801});await sleep(200);
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.document-gallery').scrollIntoView({block:'center'});return true;`);await sleep(100);
      assert.equal(await run("const r=document.querySelector('.document-gallery').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1&&r.left>=0&&r.right<=innerWidth+1;"),true,`Gallery fits ${width}/${theme}`);
      if(width>=801){
        await click('.document-gallery-slide:not([inert]) .document-gallery-card');
        await wait("return !!document.querySelector('.document-gallery-modal[open] canvas:not([hidden])');");
        assert.equal(await run("const r=document.querySelector('.document-gallery-modal[open]').getBoundingClientRect();return r.left>=20&&innerWidth-r.right>=20&&r.top>=0&&r.bottom<=innerHeight;"),true,`Modal keeps clear viewport margins at ${width}/${theme}`);
        if(width===1440&&theme==='dark')await writeFile(path.join(profile,'gallery-modal-dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await click('.document-gallery-modal[open] button');
      }
      if(width===1440||width===375)await writeFile(path.join(profile,`gallery-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
  }
  await run("window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};return true;");
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await run("document.querySelector('.document-gallery').scrollIntoView({block:'center'});return true;");
  const touch=await run("const r=document.querySelector('.document-gallery-card').getBoundingClientRect();return {x:r.right-30,y:r.top+r.height/2};");
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
  for(let n=1;n<=6;n++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x-n*35,y:touch.y}]});await sleep(30);}
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(500);
  assert.equal(await run("return document.querySelector('.document-gallery-caption strong').textContent;"),'Site photo.png','Touch swipe advances to the next document');
  assert.equal(await run("return window.__opened.length;"),0,'Swiping never opens a document');
  await click('[aria-label="Previous document"]');await sleep(450);
  await click('.document-gallery-slide:not([inert]) .document-gallery-card');
  assert.equal(await run("return window.__opened.at(-1).startsWith('blob:')&&!document.querySelector('.document-gallery-modal[open]');"),true,'Mobile opens a local file before archive');
  request.status='approved';request.archive={status:'complete',approvedAt:'2026-10-07T00:00:00Z',versions:[{version:1,formFileId:'gallery-form',supportFileId:'gallery-support',formUrl:'https://drive.google.com/file/d/gallery-form/view',supportUrl:'https://drive.google.com/file/d/gallery-support/view',archivedAt:'2026-10-07T00:00:00Z'}]};
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1');
  await wait("return !document.querySelector('.document-gallery-card').disabled;");
  await run("window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};return true;");await click('.document-gallery-card');
  assert.equal(await run("return window.__opened.at(-1);"),request.archive.versions[0].supportUrl,'Mobile uses matching Drive document after archive');
  request.correction={status:'requested',scope:'documents',reason:'Replace supporting attachment'};
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1');
  await wait("return !!document.querySelector('.document-gallery-page:not([hidden])');");
  await run("window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};return true;");await click('.document-gallery-card');
  assert.equal(await run("return window.__opened.at(-1).startsWith('blob:');"),true,'Pending correction never opens an old Drive archive');
  request.documents=request.documents.slice(0,1);request.correction=undefined;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1');
  assert.equal(await run("return !!document.querySelector('.document-gallery-navigation');"),false,'Single file has no unnecessary navigation');
  request.documents=[];
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);await navigate('/requests/m1');
  assert.equal(await run("return !document.querySelector('.document-gallery')&&document.body.textContent.includes('No attachments recorded.');"),true,'Empty gallery has a clear state');
  console.log(`Document gallery smoke passed. Screenshots: ${profile}`);
} finally { ws?.close();browser.kill(); }
