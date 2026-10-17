import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { PDFDocument } from "pdf-lib";

const base = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const profile = await mkdtemp(path.join(os.tmpdir(), "constructsync-skeleton-"));
const port = 12000 + Math.floor(Math.random() * 1000);
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(page => page.type === "page"); } catch {}
    if (!target) await sleep(250);
  }
  assert.ok(target, "Isolated test browser starts");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call("Runtime.evaluate", { expression: `(()=>{${code}})()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async code => {
    for (let i = 0; i < 200; i++) { if (await run(code)) return; await sleep(100); }
    throw new Error(`Timed out: ${code}`);
  };
  const navigate = async route => {
    await call("Page.navigate", { url: base + route });
    await wait(`return location.pathname===${JSON.stringify(route)}&&!!document.querySelector('.masthead-account')&&!document.querySelector('.page-skeleton');`);
  };
  const fill = async (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
  const click = async selector => run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing '+${JSON.stringify(selector)});el.focus();el.click();return true;`);
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__loadingChecks={files:[],previews:[],accounts:[]};
    const derive=crypto.subtle.deriveBits.bind(crypto.subtle);
    crypto.subtle.deriveBits=(...args)=>new Promise(resolve=>window.__loadingChecks.accounts.push(()=>resolve(derive(...args))));
    window.__releaseAccounts=()=>{crypto.subtle.deriveBits=derive;window.__loadingChecks.accounts.splice(0).forEach(f=>f());};
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const url=String(input instanceof Request?input.url:input);
      const bucket=url.includes('/api/drive/files')?'files':url.includes('/api/documents/preview')?'previews':null;
      if(!bucket)return originalFetch(input,init);
      // Intentionally ignore abort, testing late-response guards as well as cancellation.
      return new Promise(resolve=>window.__loadingChecks[bucket].push({url,resolve}));
    };
    window.__reply=(bucket,body,status=200)=>{const job=window.__loadingChecks[bucket].shift();if(!job)throw new Error('No pending '+bucket);job.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));};
  ` });
  await call("Page.navigate", { url: base + "/sign-in" });
  await wait("return !!document.querySelector('.skeleton-signin')&&window.__loadingChecks.accounts.length===7;");
  assert.equal(await run("return document.querySelector('.skeleton-signin').getAttribute('aria-busy');"), "true");
  await sleep(200);
  assert.equal(await run("return getComputedStyle(document.querySelector('.skeleton-signin .loading-visual')).visibility;"), "visible", "Grace period reveals startup skeleton");
  await run("window.__releaseAccounts();return true;");
  await wait("return !!document.querySelector('#signin-email');");
  const account = ACCOUNT_FIXTURES.find(value => value.role === "Procurement");
  await fill("#signin-email", account.email); await fill("#signin-password", account.password); await click(".signin-form button");
  await wait("return !!document.querySelector('.masthead-account');");
  const fixture = seedDemo();
  fixture.sites[0].driveFolderId = "skeleton-project-folder";
  const projectId = fixture.sites[0].id;
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);

  // Every page family can hydrate behind neutral chrome, including deep links.
  for (const [route, family] of [["/dashboard", "summary"], ["/requests", "register"], ["/requests/m1", "detail"], ["/requests/new", "form"], ["/requests/m1/quotes", "quotation"]]) {
    await run("localStorage.removeItem('hml-constructsync-users-v1');return true;");
    await call("Page.navigate", { url: base + route });
    await wait(`return !!document.querySelector('.skeleton-workspace [data-skeleton-variant="${family}"]')&&window.__loadingChecks.accounts.length===7;`);
    assert.equal(await run("return !!document.querySelector('.skeleton-workspace button,.skeleton-workspace a,.skeleton-workspace input');"), false, "Startup chrome has no fake controls");
    await run("window.__releaseAccounts();return true;");
    await wait("return !!document.querySelector('.masthead-account')&&!document.querySelector('.page-skeleton');");
  }

  await navigate(`/projects/${projectId}`);
  await wait("return window.__loadingChecks.files.length===1;");
  assert.equal(await run("return !!document.querySelector('.drive-project-files [aria-busy=true] .skeleton-rows')&&!document.querySelector('.drive-project-files').textContent.includes('No files found here.');"), true, "No premature empty state");
  for (const width of [320, 375, 414, 768, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 801 });
    for (const theme of ["light", "dark"]) {
      await run(`document.documentElement.dataset.theme='${theme}';return true;`);
      await sleep(180);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"), true, `Skeleton fits ${width}/${theme}`);
      assert.equal(await run("return getComputedStyle(document.querySelector('.drive-project-files .skeleton'),'::after').animationName;"), "skeleton-shimmer");
    }
  }
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await run("return getComputedStyle(document.querySelector('.drive-project-files .skeleton'),'::after').animationName;"), "none", "Reduced motion disables shimmer");
  await call("Emulation.setEmulatedMedia", { features: [] });
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run("document.querySelector('.drive-project-files').scrollIntoView({block:'center'});return true;");
  await writeFile(path.join(profile, "drive-skeleton.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await run("window.__reply('files',{files:[{id:'folder-a',name:'Folder A',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:'page-two'});return true;");
  await wait("return !document.querySelector('.drive-project-files [aria-busy=true]');");
  await run("Array.from(document.querySelectorAll('.drive-project-files button')).find(button=>button.textContent==='Load more files').click();return true;");
  await wait("return window.__loadingChecks.files.length===1;");
  assert.equal(await run("return document.querySelector('.drive-project-files table').textContent.includes('Folder A')&&!!document.querySelector('.drive-project-files .skeleton-rows');"), true, "Appending keeps existing rows");
  await run("window.__reply('files',{files:[{id:'file-b',name:'File B',mimeType:'application/pdf'}]});return true;");
  await wait("return document.querySelector('.drive-project-files table').textContent.includes('File B');");
  await click(".drive-project-files table button");
  await wait("return window.__loadingChecks.files.length===1;");
  assert.equal(await run("return !document.querySelector('.drive-project-files table').textContent.includes('File B');"), true, "Folder changes hide prior rows");
  await fill('[aria-label="Search project Drive documents"]', "earlier");
  await wait("return window.__loadingChecks.files.length===2;");
  await fill('[aria-label="Search project Drive documents"]', "latest");
  await wait("return window.__loadingChecks.files.length===3;");
  await run("const jobs=window.__loadingChecks.files;const latest=jobs.pop();latest.resolve(new Response(JSON.stringify({files:[{id:'latest-file',name:'Latest result',mimeType:'application/pdf'}]})));return true;");
  await wait("return document.querySelector('.drive-project-files table').textContent.includes('Latest result');");
  await run("window.__reply('files',{files:[{id:'stale-folder',name:'Stale folder result',mimeType:'application/pdf'}]});window.__reply('files',{files:[{id:'stale-search',name:'Stale search result',mimeType:'application/pdf'}]});return true;");
  await sleep(200);
  assert.equal(await run("return !document.querySelector('.drive-project-files table').textContent.includes('Stale');"), true, "Late responses cannot replace current results");
  await fill('[aria-label="Search project Drive documents"]', "failure");
  await wait("return window.__loadingChecks.files.length===1;");
  await run("window.__reply('files',{error:'Drive unavailable'},503);return true;");
  await wait("return document.querySelector('.drive-project-files').textContent.includes('Drive unavailable')&&!document.querySelector('.drive-project-files [aria-busy=true]');");

  await navigate("/requests/m1");
  await click(".print-hide button");
  await wait("return !!document.querySelector('.document-preview-dialog[open] .document-loading');");
  await click(".document-preview-dialog[open] .panel-heading button");
  await wait("return document.activeElement.closest('.print-hide')!==null;");
  assert.equal(await run("return document.activeElement.closest('.print-hide')!==null;"), true, "Closing restores focus");
  await run("window.__reply('previews',{error:'Late failure'},503);return true;");
  await sleep(200);
  assert.equal(await run("return !document.querySelector('.document-preview-dialog[open]');"), true, "Late completion never reopens a closed dialog");
  await click(".print-hide button");
  await run("window.__reply('previews',{error:'Preview unavailable'},503);return true;");
  await wait("return document.querySelector('.document-preview-dialog[open]').textContent.includes('Retry preview')&&!document.querySelector('.document-preview-dialog[open] [aria-busy=true]');");
  await click(".document-preview-dialog[open] .button.secondary");
  await wait("return window.__loadingChecks.previews.length===1;");
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Skeleton preview smoke");
  const bytes = Buffer.from(await pdf.save()).toString("base64");
  await run(`const job=window.__loadingChecks.previews.shift();job.resolve(new Response(Uint8Array.from(atob('${bytes}'),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/pdf'}}));return true;`);
  await wait("return !!document.querySelector('.document-preview-dialog[open] .pdfViewer canvas')&&!document.querySelector('.document-preview-dialog[open] .document-loading');");
  assert.equal(await run("return document.querySelector('.pdf-document-scroll').getAttribute('aria-busy');"), "false", "Rendered PDF finishes loading");
  await click(".document-preview-dialog[open] .panel-heading button");

  // Real Next navigation retains the shell; ready prefetched pages need no placeholder.
  await run("window.__shell=document.querySelector('.masthead');document.querySelector('a[href=\"/requests\"]').click();return true;");
  await wait("return location.pathname==='/requests'&&!!document.querySelector('h1');");
  assert.equal(await run("return window.__shell===document.querySelector('.masthead')&&!document.querySelector('.page-skeleton');"), true, "Shared shell survives ready navigation");
  await fill('[aria-label="Search requests"]', "cement");
  assert.equal(await run("return !document.querySelector('.page-skeleton');"), true, "Local filtering doesn't manufacture loading");
  await navigate("/requests/missing");
  assert.equal(await run("return document.body.textContent.includes('not found')&&!document.querySelector('.page-skeleton');"), true, "Missing records terminate loading");
  await run("localStorage.setItem('hml-constructsync-demo-v12','broken-json');return true;");
  await call("Page.navigate", { url: base + "/dashboard" });
  await wait("return document.body?.textContent.includes('Saved data needs attention');");
  assert.equal(await run("return !document.querySelector('.page-skeleton');"), true, "Recovery terminates loading");
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});localStorage.setItem('hml-constructsync-users-v1','broken-json');return true;`);
  await call("Page.navigate", { url: base + "/requests" });
  await wait("return document.body?.textContent.includes('Saved user accounts need attention');");
  assert.equal(await run("return !document.querySelector('.page-skeleton');"), true, "User-directory recovery terminates loading");
  console.log(`Skeleton loading smoke passed. Screenshots: ${profile}`);
} finally { ws?.close(); browser.kill(); }
