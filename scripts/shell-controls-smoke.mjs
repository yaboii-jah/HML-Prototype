import { prepareFixtureBrowser } from "./helpers/workspace-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../tests/fixtures/workspace.ts";

const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-shell-"));
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
  let nextId = 0; const pending = new Map(), exceptions = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
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
  const wait = async code => { for (let i = 0; i < 300; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}; ${await run("return JSON.stringify({page:location.pathname,body:document.body.innerText.slice(-600),sidebar:document.documentElement.dataset.sidebar,focus:document.activeElement.outerHTML});")}`); };
  const navigate = async route => { await call("Page.navigate", { url: base + route }); await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1');`); await sleep(180); };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`);
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click();return true;`); await sleep(100); };
  await call("Runtime.enable"); await prepareFixtureBrowser(call, base); await call("Page.enable");
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(a => a.role === "Administrator");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.masthead-account');");
  const fixture = seedDemo();
  fixture.role = "Administrator"; fixture.siteFilter = "all";
  const source = fixture.pos[0];
  fixture.pos = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(source), id: `notice-${index}`, ref: `LONG-NOTICE-${index}`, status: "hold", reviewReason: "A long material description with specifications and additional project requirements. ".repeat(5) }));
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await navigate("/dashboard");
  const resize = async (width, height) => { await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(150); };
  const railWidth = () => run("return Math.round(document.querySelector('.side-nav').getBoundingClientRect().width);");
  const escape = async () => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(100);
  };
  await resize(1440, 900);
  assert.equal(await railWidth(), 220, "Default expanded sidebar");
  await click('.sidebar-toggle');
  await wait("return document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')==='false';");
  assert.equal(await railWidth(), 72, "Collapsed sidebar width");
  assert.equal(await run("return document.querySelector('.sidebar-toggle').getAttribute('aria-label');"), "Expand sidebar");
  await sleep(350);await run("document.activeElement.blur();document.querySelector('.compact-navigation>nav>a').focus();return true;");
  await wait("return !!document.querySelector('.sidebar-tooltip');");
  assert.equal(await run("return document.querySelector('.sidebar-tooltip').textContent;"), "Dashboard", "Keyboard tooltip");
  await escape();
  assert.equal(await run("return !!document.querySelector('.sidebar-tooltip');"), false, "Tooltip dismisses on Escape");
  const hoverPoint = await run("const r=document.querySelector('.compact-navigation>nav>a').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};");
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
  await wait("return !!document.querySelector('.sidebar-tooltip');");
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 150 });
  await wait("return !document.querySelector('.sidebar-tooltip');");
  await navigate("/projects");
  assert.equal(await railWidth(), 72, "Choice survives navigation and reload");
  await click('.masthead-account');
  await run("[...document.querySelectorAll('.role-options button')].find(el=>el.textContent.includes('Procurement')).click();return true;");
  await wait("return document.querySelector('.account-label small').textContent==='Procurement';");
  assert.equal(await railWidth(), 72, "Choice survives account switching");
  await click('.masthead-account');
  assert.equal(await run("return [...document.querySelectorAll('.role-options button strong')].some(el=>el.textContent==='Accounting')&&!document.querySelector('.role-options').textContent.includes('/ Auditing');"), true, "Switcher displays Accounting");
  await run("[...document.querySelectorAll('.role-options button')].find(el=>el.querySelector('strong').textContent==='Accounting').click();return true;");
  await wait("return document.querySelector('.account-label small').textContent==='Accounting';");
  assert.equal(await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).role;"), 'Accounting / Auditing', "Stored role remains compatible");
  await navigate('/accounting');
  assert.equal(await run("return document.querySelector('.workspace-content h1').textContent;"), 'Accounting queue', "Accounting workspace remains accessible");
  await click('.masthead-account');
  await run("[...document.querySelectorAll('.role-options button')].find(el=>el.textContent.includes('Administrator')).click();return true;");
  await wait("return document.querySelector('.account-label small').textContent==='Administrator';");

  console.log('Checking short-screen navigation and notification overflow');
  for (const theme of ["light", "dark"]) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);
    for (const height of [900, 480, 360]) {
      await resize(1440, height);
      assert.equal(await run("const aside=document.querySelector('.side-nav');return aside.scrollHeight<=aside.clientHeight+1;"), true, "Sidebar fits short screens");
      assert.equal(await run("return new Set([...document.querySelectorAll('.compact-navigation a')].map(el=>el.getAttribute('href'))).size;"), 11, "Every permitted section reachable");
      if (height === 360) {
        await click('.nav-more-trigger');
        assert.equal(await run("return [...document.querySelectorAll('.nav-more-dialog a .nav-label')].every(el=>el.getBoundingClientRect().width>1);"), true, "More sections retains full labels");
        await escape();
        assert.equal(await run("return document.activeElement===document.querySelector('.nav-more-trigger');"), true, "More sections restores focus");
      }
      await click('.notification-trigger');
      await wait("return !!document.querySelector('.notification-popover');");
      assert.equal(await run("const panel=document.querySelector('.notification-popover'),r=panel.getBoundingClientRect(),list=panel.querySelector('.notification-list');return r.bottom<=innerHeight-10&&r.left>=10&&r.right<=innerWidth-10&&list.scrollHeight>list.clientHeight;"), true, "Notification panel stays within viewport and scrolls");
      assert.equal(await run("return document.querySelectorAll('.notification-list>a').length;"), 7, "Seven-item preview retained");
      await run("const list=document.querySelector('.notification-list');list.scrollTop=list.scrollHeight;return true;");
      assert.equal(await run("const p=document.querySelector('.notification-popover').getBoundingClientRect(),h=document.querySelector('.popover-heading').getBoundingClientRect(),f=document.querySelector('.notification-footer').getBoundingClientRect();return h.top>=p.top&&f.bottom<=p.bottom&&document.querySelector('.notification-list').scrollTop>0;"), true, "Heading and footer remain visible while scrolling");
      await run("document.querySelector('.notification-list>a:last-child').focus();return true;");
      assert.equal(await run("const r=document.activeElement.getBoundingClientRect(),l=document.querySelector('.notification-list').getBoundingClientRect();return r.bottom>l.top&&r.top<l.bottom;"), true, "Keyboard focus scrolls last task into view");
      await run("document.querySelector('.notification-footer').focus();return true;");
      await call("Page.captureScreenshot", { format: "png" }).then(r => writeFile(path.join(profile, `${theme}-${height}.png`), Buffer.from(r.data, "base64")));
      await escape();
      assert.equal(await run("return !document.querySelector('.notification-popover')&&document.activeElement===document.querySelector('.notification-trigger');"), true, "Escape dismisses and restores bell focus");
    }
  }
  await resize(900, 700);
  assert.equal(await railWidth(), 72, "Tablet above breakpoint retains collapsed rail");
  for (const width of [800, 375]) {
    await resize(width, 667);
    await click('.mobile-menu');
    assert.equal(await run("return getComputedStyle(document.querySelector('.sidebar-toggle')).display;"), "none", "Mobile has no desktop toggle");
    assert.equal(await run("return [...document.querySelectorAll('.compact-navigation>nav .nav-label')].every(el=>el.getBoundingClientRect().width>1);"), true, "Mobile drawer keeps full labels");
    await click('.mobile-close');
    await click('.notification-trigger');
    assert.equal(await run("const r=document.querySelector('.notification-popover').getBoundingClientRect();return r.left>=10&&r.right<=innerWidth-10&&r.bottom<=innerHeight-10;"), true, "Mobile notification panel fits");
    await escape();
  }
  await resize(1440, 900);
  assert.equal(await railWidth(), 72, "Returning to desktop restores saved choice");
  await click('.sidebar-toggle');
  assert.equal(await railWidth(), 220, "Sidebar expands again");
  // Storage failure must not prevent toggling; restore ordinary storage on reload.
  await run("Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError')};document.querySelector('.sidebar-toggle').click();return true;");
  await wait("return document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')==='false';");
  assert.equal(await railWidth(), 72, "Toggle still works when persistence is blocked");
  await navigate('/dashboard');
  assert.equal(await railWidth(), 220, "Last successfully saved choice remains");
  // Invalid preferences use the expanded default.
  await run("localStorage.setItem('constructsync-sidebar','invalid');return true;");
  await navigate('/dashboard');
  assert.equal(await railWidth(), 220, "Invalid preference defaults expanded");
  await run("localStorage.setItem('constructsync-sidebar','collapsed');return true;");
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "const realGetItem=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='constructsync-sidebar')throw new DOMException('Blocked','SecurityError');return realGetItem.call(this,key)};" });
  await navigate('/dashboard');
  assert.equal(await railWidth(), 220, "Blocked storage reads default expanded");
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await resize(375, 667);
  assert.equal(await run("return parseFloat(getComputedStyle(document.querySelector('.side-nav')).transitionDuration)<=0.001;"), true, "Reduced motion removes perceptible drawer animation");
  await resize(1440, 900);
  await run(`const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));state.pos.forEach(po=>{po.status='draft';po.paymentDueDate=undefined;});state.requests.forEach(r=>{r.status='approved';delete r.correction;if(r.archive)r.archive.status='complete';});localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(state));return true;`);
  await navigate('/dashboard');
  await click('.notification-trigger');
  assert.equal(await run("return document.querySelector('.notification-list').textContent.trim();"), 'Nothing waiting for this role.', "Empty notification state retained");
  await escape();
  await run("const state=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));state.pos[0].status='hold';state.pos[0].reviewReason='Review required';localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(state));return true;");
  await navigate('/dashboard');
  await click('.notification-trigger');
  assert.equal(await run("const list=document.querySelector('.notification-list');return list.querySelectorAll('a').length===1&&list.scrollHeight===list.clientHeight;"), true, "Short notification list needs no scrolling");
  await run("document.querySelector('.notification-list>a').click();return true;");
  await wait("return location.pathname==='/accounting/notice-0'&&!document.querySelector('.notification-popover');");
  assert.deepEqual(exceptions, [], 'No uncaught browser errors');
  console.log('Shell controls smoke passed. Screenshots:', profile);
} finally { ws?.close(); browser.kill(); }
