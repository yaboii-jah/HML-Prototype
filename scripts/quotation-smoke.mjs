import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

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
  const navigate = async route => { await call("Page.navigate", { url: `${baseUrl}${route}` }); await wait(`return location.pathname === ${JSON.stringify(route)} && !!document.querySelector('h1');`); };
  const fill = async (selector, value) => { await wait(`return !!document.querySelector(${JSON.stringify(selector)});`); await run(`const el=document.querySelector(${JSON.stringify(selector)});const kind=el.tagName==='TEXTAREA'?HTMLTextAreaElement:el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;`); };
  const click = async label => { await wait(`return [...document.querySelectorAll('button')].some(button=>button.textContent.trim().includes(${JSON.stringify(label)}));`); await run(`const button=[...document.querySelectorAll('button')].find(value=>value.textContent.trim().includes(${JSON.stringify(label)}));button.click();return true;`); };
  const upload = async file => { await wait("return !!document.querySelector('input[aria-label=\"Supplier quotation files\"]');"); const { root } = await call("DOM.getDocument"); const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="Supplier quotation files"]' }); if (!nodeId) throw new Error("Quote file input missing"); await call("DOM.setFileInputFiles", { nodeId, files: [file] }); };
  const submit = selector => run(`document.querySelector(${JSON.stringify(selector)}).requestSubmit();return true;`);
  const snapshot = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v4'));");

  await wait("return location.pathname==='/sign-in' && !!document.querySelector('.signin-form');");
  await fill("#demo-email", "procurement@constructsync.example");
  await fill("#demo-password", "Demo123!");
  await click("Sign in");
  await wait("return location.pathname==='/dashboard';");
  await run("const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v4'));const request=structuredClone(state.requests.find(value=>value.id==='m3'));request.id='quote-smoke';request.ref='MRF-2026-999';request.items[0].id='quote-smoke-item';request.items[0].quantity=20;state.requests.push(request);state.role='Procurement';localStorage.setItem('hml-constructsync-demo-v4',JSON.stringify(state));return true;");
  await navigate("/requests/quote-smoke/quotes");

  async function review(file, supplier, reference, price) {
    await upload(file); await click("Review manually");
    await fill('select[name="supplier"]', supplier);
    await fill('input[name="reference"]', reference);
    await fill('input[name="description-0"]', "Plywood 18mm");
    await fill('select[name="match-0"]', "quote-smoke-item");
    await fill('input[name="quoted-quantity-0"]', 20);
    await fill('input[name="quoted-unit-0"]', "sheet");
    await fill('input[name="unit-price-0"]', price);
    await submit("form.quote-review");
    await wait(`return [...document.querySelectorAll('.quote-source')].some(value=>value.textContent.includes(${JSON.stringify(reference)}));`);
  }
  await review(pdf, "sup-1", "SMOKE-A", 700);
  await review(image, "sup-3", "SMOKE-B", 680);
  assert.equal(await run("return document.querySelectorAll('.quote-matrix tbody td').length;"), 2);

  async function award(reference, quantity) {
    await wait(`return [...document.querySelectorAll('.quote-source')].some(value=>value.textContent.includes(${JSON.stringify(reference)}));`);
    await run(`const row=[...document.querySelectorAll('.quote-source')].find(value=>value.textContent.includes(${JSON.stringify(reference)}));row.querySelector('button.button').click();return true;`);
    await fill('input[name^="award-"]', quantity);
    await fill('textarea[name="reason"]', "Confirmed price and availability");
    await submit("form.quote-award");
    await wait("return location.pathname.startsWith('/purchase-orders/');");
    await navigate("/requests/quote-smoke/quotes");
  }
  await award("SMOKE-A", 8);
  await award("SMOKE-B", 12);
  const state = await snapshot();
  const pos = state.pos.filter(po => po.mrfId === "quote-smoke");
  assert.equal(pos.length, 2);
  assert.deepEqual(pos.map(po => po.lines[0].quantity), [8, 12]);
  assert.equal(state.quotes.filter(quote => quote.mrfId === "quote-smoke").length, 2);
  assert.equal(state.quotes.filter(quote => quote.mrfId === "quote-smoke").every(quote => quote.documents[0].fileId), true);
  console.log("Quotation browser smoke passed: two supplier files, comparison, and split POs.");
} finally { ws?.close(); browser.kill(); }
