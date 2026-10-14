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
  const fixture = seedDemo(), sourceRequest = fixture.requests.find(r => r.id === "m1"), sourcePo = fixture.pos.find(p => p.mrfId === sourceRequest.id);
  fixture.role = "Procurement";
  const batchTemplate = fixture.batches[0];
  for (let i = 0; i < 27; i++) fixture.batches.push({ ...structuredClone(batchTemplate), id: `register-batch-${i}`, ref: `REGISTER-BATCH-${i}` });
  for (let i = 0; i < 27; i++) {
    const request = { ...structuredClone(sourceRequest), id: `register-mrf-${i}`, ref: `REGISTER-MRF-${i}`, createdAt: "2026-10-07T00:00:00Z" };
    fixture.requests.push(request);
    for (let n = 0; n < 2; n++) fixture.pos.push({ ...structuredClone(sourcePo), id: `register-po-${i}-${n}`, mrfId: request.id, ref: `REGISTER-PO-${i}-${n}` });
  }
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});return true;`);
  await navigate("/reports");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 360, deviceScaleFactor: 1, mobile: false }); await sleep(200);
  await wait("return !!document.querySelector('.nav-more-trigger');");
  await click('.nav-more-trigger');
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });await sleep(150);
  assert.equal(await run("return !document.querySelector('.nav-more-dialog[open]')&&document.activeElement===document.querySelector('.nav-more-trigger');"),true,JSON.stringify(await run("return {open:!!document.querySelector('.nav-more-dialog[open]'),focus:document.activeElement.outerHTML};")));
  await call("Emulation.clearDeviceMetricsOverride");
  await navigate("/accounting");
  const before = await run("return localStorage.getItem('hml-constructsync-demo-v12');");
  const integrity = () => run("return [...document.querySelectorAll('.accounting-mrf')].filter(group=>group.querySelector('summary strong').textContent.startsWith('REGISTER-')).every(group=>group.querySelectorAll('.accounting-po-list tbody tr').length===2);");
  await wait("return !!document.querySelector('.accounting-mrf');");
  assert.equal(await run("return [...document.querySelectorAll('.accounting-mrf')].every(group=>!group.open)&&![...document.querySelectorAll('.accounting-po-list')].some(table=>table.checkVisibility());"),true,'MRFs begin collapsed and PO tables are hidden');
  await click('.accounting-mrf summary');
  assert.equal(await run("return document.querySelector('.accounting-mrf').open&&document.querySelector('.accounting-po-list').checkVisibility();"),true,'Expanding an MRF reveals its POs');
  // Prevent navigation temporarily to verify the link does not toggle its group.
  await run("const link=document.querySelector('.accounting-mrf summary a');link.addEventListener('click',event=>event.preventDefault(),{once:true});link.click();return true;");
  assert.equal(await run("return document.querySelector('.accounting-mrf').open;"),true,'View MRF link does not toggle the disclosure');
  assert.equal(await run("const group=document.querySelector('.accounting-mrf'),summary=group.querySelector(':scope>summary'),table=group.querySelector('.accounting-po-scroll');return !!summary.querySelector('a[href^=\"/requests/\"]')&&table.getBoundingClientRect().top-summary.getBoundingClientRect().bottom<=13;"),true,'MRF link shares the summary and expanded PO table starts without an empty action row');
  await click('.accounting-mrf summary');
  assert.equal(await run("return !document.querySelector('.accounting-mrf').open;"),true,'Clicking the MRF header collapses its POs');
  await run("document.querySelector('.accounting-mrf summary').focus();return true;");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await sleep(100);
  assert.equal(await run("return document.querySelector('.accounting-mrf').open;"),true,'MRF disclosure supports the keyboard');
  const total = await run("return Number(document.querySelector('.accounting-groups .register-footer > span').textContent.match(/of ([0-9]+)/)[1]);");
  assert.ok(total > 25); assert.equal(await integrity(), true);
  await click('.accounting-groups button[aria-label="Next MRFs page"]');
  assert.equal(await integrity(), true, "Accounting never splits matching POs across pages");
  await fill('.accounting-groups input[type=search]', "REGISTER-MRF-26");
  assert.equal(await run("return document.querySelector('.accounting-groups .register-page-controls span').textContent;"), "1 / 1", "Filtering resets pagination");
  assert.equal(await run("return document.querySelectorAll('.accounting-group').length;"), 1);
  assert.equal(await run("return document.querySelector('.accounting-mrf').open&&document.querySelectorAll('.accounting-po-list tbody tr').length===2;"),true,'Searching opens matching MRFs with their related POs');
  await fill('.accounting-groups input[type=search]', 'REGISTER-PO-26-1');
  assert.equal(await run("return document.querySelector('.accounting-mrf').open&&document.querySelectorAll('.accounting-po-list tbody tr').length===1;"),true,'PO search reveals only the matched PO');
  await fill('.accounting-groups input[type=search]', "");
  await fill('.accounting-groups select[aria-label="MRFs per page"]', 25);
  assert.equal(await run("return document.querySelectorAll('.accounting-group').length;"), 25);
  await click('.accounting-groups button[aria-label="Next MRFs page"]');
  assert.equal(await run("return document.querySelectorAll('.accounting-group').length;"), total - 25);
  await fill('.accounting-groups input[type=search]', "no-such-record");
  assert.equal(await run("return document.querySelector('.accounting-groups .register-footer > span').textContent;"), "0–0 of 0 MRFs");
  await fill('.accounting-groups input[type=search]', "");
  await click('.accounting-mrf summary');
  for (const width of [1440, 1024, 768, 414, 375, 320]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 }); await sleep(180);
    for (const theme of ["light", "dark"]) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};return true;`);
      assert.equal(await run("return document.documentElement.scrollWidth<=innerWidth+1;"), true, `Accounting fits ${width}/${theme}`);
      assert.equal(await run("const group=document.querySelector('.accounting-mrf'),region=group.querySelector('.accounting-po-scroll'),summary=group.querySelector('summary').getBoundingClientRect();return group.open&&summary.height>=44&&(innerWidth>768||region.scrollWidth>region.clientWidth);"),true,`Expanded POs scroll locally and MRF headers remain tappable at ${width}/${theme}`);
      if(width===1440||width===375)await writeFile(path.join(profile,`accounting-mrf-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      assert.equal(await run("const scroll=document.querySelector('.register-scroll');scroll.scrollTop=200;const header=scroll.querySelector('thead th').getBoundingClientRect(),footer=document.querySelector('.register-footer').getBoundingClientRect();return Math.abs(header.top-scroll.getBoundingClientRect().top)<2&&footer.bottom<=innerHeight;"), true, `Headers and pagination remain accessible at ${width}/${theme}`);
    }
  }
  await call("Emulation.clearDeviceMetricsOverride");
  await run("document.documentElement.dataset.theme='light';return true;");
  const requestHref = await run("const link=document.querySelector('.accounting-mrf summary a');link.focus();return link.getAttribute('href');");
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`return location.pathname===${JSON.stringify(requestHref)};`);
  await navigate('/accounting');
  if (process.argv.includes("--accounting-only")) {
    assert.equal(await run("return localStorage.getItem('hml-constructsync-demo-v12');"), before, "Accounting disclosures change no records");
    console.log(`Accounting smoke passed: collapse/expand, keyboard controls, search, complete MRF pagination and responsive light/dark layouts. Screenshots: ${profile}`);
  } else {
    await navigate("/deliveries");
    await fill('input[aria-label="Search deliveries"]','no-such-batch');
    await fill('select[aria-label="batches per page"]',25);
    await click('.view-tabs [role=tab]:last-child');
    await fill('input[aria-label="Search ready deliveries"]','REGISTER-PO');
    await fill('select[aria-label="ready POs per page"]',50);
    await click('.view-tabs [role=tab]:first-child');
    assert.equal(await run("return document.querySelector('input[aria-label=\"Search deliveries\"]').value;"),'no-such-batch');
    assert.equal(await run("return document.querySelector('select[aria-label=\"batches per page\"]').value;"),'25');
    await click('.view-tabs [role=tab]:last-child');
    assert.equal(await run("return document.querySelector('input[aria-label=\"Search ready deliveries\"]').value;"),'REGISTER-PO');
    assert.equal(await run("return document.querySelector('select[aria-label=\"ready POs per page\"]').value;"),'50','Delivery views retain independent controls');
    await click('.view-tabs [role=tab]:first-child');
    await fill('input[aria-label="Search deliveries"]','');
    for (const [width, height, minimum] of [[1440, 480, 480], [375, 568, 420]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 }); await sleep(180);
      assert.equal(await run(`const table=document.querySelector('.delivery-overview-table');return table.getBoundingClientRect().height>=${minimum}&&parseFloat(getComputedStyle(table).minHeight)===${minimum};`), true, `Delivery table has increased usable height at ${width}px`);
      await run("const table=document.querySelector('.delivery-overview-table'),body=table.querySelector('.register-scroll');window.scrollTo(0,scrollY+table.getBoundingClientRect().top-76);body.scrollTop=body.scrollHeight;return true;");
      assert.equal(await run("const table=document.querySelector('.delivery-overview-table'),body=table.querySelector('.register-scroll'),header=body.querySelector('thead th').getBoundingClientRect(),footer=table.querySelector('.register-footer').getBoundingClientRect();return body.scrollHeight>body.clientHeight&&Math.abs(header.top-body.getBoundingClientRect().top)<2&&footer.bottom<=table.getBoundingClientRect().bottom;"), true, 'Tall delivery table retains scrolling body, fixed header and pagination');
    }
    await call('Emulation.clearDeviceMetricsOverride');
    await navigate('/inventory');
    for (const [width, height] of [[1440, 480], [375, 568]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await run('window.scrollTo(0,0);return true;'); await sleep(180);
      const baseline = await run("return {height:document.querySelector('.register').getBoundingClientRect().height,page:document.documentElement.scrollHeight};");
      for (let i = 0; i < 6; i++) {
        await run('window.scrollTo(0,document.documentElement.scrollHeight);return true;'); await sleep(50);
        await fill('select[aria-label="Sort inventory"]', i % 2 === 0 ? 'za' : 'az'); await sleep(100);
        await fill('input[aria-label="Search inventory"]', i % 2 === 0 ? 'no-matches' : '');
        await fill('select[aria-label="materials per page"]', i % 2 === 0 ? 25 : 10); await sleep(100);
        assert.equal(await run(`const el=document.querySelector('.register');return Math.abs(el.getBoundingClientRect().height-${baseline.height})<=1&&Math.abs(document.documentElement.scrollHeight-${baseline.page})<=1;`), true, `Inventory height stays stable when sorting at the bottom (${width}px, iteration ${i})`);
      }
    }
    await call('Emulation.clearDeviceMetricsOverride');
    if (!process.argv.includes('--tables-only')) {
      await navigate("/suppliers"); await click('.suppliers-register tbody button');
      await wait("return !!document.querySelector('.record-dialog[open]');");
      await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait("return !document.querySelector('.record-dialog[open]')&&document.activeElement===document.querySelector('.suppliers-register tbody button');");
      await navigate("/requests/m1/quotes");
      await click('.quote-editor-header button[popoverTarget]');
      assert.equal(await run("const menu=document.querySelector('.row-action-menu:popover-open'),rect=menu.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight;"), true, "Quotation action popover fits");
      await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      assert.equal(await run("return !!document.querySelector('.row-action-menu:popover-open');"), false);
      await navigate("/requests");
      await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });await sleep(150);
      await writeFile(path.join(profile, "register-desktop.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
      assert.equal(await run("return localStorage.getItem('hml-constructsync-demo-v12');"), before, "Register and modal inspection changes no records");
      // Inspect compact settings and focus outlines at the supported viewport widths.
      await click('.masthead-account');
      await run("[...document.querySelectorAll('.role-options button')].find(el=>el.textContent.includes('Administrator')).click();return true;");
      await navigate('/admin');await click('.admin-projects tbody button');
      await click('.record-dialog[open] [role=tab]:nth-child(2)');
      for(const width of [1440,900,801,768,414,375,320]){
        await call('Emulation.setDeviceMetricsOverride',{width,height:width<800?568:900,deviceScaleFactor:1,mobile:width<800});
        for(const theme of ['light','dark']){
          await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};const input=document.querySelector('.record-dialog[open] .drive-folder-form input');input.focus();return true;`);await sleep(150);
          const modalGeometry=await run("const modal=document.querySelector('.record-dialog[open]').getBoundingClientRect(),body=document.querySelector('.record-dialog[open] .record-dialog-body').getBoundingClientRect(),input=document.querySelector('.record-dialog[open] .drive-folder-form input').getBoundingClientRect(),gutter=Math.max(20,Math.min(56,innerWidth*.05));return {left:modal.left,right:innerWidth-modal.right,top:modal.top,bottom:innerHeight-modal.bottom,inputLeft:input.left-body.left,inputRight:body.right-input.right,gutter};");
          assert.equal(modalGeometry.left>=modalGeometry.gutter-1&&modalGeometry.right>=modalGeometry.gutter-1&&modalGeometry.top>=0&&modalGeometry.bottom>=0&&modalGeometry.inputLeft>=5&&modalGeometry.inputRight>=5,true,`Project modal has clear side margins and a fitting input at ${width}/${theme}: ${JSON.stringify(modalGeometry)}`);
          if(width===1440)assert.equal(await run("return document.querySelector('.record-dialog[open]').getBoundingClientRect().height<600;"),true,'Short settings fit their content');
          if(width===1440||width===900||width===375)await writeFile(path.join(profile,`project-modal-${width}-${theme}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
      }
      await click('.record-dialog[open] .record-modal-close');
      await navigate('/dashboard');
      await click('.request-monitoring tbody button');await sleep(100);
      await run("document.querySelector('.record-dialog[open] .record-dialog-body').scrollTop=200;return true;");
      assert.equal(await run("const modal=document.querySelector('.record-dialog[open]').getBoundingClientRect(),heading=document.querySelector('.record-dialog[open] .record-dialog-heading').getBoundingClientRect(),body=document.querySelector('.record-dialog[open] .record-dialog-body');return modal.bottom<=innerHeight&&heading.top>=0&&heading.bottom<=innerHeight&&body.scrollHeight>body.clientHeight&&body.scrollTop>0;"),true,'Long record details keep a fixed header and scrolling body');
      await click('.record-dialog[open] .record-modal-close');
      console.log(`Register smoke passed: complete Accounting groups, page sizes/ranges/resets, fixed headers/footers, responsive themes, modal focus and quotation action popovers. Screenshots: ${profile}`);
    } else {
      assert.equal(await run("return localStorage.getItem('hml-constructsync-demo-v12');"), before, 'Table layout and pagination change no records');
      console.log(`Table smoke passed: Accounting groups, pagination, filters, responsive themes, larger delivery lists, fixed headers and local scrolling. Screenshots: ${profile}`);
    }
  }
} finally { ws?.close(); browser.kill(); }
