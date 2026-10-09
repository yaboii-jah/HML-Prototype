import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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
  const wait = async code => { for (let i = 0; i < 1000; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}: ${await run("return JSON.stringify({body:document.body.innerText.slice(-1600),role:JSON.parse(localStorage.getItem(\"hml-constructsync-demo-v12\"))?.role});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await call("Page.enable");

  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Site Personnel");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture = seedDemo(); fixture.role = "Site Personnel";
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await navigate("/requests/new");
  await fill("input[name=requestedBy]", "Keep this until Apply");
  const {root} = await call("DOM.getDocument");
  const {nodeId} = await call("DOM.querySelector", {nodeId:root.nodeId,selector:'input[aria-label="Choose MRF extraction sources"]'});
  assert.ok(nodeId, "MRF source picker exists");
  await call("DOM.setFileInputFiles", {nodeId,files:[path.resolve("sample-data/MRF 372 - Material Request and Key Plan.pdf")]});
  const press = async text => run(`const button=[...document.querySelectorAll('.mrf-ai-import button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.click();return true;`);
  await wait("return [...document.querySelectorAll('.mrf-ai-import button')].some(b=>b.textContent.trim()==='Extract with AI'&&!b.disabled);");
  await press("Extract with AI");
  await wait("return !!document.querySelector('.mrf-ai-result')||!!document.querySelector('.mrf-ai-import .inline-error');");
  assert.equal(await run("return !!document.querySelector('.mrf-ai-result');"), true, await run("return document.querySelector('.mrf-ai-import').innerText;"));
  assert.match(await run("return document.querySelector('.mrf-ai-result').innerText;"), /8 materials/);
  assert.equal(await run("return document.querySelector('input[name=requestedBy]').value;"), "Keep this until Apply");
  await press("Apply to form");
  await wait("return !!document.querySelector('.confirm-dialog[open]');");
  await click(".confirm-dialog[open] .confirm-actions button:last-child");
  await wait("return [...document.querySelectorAll('.mrf-ai-import button')].some(b=>b.textContent.includes('Results applied'));");
  assert.notEqual(await run("return document.querySelector('input[name=requestedBy]').value;"), "Keep this until Apply");
  assert.equal(await run("return document.querySelector('#siteId').value;"), "");
  console.log("Live MRF 372 import passed: 8 materials extracted, existing values preserved before Apply, confirmed application succeeded.");
} finally {
  ws?.close(); browser.kill();
}
