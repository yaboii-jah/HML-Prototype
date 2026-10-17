import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_FIXTURES } from '../../src/app-state/account-fixtures.ts';
import { inventoryFor } from '../../src/domain/selectors.ts';

const base = 'http://127.0.0.1:3100';
const output = path.resolve('artifacts/app-audit');
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-app-audit-'));
const port = 16000 + Math.floor(Math.random() * 1000);
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, base], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = process.argv.includes('--resume') ? JSON.parse(await readFile(path.join(output,'browser-audit.json'),'utf8')) : { profile, startedAt: new Date().toISOString(), visits: [], responsive: [], checks: [], exceptions: [], blockedExternal: [] };
delete report.failure;
report.profiles = [...(report.profiles||[report.profile]),profile];
let ws;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(p => p.type === 'page' && p.url.startsWith(base)); } catch { /* Wait for browser. */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('Browser did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      report.blockedExternal.push(message.params.request.url);
      void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ error: 'External integration disabled in audit profile.' })).toString('base64') });
    }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const run = async code => {
    const result = await call('Runtime.evaluate', { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (code, attempts = 250) => {
    for (let i = 0; i < attempts; i++) { if (await run(code)) return; await sleep(120); }
    throw new Error(`Timed out: ${code}; ${await run('return document.body.innerText.slice(0,500);')}`);
  };
  const fill = (selector, value) => run(`const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));`);
  const shot = async name => { const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(output, 'screenshots', `${name}.png`), Buffer.from(result.data, 'base64')); };
  const flush = () => writeFile(path.join(output, 'browser-audit.json'), JSON.stringify(report, null, 2));
  const inspect = () => run(`
    const visible=el=>el.checkVisibility()&&getComputedStyle(el).visibility!=='hidden';
    const name=el=>el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(' ').map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||[...(el.labels||[])].map(l=>l.textContent).join(' ').trim()||el.getAttribute('title')||el.textContent.trim();
    const controls=[...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea')].filter(visible);
    const rect=el=>{const r=el.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}};
    const main=document.querySelector('main')||document.body;
    return {path:location.pathname,title:document.title,h1:document.querySelector('h1')?.textContent,overflow:document.documentElement.scrollWidth-innerWidth,bodyText:main.innerText.slice(0,700),unlabelled:controls.filter(el=>!name(el)).map(el=>({tag:el.tagName,id:el.id,class:el.className})),smallControls:controls.filter(el=>{const r=el.getBoundingClientRect();return r.width<24||r.height<24}).slice(0,12).map(el=>({name:name(el).slice(0,60),...rect(el)})),errors:[...document.querySelectorAll('.inline-error,[role=alert]')].filter(visible).map(el=>el.textContent),tables:document.querySelectorAll('table').length,links:[...main.querySelectorAll('a[href]')].filter(visible).map(el=>({text:el.textContent.trim(),href:el.getAttribute('href')})).slice(0,15)};
  `);
  const navigate = async route => {
    const start = Date.now();
    await call('Page.navigate', { url: base + route });
    await wait('return !!document.querySelector("h1") && !document.querySelector(".skeleton-region,.workspace-skeleton");');
    await sleep(100);
    return { ...(await inspect()), durationMs: Date.now() - start };
  };
  const role = async label => {
    await run('document.querySelector(".masthead-account").click();');
    await wait('return !!document.querySelector(".role-options button");');
    await run(`const el=[...document.querySelectorAll('.role-options button')].find(el=>el.querySelector('strong')?.textContent===${JSON.stringify(label==='Accounting / Auditing'?'Accounting':label)});if(!el)throw Error('Missing account option');el.click();`);
    await wait(`return document.querySelector('.account-label small')?.textContent===${JSON.stringify(label==='Accounting / Auditing'?'Accounting':label)};`);
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/drive/*' }, { urlPattern: '*/api/quotes/extract' }, { urlPattern: '*/api/requests/extract' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait('return !!document.querySelector("#signin-email");', 600);
  report.checks.push({ name: 'Fresh browser initialization', result: 'passed', ...(await inspect()) });
  await shot('signin-desktop');
  const admin = ACCOUNT_FIXTURES.find(a => a.role === 'Administrator');
  await fill('#signin-email', admin.email); await fill('#signin-password', admin.password);
  await run('document.querySelector(".signin-form button").click();');
  await wait('return location.pathname==="/dashboard"&&!!document.querySelector(".masthead-account");');
  const state = await run('return JSON.parse(localStorage.getItem("hml-constructsync-demo-v12"));');
  report.seedCounts = Object.fromEntries(['sites', 'requests', 'quotes', 'pos', 'batches', 'movements', 'stockTransfers'].map(key => [key, state[key]?.length]));
  const lists = ['/dashboard','/projects','/requests','/suppliers','/purchase-orders','/accounting','/finance','/deliveries','/inventory','/reports','/admin'];
  if(!process.argv.includes('--finish')) {
  for (const account of ACCOUNT_FIXTURES) {
    if(report.visits.some(visit=>visit.role===account.role))continue;
    await role(account.role);
    for (const route of lists) report.visits.push({ role: account.role, ...(await navigate(route)) });
    const home = { 'Site Personnel':'/inventory','Project Manager':'/requests',Procurement:'/purchase-orders',Finance:'/finance',Logistics:'/deliveries','Accounting / Auditing':'/accounting',Administrator:'/dashboard' }[account.role];
    await navigate(home); await shot(`role-${account.role.replaceAll(/[^a-z]/gi,'-')}`);
    console.log('Audited role', account.role); await flush();
  }
  await role('Administrator');
  const draft = state.requests.find(r=>r.status==='draft');
  const approved = state.requests.find(r=>r.status==='approved');
  const po = state.pos.find(p=>p.status==='approved'&&p.issuance&&p.paymentMode==='upfront'&&!p.externalPayment)||state.pos[0];
  const stock = inventoryFor(state,state.sites[0].id)[0];
  const detailRoutes=[`/projects/${state.sites[0].id}`,`/requests/${approved.id}`,`/requests/${draft.id}/edit`,`/requests/${approved.id}/quotes`,`/purchase-orders/${po.id}`,`/purchase-orders/${state.pos.find(p=>p.status==='draft').id}/edit`,`/accounting/${po.id}`,`/finance/${po.id}`,`/deliveries/${state.batches[0].id}`,`/inventory/${state.sites[0].id}/${stock.id}`,`/stock-transfers/${state.stockTransfers[0].id}`,`/demo-files/${po.archive.fileId}`,'/requests/new','/deliveries/new','/admin/maintenance','/requests/audit-missing','/projects/audit-missing','/demo-files/audit-missing'];
  for(const route of detailRoutes) report.visits.push({role:'Administrator',...(await navigate(route))});
  const families=['/dashboard','/projects','/requests','/suppliers','/purchase-orders','/accounting','/finance','/deliveries','/inventory','/reports','/admin',detailRoutes[0],detailRoutes[1],detailRoutes[3],detailRoutes[4],detailRoutes[6],detailRoutes[8],detailRoutes[9],detailRoutes[10],detailRoutes[11],'/requests/new','/deliveries/new'];
  for(const theme of ['light','dark']) {
    for(const width of [1440,1280,768,414,375,320]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:width<800?812:720,deviceScaleFactor:1,mobile:width<800});
      for(const route of families){
        const requiredRole=route==='/requests/new'?'Site Personnel':route==='/deliveries/new'?'Logistics':route.endsWith('/quotes')?'Procurement':'Administrator';
        const shownRole=await run('return document.querySelector(".account-label small")?.textContent;');
        if(shownRole!==requiredRole)await role(requiredRole);
        await navigate(route); await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};`); await sleep(40);
        const found=await inspect(); report.responsive.push({role:requiredRole,theme,width,...found});
        if((width===1440||width===375)&&['/dashboard','/accounting','/requests/new',detailRoutes[3],detailRoutes[8],detailRoutes[11],'/reports'].includes(route)) await shot(`view-${route.replaceAll(/[^a-z0-9]/gi,'-')}-${width}-${theme}`);
      }
      console.log('Audited responsive layouts',width,theme);await flush();
    }
  }
  }
  // Real browser zoom equivalent: half the CSS viewport at twice device scale.
  await call('Emulation.setDeviceMetricsOverride',{width:640,height:360,deviceScaleFactor:2,mobile:false});
  for(const route of ['/dashboard','/accounting','/requests/new']) report.checks.push({name:'200% desktop reflow (equivalent CSS viewport)',...(await navigate(route))});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  report.checks.push({name:'Reduced motion',result:await run('return {preference:matchMedia("(prefers-reduced-motion: reduce)").matches,animation:getComputedStyle(document.body).animationDuration};')});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await role('Administrator');
  await navigate('/projects');
  await run('document.querySelector(".register tbody button").focus();document.querySelector(".register tbody button").click();');
  await wait('return !!document.querySelector("dialog[open]");');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await sleep(100);
  report.checks.push({name:'Project dialog Escape/focus restoration',result:await run('return {open:!!document.querySelector("dialog[open]"),focus:document.activeElement.textContent};')});
  const stock=inventoryFor(state,state.sites[0].id)[0];
  await role('Accounting / Auditing');
  await navigate(`/inventory/${state.sites[0].id}/${stock.id}`);
  report.checks.push({name:'Accounting stock action default',result:await run('const select=document.querySelector("form select");return {value:select.value,selectedDisabled:select.selectedOptions[0].disabled,options:[...select.options].map(o=>({value:o.value,disabled:o.disabled}))};')});
  await shot('accounting-stock-action-default');
  await role('Administrator');
  const originalRaw=await run('return localStorage.getItem("hml-constructsync-demo-v12");');
  await run(`const s=JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));for(const r of s.requests)r.createdAt='2026-10-13T12:00:00Z';s.requests[0].createdAt='2026-10-15T16:30:00Z';localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(s));`);
  await navigate('/reports');
  await fill('[aria-label="Report from date"]','2026-10-16');await fill('[aria-label="Report to date"]','2026-10-16');await sleep(100);
  report.checks.push({name:'Report Philippine midnight boundary',result:await run('return {targetCreatedAt:"2026-10-15T16:30:00Z",philippineDate:"2026-10-16",expectedRequests:1,actualSummary:document.querySelector(".metric-strip").innerText};')});
  await shot('reports-philippine-date-boundary');
  await run(`localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(originalRaw)});`);
  await role('Accounting / Auditing');
  const unpaid=state.pos.find(p=>p.status==='approved'&&p.issuance&&p.paymentMode==='upfront'&&!p.externalPayment);
  const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:`const AuditRealDate=Date;window.Date=class extends AuditRealDate{constructor(...args){super(...(args.length?args:['2026-10-15T16:30:00Z']));}static now(){return AuditRealDate.parse('2026-10-15T16:30:00Z');}};`});
  await navigate('/accounting/'+unpaid.id);
  report.checks.push({name:'Upfront payment default at Philippine 00:30',result:await run('return {defaultDate:document.querySelector(".external-payment-panel input[name=date]")?.value,philippineDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila"}).format(new Date())};')});
  await shot('upfront-payment-previous-day');
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
  await navigate('/accounting/'+unpaid.id);
  await role('Administrator');
  await navigate('/projects/'+state.sites[0].id);
  await fill('[aria-label="Search project documents"]','PCH-MRF-0001');await sleep(100);
  report.checks.push({name:'Project archive duplicate identities',result:await run('return [...document.querySelectorAll(".project-documents tbody tr")].map(r=>r.innerText);')});
  await run('document.querySelector(".project-documents").scrollIntoView({block:"center"});');await shot('project-archive-duplicate-names');
  await call('Fetch.enable',{patterns:[{urlPattern:'*/api/drive/*'},{urlPattern:'*/api/quotes/extract'},{urlPattern:'*/api/requests/extract'},{urlPattern:'*/api/bid-comparisons*'}]});
  await run('localStorage.removeItem("hml-constructsync-showcase-installed-v1");');
  await navigate('/dashboard');
  report.checks.push({name:'First-installation report service failure',result:await inspect()});
  await shot('installation-failure-recovery');
  await flush();
  console.log('Audit browser sweep complete',report.visits.length,report.responsive.length);
} catch(error) {
  report.failure=String(error.stack||error);console.error(report.failure);process.exitCode=1;
} finally {
  await writeFile(path.join(output,'browser-audit.json'),JSON.stringify(report,null,2));
  ws?.close();browser.kill();
}
