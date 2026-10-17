// Audit-only copy: relative imports adjusted; explicitly open Upload & review after route entry. Original suite unchanged.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../../src/app-state/demo-session.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { seedDemo } from "../../src/mock/fixtures/seed.ts";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-worksheet-"));
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
    const result = await call("Runtime.evaluate", { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");const account=ACCOUNT_FIXTURES.find(a=>a.role==='Procurement');await fill('#signin-email',account.email);await fill('#signin-password',account.password);await click('.signin-form button');await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");

  const fixture = seedDemo(), request = fixture.requests.find(value => value.id === 'm1'), original = fixture.quotes.find(value => value.id === 'q1');
  const names = ['CONCRETE PRIMER, WATER-BASED, 16 L', 'INTERIOR LATEX PAINT, WHITE, 16 L', 'ACRYLIC WALL PUTTY, 20 KG', 'PORCELAIN FLOOR TILE, 600 X 600 MM', 'TILE ADHESIVE, 25 KG', 'TILE GROUT, WHITE, 2 KG', 'FIBER CEMENT BOARD, 6 MM', 'METAL STUD, 50 MM X 3 M'];
  request.status='approved';request.archive=undefined;request.correction=undefined;
  request.items=names.map((name,index)=>({...request.items[0],id:`worksheet-item-${index+1}`,name,quantity:12,unit:'PAIL'}));
  fixture.role='Procurement';fixture.pos=fixture.pos.filter(po=>po.mrfId!==request.id);fixture.batches=fixture.batches.filter(batch=>fixture.pos.some(po=>po.id===batch.poId));
  fixture.quotes=fixture.quotes.filter(quote=>quote.mrfId!==request.id);
  const makeLine=index=>({id:`worksheet-line-${index+1}`,description:names[index],quantity:12,unit:'PAIL',unitPrice:1250,brand:'',specification:'',requestItemId:request.items[index].id,conversionFactor:1,varianceReason:'',matchConfirmed:false,matchConfidence:'high',discountType:'none',discountValue:0,taxRate:0,printedTotal:null});
  for(let index=0;index<5;index++)fixture.quotes.push({...structuredClone(original),id:`worksheet-${index}`,ref:`QUOTE-${index+1}`,supplierDetails:{name:`Supplier ${index+1}`,address:'',tin:'',contactName:'',email:'',phone:''},reviewStatus:'draft',currency:'PHP',extraction:'gemini',financial:{vatStatus:'VAT',priceBasis:'inclusive',vatRate:12,reviewed:true},documents:[{fileId:'worksheet-pdf',name:'Supplier quotation.pdf',type:'application/pdf'},{fileId:'worksheet-image',name:'Supplier image.png',type:'image/png'},{fileId:'worksheet-missing',name:'Unavailable source.pdf',type:'application/pdf'}],adjustments:[],lines:names.map((_,i)=>makeLine(i)),archive:undefined});
  const quote=fixture.quotes.find(value=>value.id==='worksheet-0');
  quote.lines[1].quantity=8;quote.lines[2].matchConfidence='low';quote.lines[3].unit='BOX';quote.lines[3].varianceReason='Checked pack size';quote.lines[4].printedTotal=14000;quote.lines[5].quantity=0;quote.lines[5].unitPrice=0;quote.lines[7].matchConfirmed=true;
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let page=0;page<2;page++){const sheet=pdf.addPage([420,595]);sheet.drawText('SUPPLIER QUOTATION',{x:30,y:555,size:18,font});sheet.drawText(`Source page ${page+1} of 2`,{x:30,y:525,size:12,font});for(let i=0;i<4;i++){sheet.drawText(names[page*4+i],{x:30,y:470-i*90,size:10,font});sheet.drawText('12 PAIL   x   PHP 1,250.00   =   PHP 15,000.00',{x:30,y:447-i*90,size:10,font});}}
  const bytes=Buffer.from(await pdf.save()).toString('base64');
  await run(`const open=indexedDB.open('hml-quotation-files',1);const db=await new Promise((resolve,reject)=>{open.onupgradeneeded=()=>open.result.createObjectStore('files');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,600);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('Supplier quotation image',40,60);const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],{type:'application/pdf'}),'worksheet-pdf');tx.objectStore('files').put(image,'worksheet-image');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate('/requests/m1/quotes');await run("[...document.querySelectorAll('.procurement-steps button')].find(b=>b.textContent.includes('Upload & review')).click();return true;");await sleep(160);
  const sheet=()=>run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='worksheet-0');");
  const fillAny=async(selector,value)=>run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  await run(`window.quotationContrast=(selector,property='color',backgroundSelector=selector)=>{
    const element=document.querySelector(selector),backgroundElement=document.querySelector(backgroundSelector);
    if(!element||!backgroundElement)throw Error('Missing contrast target: '+selector);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
    const pixel=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
    const layers=[];for(let parent=backgroundElement;parent;parent=parent.parentElement)layers.unshift(pixel(getComputedStyle(parent).backgroundColor));
    const background=layers.reduce((base,color)=>base.map((channel,index)=>channel*(1-color[3]/255)+color[index]*color[3]/255),[255,255,255]);
    const foreground=pixel(getComputedStyle(element).getPropertyValue(property));
    const composite=background.map((channel,index)=>channel*(1-foreground[3]/255)+foreground[index]*foreground[3]/255);
    const luminance=color=>color.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const values=[luminance(composite),luminance(background)];return (Math.max(...values)+.05)/(Math.min(...values)+.05);
  };return true;`);
  const checkContrast=async(selector,label,minimum=4.5,property='color',background=selector)=>{
    const ratio=await run(`return window.quotationContrast(${JSON.stringify(selector)},${JSON.stringify(property)},${JSON.stringify(background)});`);
    assert.ok(ratio>=minimum,`${label}: contrast ${ratio.toFixed(2)}:1 must reach ${minimum}:1`);return ratio;
  };
  await wait("return !!document.querySelector('.quote-source-panel .pdf-document-toolbar input:not(:disabled)');");
  assert.deepEqual(await run("return [...document.querySelectorAll('.quote-editor-lines th')].map(el=>el.textContent);"),['#','Material','Quantity','Unit','Unit price','Amount','Item match','Actions']);
  assert.equal(await run("return document.querySelectorAll('.quote-editor-lines tbody tr').length;"),8);
  await wait("return document.querySelector('.quote-source-panel .pdf-document-scroll')?.getAttribute('aria-busy')==='false';");await run("document.querySelector('.quote-material-workspace').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;");await writeFile(path.join(profile,'worksheet-initial-1440.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.equal(await run("return !!document.querySelector('.quote-editor-pagination .register-page-controls')||!!document.querySelector('.quote-editor-pagination button');"),false,'Small quotations have no pagination buttons');
  assert.equal(await run("return document.querySelector('[data-line-id=worksheet-line-1]').classList.contains('needs-review');"),false,'Unconfirmed item links stay neutral');
  assert.equal(await run("return document.querySelector('[data-line-id=worksheet-line-2] .quote-requested-quantity').textContent;"),'Requested: 12');
  assert.equal(await run("return document.querySelector('.quote-editor-lines').textContent.includes('confidence');"),false,'Raw AI confidence is moved into Details');
  await run("window.sourceViewer=document.querySelector('.quote-source-panel .pdf-document-viewer');return true;");
  await fillAny('#quote-worksheet-0-worksheet-line-1-unitPrice','1300');await sleep(120);
  assert.equal(await run("return window.sourceViewer===document.querySelector('.quote-source-panel .pdf-document-viewer');"),true,'Inline saves retain the PDF viewer instance');
  assert.equal(await run("return document.querySelector('.quote-material-review-actions button').textContent;"),'Confirm eligible matches (2)');
  await fillAny('[aria-label="Search materials in QUOTE-1"]','CONCRETE');await sleep(100);
  await click('.quote-material-review-actions button');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click('.confirm-dialog[open] .confirm-actions button:first-child');assert.equal((await sheet()).lines[0].matchConfirmed,false,'Cancel never confirms matches');
  await click('.quote-material-review-actions button');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return !!document.querySelector('.quote-match-report');");
  let saved=await sheet();assert.deepEqual(saved.lines.map(line=>line.matchConfirmed),[true,false,false,false,false,false,true,true],'Only eligible links are confirmed, including lines outside the filter');
  assert.equal(saved.lines[1].quantity,8,'Partial offers keep their quoted quantity');
  assert.match(await run("return document.querySelector('.quote-match-report').textContent;"),/5 lines need individual review/);
  assert.equal(await run("return window.sourceViewer===document.querySelector('.quote-source-panel .pdf-document-viewer');"),true,'Bulk confirmation keeps the source loaded');
  await fillAny('[aria-label="Search materials in QUOTE-1"]','');await sleep(100);
  await run("document.querySelector('#quote-worksheet-0-worksheet-line-1-quantity').focus();return true;");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait("return document.activeElement.id==='quote-worksheet-0-worksheet-line-2-quantity';");
  assert.equal(await run("return !!document.querySelector('.record-dialog[open]')||!!document.querySelector('.confirm-dialog[open]');"),false,'Enter advances the column without opening a modal');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await run("return document.activeElement.id;"),'quote-worksheet-0-worksheet-line-2-unit','Tab follows worksheet fields');
  await click('[aria-label="Details for line 3"]');assert.match(await run("return document.querySelector('.quote-material-details').textContent;"),/AI match confidence\s*low/);await click('.record-dialog[open] .record-modal-close');
  await click('.quote-source-panel .quote-source-picker button');await wait("return !!document.querySelector('.quote-documents-dialog[open]');");await click('.quote-documents-dialog[open] [aria-label="Close document preview"]');
  assert.equal(await run("return document.activeElement.textContent;"),'Expand source','Closing expanded source restores the trigger');
  await fillAny('[aria-label="Source document"]','1');await wait("return !!document.querySelector('.quote-source-panel .loading-image img');");await fillAny('[aria-label="Image zoom"]','150');
  assert.equal(await run("return document.querySelector('.quote-source-image').style.width;"),'150%');
  await fillAny('[aria-label="Source document"]','2');await wait("return document.querySelector('.quote-source-panel').textContent.includes('unavailable');");
  assert.equal(await run("return !document.querySelector('#quote-worksheet-0-worksheet-line-2-quantity').disabled;"),true,'Missing files leave review usable');
  await click('.quote-source-panel header button');assert.equal(await run("return !!document.querySelector('.quote-source-panel');"),false);await click('.quote-material-review-actions button:last-child');
  await fillAny('[aria-label="Source document"]','0');await wait("return !!document.querySelector('.quote-source-panel .pdf-document-toolbar input:not(:disabled)');");
  await fillAny('.quote-source-panel [aria-label="PDF page number"]','2');await run("document.querySelector('.quote-source-panel [aria-label=\"PDF page number\"]').blur();return true;");await sleep(100);assert.equal(await run("return document.querySelector('.quote-source-panel [aria-label=\"PDF page number\"]').value;"),'2');
  await fillAny('.quote-source-panel [aria-label="PDF zoom"]','150');await sleep(100);assert.equal(await run("return document.querySelector('.quote-source-panel [aria-label=\"PDF zoom\"]').value;"),'150');
  await click('.quotation-view-modes button:last-child');assert.equal(await run("return document.querySelectorAll('.quote-source-panel').length;"),0,'All quotations never mounts multiple source viewers');await click('.quotation-view-modes button:first-child');
  await click('[data-quote-id="worksheet-1"]');await wait("return document.querySelector('.quote-review').dataset.quotationId==='worksheet-1';");await click('.quote-material-review-actions button');await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await run("const key='hml-constructsync-demo-v12',data=JSON.parse(localStorage.getItem(key));data.quotes.find(q=>q.id==='worksheet-1').lines.forEach(line=>line.matchConfidence='low');localStorage.setItem(key,JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(data)}));return true;");await sleep(150);await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return document.querySelector('.quote-match-report')?.textContent.includes('No eligible matches remain');");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='worksheet-1').lines.some(line=>line.matchConfirmed);"),false,'Confirmation recomputes eligibility after concurrent data changes');
  await click('[data-quote-id="worksheet-2"]');
  await run("const key='hml-constructsync-demo-v12',data=JSON.parse(localStorage.getItem(key));data.quotes.find(q=>q.id==='worksheet-2').supersedesId='unavailable-finalized-revision';localStorage.setItem(key,JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(data)}));return true;");await sleep(150);
  await click('.quote-material-review-actions button');await wait("return !!document.querySelector('.confirm-dialog[open]');");await click('.confirm-dialog[open] .confirm-actions button:last-child');await wait("return document.querySelector('.quote-match-report')?.textContent.includes('could not be saved');");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).quotes.find(q=>q.id==='worksheet-2').lines.some(line=>line.matchConfirmed);"),false,'Rejected saves leave item confirmations unchanged');
  await click('[data-quote-id="worksheet-0"]');
  const warningRow='[data-line-id="worksheet-line-5"]',invalidRow='[data-line-id="worksheet-line-6"]';
  const themeSurfaces={};let minimumTextContrast=Infinity;
  await call('DOM.enable');await call('CSS.enable');
  for(const width of [1600,1440,1280,1200,768,414,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=800});await sleep(150);
    for(const theme of ['light','dark']){
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.quote-material-workspace').scrollIntoView({block:'start'});window.scrollBy(0,-80);return true;`);await sleep(100);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,`No page overflow at ${width}/${theme}`);
      assert.equal(await run("return !!document.querySelector('.quote-source-panel');"),width>=1280,`Responsive source pane at ${width}/${theme}`);
      assert.equal(await run("const frame=document.querySelector('.quote-editor-lines');frame.scrollLeft=100;return frame.scrollWidth>frame.clientWidth&&frame.scrollLeft>0;"),true,'Horizontal scrolling stays functional');
      for(const selector of [`${warningRow} .quote-number-cell>strong`,`${warningRow} .quote-printed-difference`,`${warningRow} .quote-review-note`,`${warningRow} .quote-check`,`${warningRow} .quote-requested-item>span`,`${warningRow} .quote-line-number`,`${invalidRow} .field-error`,`${invalidRow} input[aria-invalid=true]`])minimumTextContrast=Math.min(minimumTextContrast,await checkContrast(selector,`${width}/${theme} warning text`));
      for(const field of ['quantity','unitPrice'])await checkContrast(`#quote-worksheet-0-worksheet-line-6-${field}`,`${theme} invalid ${field} border`,3,'border-top-color');
      assert.equal(await run(`return getComputedStyle(document.querySelector('${warningRow}>td:first-child')).boxShadow!=='none';`),true,'Warning rows retain an edge indicator without a layout shift');
      if(width===1440){
        const normal=await run(`return getComputedStyle(document.querySelector('${warningRow}')).backgroundColor;`);themeSurfaces[theme]=normal;
        const {root}=await call('DOM.getDocument'),{nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:warningRow});
        await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
        assert.notEqual(await run(`return getComputedStyle(document.querySelector('${warningRow}')).backgroundColor;`),normal,'Hover preserves a distinct warning tint');
        for(const selector of [`${warningRow} .quote-printed-difference`,`${warningRow} .quote-review-note`,`${warningRow} .quote-requested-item>span`])minimumTextContrast=Math.min(minimumTextContrast,await checkContrast(selector,`${theme} hovered warning text`));
        await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
        await click('.quote-review-trigger');await wait("return !!document.querySelector('.quote-editor-issues:popover-open');");
        await checkContrast('.quote-editor-issues',`${theme} issue popover`);await checkContrast('.quote-editor-issues button',`${theme} issue navigation`);await checkContrast('.quote-review-trigger',`${theme} review button`);
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await wait("return !document.querySelector('.quote-editor-issues:popover-open');");
        await run("document.querySelector('#quote-worksheet-0-worksheet-line-5-quantity').focus();return true;");
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        assert.equal(await run("return document.activeElement.id;"),'quote-worksheet-0-worksheet-line-5-unit');
        assert.equal(await run("return getComputedStyle(document.activeElement).outlineStyle!=='none';"),true,'Keyboard focus remains visible');
        await checkContrast('#quote-worksheet-0-worksheet-line-5-unit',`${theme} field focus outline`,3,'outline-color',warningRow);
      }
      if(width===1440||width===375){await run(`document.querySelector('${warningRow}').scrollIntoView({block:'center'});document.querySelector('.quote-editor-lines').scrollLeft=100;return true;`);await writeFile(path.join(profile,`worksheet-issues-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      if(width===1440||width===375){await run("document.querySelector('.quote-editor-lines').scrollLeft=0;return true;");await writeFile(path.join(profile,`worksheet-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));}
    }
  }
  assert.notEqual(themeSurfaces.light,themeSurfaces.dark,'Warning surfaces adapt to the selected theme');
  console.log(`Quotation worksheet smoke passed: bulk confirmation, exclusions, concurrent updates, keyboard, stable PDF/image preview, missing files and responsive themes. Warning text contrast: ${minimumTextContrast.toFixed(2)}:1 minimum. Screenshots: ${profile}`);
}finally{ws?.close();browser.kill();}
