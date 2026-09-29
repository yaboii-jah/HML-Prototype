import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(path.join(os.tmpdir(), "hml-quote-smoke-"));
const pdf = path.join(profile, "Supplier A.pdf");
const image = path.join(profile, "Supplier B.png");
await Promise.all([writeFile(pdf, "%PDF-1.4\nquotation smoke"), writeFile(image, "quotation smoke")]);
const port = 9223 + Math.floor(Math.random() * 1000);
const baseUrl = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const browser = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, baseUrl], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target, lastPages, lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { lastPages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()); target = lastPages.find(page => page.type === "page" && page.url.startsWith(baseUrl)); if (target) break; } catch (error) { lastError = String(error); }
    await sleep(250);
  }
  if (!target) throw new Error(`Edge debugging page did not start: ${JSON.stringify({ port, exitCode: browser.exitCode, lastPages, lastError })}`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0; const pending = new Map();
  ws.onmessage = event => { const message = JSON.parse(event.data); if (message.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++nextId, method: "Page.handleJavaScriptDialog", params: { accept: true } })); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  const run = async code => { const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const wait = async code => { for (let attempt = 0; attempt < 120; attempt++) { try { if (await run(code)) return; } catch {} await sleep(125); } throw new Error(`Timed out: ${code}`); };
  const navigate = async route => { await call("Page.navigate", { url: `${baseUrl}${route}` }); await wait(`return location.pathname === ${JSON.stringify(route)} && !!document.querySelector('h1');`); await sleep(150); };
  const fill = async (selector, value) => { await wait(`return !!document.querySelector(${JSON.stringify(selector)});`); await run(`const el=document.querySelector(${JSON.stringify(selector)});const kind=el.tagName==='TEXTAREA'?HTMLTextAreaElement:el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;`); };
  const acceptPending = async () => { await sleep(90); if (await run("return !!document.querySelector('.confirm-dialog[open]');")) await run("document.querySelector('.confirm-dialog[open] .confirm-actions button:last-child').click();return true;"); };
  const click = async label => { await wait(`return [...document.querySelectorAll('button')].some(button=>button.textContent.trim().includes(${JSON.stringify(label)}));`); await run(`const button=[...document.querySelectorAll('button')].find(value=>value.textContent.trim().includes(${JSON.stringify(label)}));button.click();return true;`); await acceptPending(); };
  const upload = async (file, selector) => { await wait(`return !!document.querySelector(${JSON.stringify(selector)});`); const { root } = await call("DOM.getDocument"); const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector }); if (!nodeId) throw new Error("Quote file input missing"); await call("DOM.setFileInputFiles", { nodeId, files: [file] }); };
  const fillLabel = async (label, value) => { await wait(`return [...document.querySelectorAll('.quote-review label.field')].some(x=>x.querySelector('span')?.textContent===${JSON.stringify(label)});`); await run(`const field=[...document.querySelectorAll('.quote-review label.field')].find(x=>x.querySelector('span')?.textContent===${JSON.stringify(label)});const el=field.querySelector('input,select,textarea');const kind=el.tagName==='TEXTAREA'?HTMLTextAreaElement:el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;`); };
  const snapshot = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7'));");

  await wait("return location.pathname==='/sign-in' && !!document.querySelector('.signin-form');");
  await fill("#demo-email", "procurement@constructsync.example");
  await fill("#demo-password", "Demo123!");
  await click("Sign in");
  await wait("return location.pathname==='/dashboard';");
  await run(`localStorage.setItem('hml-constructsync-demo-v7', ${JSON.stringify(JSON.stringify({ ...seedDemo(), role: "Procurement" }))}); return true;`);
  await call("Page.reload", { ignoreCache: true });
  await wait("return location.pathname==='/dashboard' && JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).sites.length===2;");
  await run("const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v7'));const request=structuredClone(state.requests.find(value=>value.id==='m3'));request.id='quote-smoke';request.ref='MRF-2026-999';request.items[0].id='quote-smoke-item';request.items[0].quantity=20;state.requests.push(request);state.role='Procurement';localStorage.setItem('hml-constructsync-demo-v7',JSON.stringify(state));return true;");
  await navigate("/requests/quote-smoke/quotes");

  async function review(file, supplier, reference, price) {
    await click("Upload & review");
    await click("Supplier quotation group");
    await upload(file, '.quote-upload-group:last-of-type input[type=file]');
    await wait(`return [...document.querySelectorAll('.quote-upload-group')].some(value=>value.textContent.includes(${JSON.stringify(path.basename(file))}));`);
    await click("Enter manually");
    const groupNumber = await run("return document.querySelectorAll('.quote-upload-group').length;");
    await click(`Supplier quotation ${groupNumber}`);
    await wait("return !!document.querySelector('.quote-review');");
    await click("View documents");
    await wait("return !!document.querySelector('.quote-documents-dialog[open] .quote-document-preview iframe[src^=blob], .quote-documents-dialog[open] .quote-document-preview img[src^=blob]');");
    await run("document.querySelector('.quote-documents-dialog [aria-label=\"Close document preview\"]').click();return true;");
    await fillLabel("Supplier name", supplier);
    await fillLabel("Quotation reference", reference);
    await fillLabel("Description", "Plywood 18mm");
    await fillLabel("Required MRF material", "quote-smoke-item");
    await fillLabel("Quoted quantity", 20);
    await fillLabel("Quoted unit", "sheet");
    await fillLabel("Unit price", price);
    if (reference === "SMOKE-A") {
      await navigate("/requests/quote-smoke/quotes");
      assert.equal((await snapshot()).quotes.find(value => value.ref === reference)?.reviewStatus, "draft");
      await wait("return !!document.querySelector('.quote-review .quote-check input[type=checkbox]');");
    }
    await run("document.querySelector('.quote-review .quote-check input[type=checkbox]').click();return true;");
    await click("Finalize quotation");
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).quotes.some(q=>q.ref===${JSON.stringify(reference)}&&q.reviewStatus==='finalized');`);
  }
  await review(pdf, "MetroBuild Materials", "SMOKE-A", 700);
  await review(image, "SolidSpan Trading", "SMOKE-B", 680);
  await click("Compare");
  assert.equal(await run("return document.querySelectorAll('.quote-material-table tbody tr').length;"), 2);
  await click("Allocate");
  async function award(reference, quantity) {
    await run(`const section=[...document.querySelectorAll('section.panel')].find(value=>value.querySelector('h2')?.textContent.includes(${JSON.stringify(reference)}));if(!section)throw Error('Supplier allocation missing');const el=section.querySelector('.quote-award-line input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(quantity))});el.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).pendingAwards.some(value=>value.quantity===${quantity});`);
    await run(`const section=[...document.querySelectorAll('section.panel')].find(value=>value.querySelector('h2')?.textContent.includes(${JSON.stringify(reference)}));const el=section.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Confirmed price and availability');el.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
  }
  await award("SMOKE-A", 8);
  await navigate("/requests/quote-smoke/quotes");
  assert.equal((await snapshot()).pendingAwards.filter(value => value.requestId === "quote-smoke").length, 1);
  await click("Allocate");
  await award("SMOKE-A", 8);
  await award("SMOKE-B", 12);
  await click("Generate supplier PO drafts");
  await wait("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).pos.filter(po=>po.mrfId==='quote-smoke').length===2;");
  const state = await snapshot();
  const pos = state.pos.filter(po => po.mrfId === "quote-smoke");
  assert.equal(pos.length, 2);
  assert.deepEqual(pos.map(po => po.lines[0].quantity), [8, 12]);
  assert.equal(state.quotes.filter(quote => quote.mrfId === "quote-smoke").length, 2);
  assert.equal(state.quotes.filter(quote => quote.mrfId === "quote-smoke").every(quote => quote.documents[0].fileId), true);
  const firstPo = pos[0];
  await navigate(`/purchase-orders/${firstPo.id}`);
  await wait("return !!document.querySelector('.po-preview-stamp');");
  await navigate(`/purchase-orders/${firstPo.id}/edit`);
  await run("const form=document.querySelector('form.form-stack');form.requestSubmit(form.querySelector('button[value=finalize]'));return true;");
  await acceptPending();
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).pos.find(value=>value.id===${JSON.stringify(firstPo.id)}).status==='finalized';`);
  await run("document.querySelector('.masthead-role').click();return true;");
  await wait("return !!document.querySelector('.role-options');");
  await run("[...document.querySelectorAll('.role-options button')].find(value=>value.querySelector('strong')?.textContent==='Finance').click();return true;");
  await navigate(`/finance/${firstPo.id}`);
  await click("Approve budget");
  await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v7')).pos.find(value=>value.id===${JSON.stringify(firstPo.id)}).status==='approved';`);
  await navigate(`/purchase-orders/${firstPo.id}`);
  await wait("return !!document.querySelector('.po-print');");
  assert.equal(await run("return !!document.querySelector('.po-preview-stamp');"), false);
  console.log("Quotation browser smoke passed: grouped uploads, saved draft and allocation, split POs, Finance approval, and print status.");
} finally { ws?.close(); browser.kill(); }
