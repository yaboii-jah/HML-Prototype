import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { LocalUserDirectory, USER_STORAGE_KEY } from '../src/app-state/user-directory.ts';
import { SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { materialId } from '../src/domain/ids.ts';

const base = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/$/, '');
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-usage-'));
const port = 12000 + Math.floor(Math.random() * 1000);
const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const directory = new LocalUserDirectory(() => storage); await directory.load();
const fixture = seedDemo(), project = fixture.sites[0].id, second = fixture.sites[1].id;
fixture.role = 'Site Personnel'; fixture.siteFilter = 'all'; fixture.stockTransfers = []; fixture.transferDeliveries = [];
const names = ['01 Cement', '02 Plywood', ...Array.from({ length: 10 }, (_, i) => `${String(i + 3).padStart(2, '0')} Material with a long description for site consumption` )];
fixture.movements = names.map((name, i) => ({ id: `opening-${i}`, siteId: project, itemName: name, unit: i === 1 ? 'sheet' : 'bag', quantity: 10, kind: 'opening', reason: 'Opening balance', actor: 'Site Personnel', at: '2026-10-01T00:00:00Z' }));
fixture.movements.push({ ...fixture.movements[0], id: 'other-project-opening', siteId: second, quantity: 5 });
const data = JSON.parse(storage.getItem(USER_STORAGE_KEY)), author = data.users.find(u => u.role === 'Site Personnel');
author.siteIds = [project, second];
const other = { ...author, id: 'usage-other-person', email: 'usage.other@example.test', name: 'Other site person' };
const restricted = { ...author, id: 'usage-restricted-person', email: 'usage.restricted@example.test', name: 'Restricted site person', siteIds: [second] };
data.users.push(other, restricted);
const identity = user => ({ email: user.email, role: user.role, userId: user.id, revision: user.revision });
const cement = materialId(names[0], 'bag'), last = materialId(names[11], 'bag');
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(p => p.type === 'page'); } catch {} if (!target) await sleep(150); }
  assert.ok(target, 'Browser starts');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let counter = 0; const pending = new Map(), errors = [];
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); const p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 60000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params })); });
  const run = async code => { const r = await call('Runtime.evaluate', { expression: `(()=>{${code}})()`, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const wait = async code => { for (let i = 0; i < 400; i++) { if (await run(code)) return; await sleep(100); } throw new Error(`Timed out: ${code}\n${await run('return document.body.innerText.slice(-3500);')}`); };
  const navigate = async route => { await call('Page.navigate', { url: base + route }); await wait(`return location.pathname + location.search === ${JSON.stringify(route)} && !!document.querySelector('h1');`); };
  const fill = async (selector, value) => { await run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing '+${JSON.stringify(selector)}); const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;`); await sleep(60); };
  const click = async selector => { await run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing '+${JSON.stringify(selector)});el.click();return true;`); await sleep(100); };
  const button = async text => { await run(`const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('Missing button '+${JSON.stringify(text)});el.focus();el.click();return true;`); await sleep(100); };
  const snapshot = () => run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  const quantity = id => `#usage-quantity-${id}`;
  await call('Page.enable'); await call('Runtime.enable');
  const initializer = await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(new URL(base).origin)}&&!sessionStorage.getItem('usage-smoke-initialized')){localStorage.setItem('hml-constructsync-showcase-installed-v1','{"revision":1,"cleared":true}');localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});localStorage.setItem(${JSON.stringify(USER_STORAGE_KEY)},${JSON.stringify(JSON.stringify(data))});localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(identity(author)))});sessionStorage.setItem('usage-smoke-initialized','true');}` });
  await navigate('/inventory'); await wait("return !!document.querySelector('a[href=\"/inventory/usage/new\"]');");
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: initializer.identifier });
  await click('a[href="/inventory/usage/new"]'); await wait("return !!document.querySelector('select[aria-label=\"Usage project\"]');");
  await fill('select[aria-label="Usage project"]', project);
  await fill('textarea[name="reason"]', 'Slab and formwork consumption'); await fill(quantity(cement), '2.5');
  await button('Next'); // Next material page, excluding the navigation icon buttons by exact text.
  await wait(`return !!document.querySelector(${JSON.stringify(quantity(last))});`); await fill(quantity(last), '1');
  await fill('input[aria-label="Search usage materials"]', names[0]);
  await button('Review usage'); await wait("return !!document.querySelector('dialog[open]');");
  assert.match(await run("return document.querySelector('dialog[open]').innerText;"), /All 2 entered materials/);
  await call('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent', {type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await wait('return !document.querySelector("dialog[open]");');
  assert.equal(await run('return document.activeElement?.textContent;'), 'Review usage', 'Escape restores the review opener focus');
  await button('Review usage'); await wait('return !!document.querySelector("dialog[open]");');
  await button('Keep editing');
  // Each project restores independently; refresh retains the draft ID and strings.
  await fill('select[aria-label="Usage project"]', second); assert.equal(await run(`return document.querySelector(${JSON.stringify(quantity(cement))}).value;`), '');
  await fill('textarea[name="reason"]', 'Other project work'); await fill(quantity(cement), '1');
  await fill('select[aria-label="Usage project"]', project); assert.equal(await run(`return document.querySelector(${JSON.stringify(quantity(cement))}).value;`), '2.5');
  await navigate(`/inventory/usage/new?siteId=${project}`); await wait(`return !!document.querySelector(${JSON.stringify(quantity(cement))});`);
  assert.equal(await run(`return document.querySelector(${JSON.stringify(quantity(cement))}).value;`), '2.5');
  await run('document.querySelector("textarea[name=reason]").focus();return true;');
  await call('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
  await call('Input.dispatchKeyEvent', {type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
  assert.equal(await run('return document.activeElement?.getAttribute("aria-label");'), 'Search usage materials', 'Keyboard can reach stock controls from the explanation');
  await fill(quantity(cement), '-1'); await button('Review usage');
  assert.equal(await run('return !!document.querySelector("dialog[open]");'), false);
  assert.equal((await snapshot()).usageEntries?.length || 0, 0);
  await fill(quantity(cement), '2.5');
  await click('tr:has(input[id="usage-quantity-' + cement + '"]) summary');
  await fill(`textarea[aria-label="Explanation: ${names[0]} (bag)"]`, 'Concrete slab pouring');
  // Another account cannot restore this account's private draft.
  await run(`localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(identity(other)))});return true;`);
  await navigate(`/inventory/usage/new?siteId=${project}`); await wait(`return !!document.querySelector(${JSON.stringify(quantity(cement))});`);
  assert.equal(await run(`return document.querySelector(${JSON.stringify(quantity(cement))}).value;`), '');
  await run(`localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(identity(author)))});return true;`);
  await navigate(`/inventory/usage/new?siteId=${project}`); await wait(`return !!document.querySelector(${JSON.stringify(quantity(cement))});`);
  // Both themes and all planned widths; keyboard focus and control containment.
  for (const width of [320, 375, 414, 768, 1440]) for (const theme of ['light', 'dark']) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 });
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector(${JSON.stringify(quantity(cement))}).focus();return true;`); await sleep(80);
    assert.equal(await run('return document.documentElement.scrollWidth<=innerWidth+2;'), true, `No page overflow ${width}/${theme}`);
    assert.equal(await run(`const el=document.querySelector(${JSON.stringify(quantity(cement))});const cell=el.closest('td');return el.getBoundingClientRect().right<=cell.getBoundingClientRect().right+1;`), true, `Quantity stays within cell ${width}/${theme}`);
    if (width < 700) assert.equal(await run('const table=document.querySelector("fieldset table"), frame=table.closest(".register-scroll");return table.getBoundingClientRect().width<=frame.clientWidth+1 && [...table.querySelectorAll("tbody tr:first-child td")].every(td=>td.getBoundingClientRect().right<=frame.getBoundingClientRect().right+1);'), true, `All material cells fit the phone card ${width}/${theme}`);
    if ([375, 1440].includes(width)) { await run('const frame=document.querySelector("fieldset .register-scroll");frame.scrollTop=0;frame.scrollLeft=0;frame.scrollIntoView({block:"start"});return true;'); const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(profile, `usage-${width}-${theme}.png`), Buffer.from(shot.data, 'base64')); }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await button('Review usage'); await wait('return !!document.querySelector("dialog[open]");');
  // Stock changes after review: confirmation must revalidate and keep the draft.
  await run("const s=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));s.movements[0].quantity=1;localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:'hml-constructsync-demo-v12'}));return true;");
  await button('Record usage'); assert.equal((await snapshot()).usageEntries?.length || 0, 0);
  await wait('return !!document.querySelector("[aria-invalid=true]");');
  assert.equal(await run(`return document.querySelector(${JSON.stringify(quantity(cement))}).value;`), '2.5');
  await run("const s=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));s.movements[0].quantity=10;localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:'hml-constructsync-demo-v12'}));return true;");
  await button('Review usage'); await wait('return !!document.querySelector("dialog[open]");');
  // A failed snapshot write retains a recoverable draft; retry writes the same entry once.
  await run("window.__usageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='hml-constructsync-demo-v12')throw new DOMException('Full','QuotaExceededError');return window.__usageSetItem.call(this,key,value)};return true;");
  await button('Record usage'); await wait("return location.pathname.startsWith('/inventory/usage/usage-')&&document.querySelector('h1')?.textContent==='Usage entry';");
  const route = await run('return location.pathname;'); assert.equal((await snapshot()).usageEntries?.length || 0, 0);
  await run('Storage.prototype.setItem=window.__usageSetItem;return true;');
  // Client navigation preserves the volatile snapshot for the retry.
  await click('a[href="/inventory?view=usage"]'); await wait("return document.querySelector('h1')?.textContent==='Site inventory';");
  await click('a[href="/inventory/usage/new"]'); await wait("return !!document.querySelector('select[aria-label=\"Usage project\"]');");
  await fill('select[aria-label="Usage project"]', project); await button('Retry saving entry');
  await wait("return document.querySelector('h1')?.textContent==='Usage entry';");
  const saved = await snapshot(); assert.equal(saved.usageEntries.length, 1); assert.equal(saved.movements.filter(m => m.usageEntryId).length, 2);
  assert.equal(saved.movements.find(m => m.usageEntryId && m.itemName === names[0]).quantity, -2.5);
  assert.equal(saved.movements.find(m => m.usageEntryId && m.itemName === names[0]).reason, 'Concrete slab pouring');
  assert.equal(saved.activity.filter(a => a.entity === saved.usageEntries[0].id).length, 1);
  await navigate(route); assert.match(await run('return document.body.innerText;'), /Concrete slab pouring/);
  await navigate(`/inventory/${project}/${cement}`); await wait("return document.body.innerText.includes('Open usage entry');");
  await navigate('/inventory?view=usage'); await wait("return document.querySelector('[role=tab][aria-selected=true]')?.textContent==='Usage entries';");
  await run(`localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(identity(restricted)))});return true;`);
  await navigate(route); await wait("return document.body.innerText.includes('Access unavailable');");
  assert.equal(errors.length, 0, 'No browser runtime exceptions');
  console.log(`Usage browser smoke passed: drafts, paging/filter review, project/account isolation, validation, live stock changes, volatile retry, single deduction/audit, history, permissions and responsive themes. Screenshots: ${profile}`);
} finally { ws?.close(); browser.kill(); }
