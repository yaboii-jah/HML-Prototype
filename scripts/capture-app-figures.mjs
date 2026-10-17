import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_FIXTURES } from '../src/app-state/demo-session.ts';
import { inventoryFor } from '../src/domain/selectors.ts';

const base = 'http://127.0.0.1:3000';
const output = path.resolve('artifacts');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const onlyViews = process.argv.find(arg => arg.startsWith('--views='))?.slice(8).split(',');
const profile = await mkdtemp(path.join(os.tmpdir(), 'constructsync-paper-figures-'));
const port = 13000 + Math.floor(Math.random() * 1000);
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--disable-background-timer-throttling', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, base], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const slug = value => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
let entries = [], coverage = [], ws, nextImage = 1, currentRole = 'Public';
try { entries = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); nextImage = Math.max(0, ...entries.flatMap(entry => [entry.number, Number.parseInt(path.basename(entry.file), 10) || 0])) + 1; } catch {}
try { coverage = JSON.parse(await readFile(path.join(output, 'coverage.json'), 'utf8')); } catch {}
await mkdir(output, { recursive: true });
async function saveIndex() {
  for (const item of coverage) if (item.status === 'complete') item.count = entries.filter(entry => entry.group === item.id).length;
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(entries, null, 2));
  await writeFile(path.join(output, 'coverage.json'), JSON.stringify(coverage, null, 2));
  const intro = '# Application Figure Index\n\nSeparate desktop screenshots at 1440 × 900, light theme. Screens are documented by distinct feature, role, and workflow state. Number prefixes identify files only; assign final thesis figure numbers in your paper. Consecutive parts overlap. Tables retain representative first-page rows; horizontal captures include hidden columns.\n\n';
  const sections = [...new Set(entries.map(entry => entry.group))].sort();
  await writeFile(path.join(output, 'FIGURE_INDEX.md'), intro + sections.map(section => `## ${section.replaceAll('-', ' ')}\n\n` + entries.filter(entry => entry.group === section).map(entry => `- **${entry.caption}** — [${path.basename(entry.file)}](${entry.file})`).join('\n')).join('\n\n') + '\n');
  const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>ConstructSync Figure Gallery</title><style>body{font:16px system-ui;margin:32px;background:#f3f6fb;color:#17243a}h1{margin-bottom:8px}nav{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}section{scroll-margin-top:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px}figure{margin:0;background:white;border:1px solid #d9e2ee;border-radius:10px;overflow:hidden}img{width:100%;height:auto;display:block}figcaption{padding:16px;line-height:1.5}small{display:block;overflow-wrap:anywhere;color:#52627a}</style><h1>ConstructSync Application Figures</h1><p>Separate desktop screenshots. Click an image to open its original PNG. Suggested captions appear below each image.</p><nav>' + sections.map(section => `<a href="#${section}">${escapeHtml(section.replaceAll('-', ' '))}</a>`).join('') + '</nav>' + sections.map(section => `<section id="${section}"><h2>${escapeHtml(section.replaceAll('-', ' '))}</h2><main>` + entries.filter(entry => entry.group === section).map(entry => `<figure><a href="${entry.file}"><img loading="lazy" src="${entry.file}" alt="${escapeHtml(entry.caption)}"></a><figcaption>${escapeHtml(entry.caption)}<small>${escapeHtml(path.basename(entry.file))}</small></figcaption></figure>`).join('') + '</main></section>').join('') + '</html>');
  await writeFile(path.join(output, 'COVERAGE.md'), '# Screenshot Coverage\n\nShared screens are captured once unless roles expose different information or controls. Workflow examples use an isolated demo workspace. No production data is changed.\n\n' + coverage.map(item => `- ${item.status === 'complete' ? '[x]' : '[ ]'} **${item.id}**: ${item.status === 'complete' ? `${item.count} images` : item.error}`).join('\n') + '\n\nNo full-page or stitched screenshots are included. Artificial failure/loading states, every database record, and later pagination pages are outside the agreed coverage.\n');
}
try {
  let target;
  for (let n = 0; n < 100 && !target; n++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(p => p.type === 'page' && p.url.startsWith(base)); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw Error('Browser did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout: ' + method)); }, 25000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async code => {
    const result = await call('Runtime.evaluate', { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (code, limit = 450) => { for (let n = 0; n < limit; n++) { if (await run(code)) return; await sleep(100); } throw Error('Not ready: ' + code + '; ' + await run('return document.body?.innerText.slice(0,450);')); };
  const close = async () => { for (let n = 0; n < 4; n++) { if (!await run("return !!document.querySelector('dialog[open]');")) break; await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(130); } };
  const click = async (label, selector = 'button', partial = false) => {
    await run(`const elements=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>el.checkVisibility()&&!el.disabled);const el=elements.find(el=>${partial ? 'el.textContent.trim().includes' : 'el.textContent.trim()==='}${partial ? '(' : ''}${JSON.stringify(label)}${partial ? ')' : ''});if(!el)throw Error('Missing control: '+${JSON.stringify(label)});el.click();`);
    await sleep(200);
  };
  const clickSelector = async selector => { await run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility()&&!el.disabled);if(!el)throw Error('Missing selector '+${JSON.stringify(selector)});el.click();`); await sleep(200); };
  const fill = async (selector, value) => { await run(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing field '+${JSON.stringify(selector)});const kind=el.tagName==='TEXTAREA'?HTMLTextAreaElement:el.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));`); await sleep(200); };
  const expand = async () => { await run("for(const el of document.querySelectorAll('details'))if(el.checkVisibility())el.open=true;"); await sleep(180); };
  const navigate = async route => {
    await close(); await call('Page.navigate', { url: base + route });
    await wait(`return location.pathname===${JSON.stringify(route.split('?')[0])}&&!!document.querySelector('h1')&&!document.querySelector('.state-screen');`);
    await run("await document.fonts.ready;document.documentElement.dataset.theme='light';document.documentElement.dataset.sidebar='expanded';");
    await sleep(250);
    const problem = await run("return /Access unavailable|Record unavailable|could not be found/.test(document.querySelector('h1')?.textContent||'');");
    if (problem) throw Error('Unavailable route: ' + route);
  };
  const role = async label => {
    if (currentRole === label) return;
    await close(); await clickSelector('.masthead-account');
    await wait("return !!document.querySelector('.role-options');");
    await run(`const el=[...document.querySelectorAll('.role-options button')].find(el=>el.querySelector('strong')?.textContent===${JSON.stringify(label)});if(!el)throw Error('Role unavailable');el.click();`);
    await wait(`return document.querySelector('.account-label small')?.textContent===${JSON.stringify(label)}&&!document.querySelector('.role-dialog[open]');`);
    await sleep(180); currentRole = label;
  };
  let activeGroup = '';
  const capture = async (key, title) => {
    if (onlyViews && !onlyViews.includes(key)) return;
    await wait("return !document.querySelector('.archive-job[aria-busy=\"true\"],.toast-progress');", 900);
    await run("if(document.querySelector('.archive-job.has-error'))throw Error('Archive operation needs attention');for(const button of document.querySelectorAll('.archive-job.is-complete button,.toast:not(.toast-progress) .toast-close'))button.click();");
    await sleep(250);
    const startEntries = entries.filter(entry => entry.key === key);
    const additions = [];
    const openDialog = await run("return !!document.querySelector('dialog[open],.notification-popover');");
    await run("document.activeElement?.blur();for(const el of document.querySelectorAll('dialog[open],dialog[open] *,main *')){if(el.checkVisibility()&&['auto','scroll'].includes(getComputedStyle(el).overflowY))el.scrollTop=0;}if(!document.querySelector('dialog[open]'))window.scrollTo(0,0);");
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 225, y: 65 });
    const shot = async (section, part) => {
      await sleep(160);
      const number = nextImage++;
      const filename = `${String(number).padStart(4, '0')}-${slug(currentRole)}-${slug(title)}-${slug(section)}-part-${String(part).padStart(2, '0')}.png`;
      const folder = path.join(output, 'screenshots', activeGroup);
      await mkdir(folder, { recursive: true });
      const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await writeFile(path.join(folder, filename), Buffer.from(result.data, 'base64'));
      additions.push({ number, key, group: activeGroup, role: currentRole, viewTitle: title, section, part, caption: `${currentRole} — ${title} — ${section}${part > 1 ? ` (Part ${part})` : ''}`, file: `screenshots/${activeGroup}/${filename}`, route: await run('return location.pathname;') });
    };
    if (!openDialog) {
      let last = -1, part = 1;
      for (let n = 0; n < 45; n++) {
        const position = await run("return {y:scrollY,max:Math.max(0,document.documentElement.scrollHeight-innerHeight),section:[...document.querySelectorAll('main h2')].filter(el=>el.checkVisibility()&&el.getBoundingClientRect().top>=40&&el.getBoundingClientRect().top<750).map(el=>el.textContent).slice(0,2).join(' and ')};");
        if (position.y === last) break;
        await shot(position.y === 0 ? 'Overview' : position.section || 'Continued page details', part++);
        if (position.y >= position.max - 1) break;
        last = position.y;
        await run("window.scrollTo(0,Math.min(scrollY+750,document.documentElement.scrollHeight-innerHeight));");
      }
    } else await shot('Dialog overview', 1);
    const scrollables = await run("for(const el of document.querySelectorAll('[data-figure-scroll]'))el.removeAttribute('data-figure-scroll');const root=[...document.querySelectorAll('dialog[open]')].at(-1)||document.querySelector('.notification-popover')||document.querySelector('main')||document.body;return [root,...root.querySelectorAll('*')].filter(el=>el.checkVisibility()&&el.clientHeight>90&&(['auto','scroll'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+12||['auto','scroll'].includes(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+12)).map((el,index)=>{el.dataset.figureScroll=String(index);const holder=el.closest('section,.panel,.record-dialog');return {id:index,label:el.getAttribute('aria-label')||holder?.querySelector('h2,h3')?.textContent||[...el.querySelectorAll('th')].slice(0,2).map(e=>e.textContent).join(' and ')||'Detailed content',vertical:el.scrollHeight>el.clientHeight+12,horizontal:el.scrollWidth>el.clientWidth+12};});");
    for (const element of scrollables) {
      await run(`const el=document.querySelector('[data-figure-scroll="${element.id}"]');el.scrollIntoView({block:'center'});el.scrollTop=0;el.scrollLeft=0;`);
      for (const horizontal of element.horizontal ? [false, true] : [false]) {
        await run(`const el=document.querySelector('[data-figure-scroll="${element.id}"]');el.scrollTop=0;el.scrollLeft=${horizontal ? 'el.scrollWidth' : '0'};`);
        let part = 1;
        if (!element.vertical && !horizontal) continue;
        await shot(`${element.label}${horizontal ? ' — right-hand columns' : ' — scrolling details'}`, part++);
        for (let n = 0; n < 40 && element.vertical; n++) {
          const moved = await run(`const el=document.querySelector('[data-figure-scroll="${element.id}"]');const y=el.scrollTop;el.scrollTop+=Math.max(100,Math.min(el.clientHeight,760)-150);return el.scrollTop>y;`);
          if (!moved) break;
          await shot(`${element.label}${horizontal ? ' — right-hand columns' : ' — scrolling details'}`, part++);
        }
      }
    }
    for (const entry of startEntries) await unlink(path.join(output, entry.file)).catch(() => {});
    entries = entries.filter(entry => entry.key !== key).concat(additions);
    await saveIndex();
    console.log(`  ${key}: ${additions.length} image(s)`);
  };
  const group = async (id, fn) => {
    if (only && !only.includes(id)) return;
    activeGroup = id;
    console.log('Capturing ' + id);
    try {
      await fn();
      coverage = coverage.filter(item => item.id !== id).concat({ id, status: 'complete', count: entries.filter(entry => entry.group === id).length });
    } catch (error) {
      console.log('INCOMPLETE ' + id + ': ' + error.message);
      coverage = coverage.filter(item => item.id !== id).concat({ id, status: 'incomplete', error: error.message });
      await writeFile(path.join(output, `diagnostic-${id}.json`), JSON.stringify(await run("return {route:location.pathname,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].filter(el=>el.checkVisibility()).map(el=>({text:el.textContent,aria:el.getAttribute('aria-label')}))};"), null, 2));
    }
    await saveIndex(); await close();
  };
  const preview = async (key, title) => {
    await click('Print preview', 'button', true);
    await wait("return !!document.querySelector('dialog[open] .pdfViewer .page canvas');", 300);
    await capture(key, title); await close();
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait("return !!document.querySelector('#signin-email');", 900);
  await run("localStorage.setItem('constructsync-theme','light');document.documentElement.dataset.theme='light';document.documentElement.dataset.sidebar='expanded';await document.fonts.ready;");
  await group('01-access', async () => {
    await capture('sign-in', 'Account Sign-In');
    await fill('#signin-email', 'unregistered@example.com');
    await fill('#signin-password', 'ScreenshotExampleOnly!');
    await clickSelector('.signin-form button');
    await wait("return !!document.querySelector('#signin-error');");
    await capture('sign-in-validation', 'Sign-In Unrecognized Credentials Message');
  });
  const account = ACCOUNT_FIXTURES.find(a => a.role === 'Administrator');
  await fill('#signin-email', account.email); await fill('#signin-password', account.password); await clickSelector('.signin-form button');
  await wait("return location.pathname==='/dashboard'&&!!document.querySelector('.request-monitoring');", 900);
  currentRole = 'Administrator';
  const state = await run("return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12'));");
  if (state.sites.length !== 5 || state.requests.length !== 30) throw Error('Populated showcase unavailable');
  const site = state.sites[0], request = state.requests[0], comparisonRequest = state.requests[15], draftQuoteRequest = state.requests[17];
  const po = state.pos, batches = state.batches, transfers = state.stockTransfers;

  if (process.argv.includes('--report-table-figures')) {
    await role('Project Manager'); await navigate('/reports');
    const verify = async (code, message) => { if (!await run(code)) throw Error(message); };
    await verify("return document.querySelectorAll('.report-document-gaps tbody tr').length===10&&document.querySelectorAll('.report-site-stock tbody tr').length===10;", 'Both report tables render their first page');
    await fill('[aria-label="Search report document gaps"]', 'no-such-demo-po');
    await verify("return document.querySelectorAll('.report-document-gaps tbody tr').length===0;", 'Document gaps search');
    await fill('[aria-label="Search report document gaps"]', '');
    await fill('[aria-label="Search report site stock"]', 'Portland');
    await verify("return document.querySelectorAll('.report-site-stock tbody tr').length===5;", 'Stock search across projects');
    await fill('[aria-label="Search report site stock"]', '');
    await fill('[aria-label="Report project"]', site.id);
    await verify("return document.querySelector('.report-site-stock .register-footer').textContent.includes('of 12');", 'Project filter scopes stock');
    await fill('[aria-label="Report project"]', 'all');
    for (const width of [320,375,768,1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 801 }); await sleep(160);
      await verify('return document.documentElement.scrollWidth<=innerWidth+1;', 'Report tables fit width ' + width);
    }
    const old = entries.filter(entry => /^035[4-8]-/.test(path.basename(entry.file))).sort((a,b) => a.file.localeCompare(b.file));
    if (old.length !== 5) throw Error('Expected screenshot files 354–358');
    const shots = [
      ['.report-document-gaps', 'document-gaps-table-overview', 'Document Gaps Table Overview', false],
      ['.report-document-gaps', 'document-gaps-table-remaining-rows', 'Document Gaps Table Remaining Rows', true],
      ['.report-site-stock', 'current-site-stock-table-overview', 'Current Site Stock Table Overview', false],
      ['.report-site-stock', 'current-site-stock-table-remaining-rows', 'Current Site Stock Table Remaining Rows', true],
      ['.report-site-stock', 'current-site-stock-table-pagination', 'Current Site Stock Table Second Page', false]
    ];
    const replacements = [];
    for (const [index, [selector, name, caption, bottom]] of shots.entries()) {
      if (index === 4) await clickSelector('.report-site-stock button[aria-label="Next stock materials page"]');
      await run(`const section=document.querySelector(${JSON.stringify(selector)});window.scrollTo(0,section.getBoundingClientRect().top+scrollY-80);const frame=section.querySelector('.register-scroll');frame.scrollTop=${bottom ? 'frame.scrollHeight' : '0'};document.activeElement?.blur();`);
      await sleep(300);
      const filename = `${String(354 + index).padStart(4,'0')}-project-manager-reports-${name}.png`;
      const file = `screenshots/12-suppliers-and-reports/${filename}`;
      const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await writeFile(path.join(output, file), Buffer.from(result.data, 'base64'));
      replacements.push({ ...old[index], file, role: currentRole, section: caption, caption: `Project Manager — Operations Report — ${caption}`, part: 1 });
    }
    await verify("return document.querySelector('.report-site-stock .register-page-controls').textContent.includes('2 /');", 'Stock pagination');
    entries = entries.filter(entry => !old.some(previous => previous.file === entry.file)).concat(replacements);
    await saveIndex();
    for (const previous of old) await unlink(path.join(output, previous.file));
    console.log('Replaced screenshots 354–358; report table searches, project filtering, pagination and responsive checks passed.');
  } else {
  await group('02-dashboards', async () => {
    for (const label of ['Site Personnel','Project Manager','Procurement','Finance','Logistics','Accounting','Administrator']) {
      await role(label); await navigate('/dashboard'); await capture('dashboard-' + slug(label), 'Operations Dashboard');
    }
    await clickSelector('.notification-trigger'); await capture('notifications', 'Notifications and Pending Task Menu'); await clickSelector('.notification-trigger');
    await clickSelector('.masthead-account'); await capture('account-switcher', 'Account Details and Role Switching'); await close();
  });
  await group('03-projects', async () => {
    await role('Project Manager'); await navigate('/projects'); await capture('projects-management', 'Project Directory with Budgets and Management Actions');
    await click('Add project'); await capture('project-create', 'New Project and Site Form'); await navigate('/projects/' + site.id); await expand(); await capture('project-management-detail', 'Project Details Budgets Scopes Stock and Document Archive');
    // Verify the new project registers without retaining filtered state in figures.
    const verify = async (code, message) => { if (!await run(code)) throw Error(message); };
    await verify("return document.querySelectorAll('.project-stock tbody tr').length===10&&document.querySelectorAll('.project-documents tbody tr').length===10;", 'Project tables show their first page');
    await clickSelector('.project-stock button[aria-label="Next materials page"]');
    await verify("return document.querySelectorAll('.project-stock tbody tr').length===2;", 'Stock pagination reaches remaining materials');
    await fill('[aria-label="Search project stock"]', 'Portland');
    await verify("return document.querySelectorAll('.project-stock tbody tr').length===1&&document.querySelector('.project-stock tbody tr').textContent.includes('0');", 'Stock search includes zero-balance material');
    await fill('[aria-label="Search project stock"]', 'no-such-demo-material');
    await verify("return document.querySelectorAll('.project-stock tbody tr').length===0&&document.querySelector('.project-stock').textContent.includes('No materials match');", 'Stock filtered empty state');
    await fill('[aria-label="Search project stock"]', '');
    await clickSelector('.project-documents button[aria-label="Next documents page"]');
    await verify("return document.querySelector('.project-documents .register-page-controls').textContent.includes('2 /');", 'Document pagination');
    await fill('[aria-label="Search project documents"]', 'no-such-demo-document');
    await verify("return document.querySelectorAll('.project-documents tbody tr').length===0&&document.querySelector('.project-documents').textContent.includes('No documents match');", 'Document filtered empty state');
    await fill('[aria-label="Search project documents"]', '');
    const documentHref = await run("return document.querySelector('.project-documents tbody a').getAttribute('href');");
    await navigate(documentHref); await wait("return !!document.querySelector('.pdfViewer .page canvas');");
    await navigate('/projects/' + site.id);
    for (const width of [320,375,768,1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 801 }); await sleep(150);
      await verify('return document.documentElement.scrollWidth<=innerWidth+1;', 'Project tables fit width ' + width);
    }
    await click('Project settings');
    for (const tab of ['Project','Documents','Scopes']) { await click(tab, '[role=tab]'); await capture('project-settings-' + slug(tab), 'Project Settings ' + tab); }
    await clickSelector('[aria-label^="Edit allocation for "]'); await capture('scope-edit', 'Scope of Work Budget Allocation Form');
    await click('Project', '[role=tab]'); await click('Edit project'); await capture('project-edit', 'Edit Project Details Form'); await close();
    await role('Site Personnel'); await navigate('/projects'); await capture('projects-site-directory', 'Assigned Project Directory');
    await navigate('/projects/' + site.id); await capture('project-site-detail', 'Assigned Project Details Scopes and Stock');
  });
  await group('04-requests', async () => {
    await role('Site Personnel'); await navigate('/requests'); await capture('requests-site-list', 'Material Request Register and Site Actions');
    await navigate('/requests/new'); await capture('request-new', 'New Material Request Details Form');
    await navigate('/requests/' + state.requests[25].id + '/edit'); await capture('request-edit-details', 'Returned Material Request Details Form');
    await click('Next', 'button', true); await capture('request-edit-materials', 'Material Request Materials and Specifications');
    await click('+ Add material'); await capture('request-add-material', 'Add Requested Material Form'); await close();
    await clickSelector('[aria-label^="Edit material 1"]'); await capture('request-edit-material', 'Edit Requested Material Form'); await close();
    await click('Next', 'button', true); await expand(); await capture('request-review-submit', 'Material Request Review and Supporting Documents');
    await navigate('/requests/' + request.id); await expand(); await capture('request-site-approved', 'Approved Material Request Details and Lifecycle');
    await clickSelector('[aria-label^="View material 1"]'); await capture('request-material-details', 'Requested Material Specifications'); await close();
    await preview('mrf-print-preview', 'Material Request Form Print Preview');
    await role('Project Manager'); await navigate('/requests'); await capture('requests-manager-list', 'Material Requests Awaiting Project Manager Review');
    await navigate('/requests/' + state.requests[20].id); await expand(); await capture('request-pm-review', 'Submitted Material Request Approval Review');
    await click('Return with reason'); await capture('request-return-reason', 'Return Material Request for Correction');
    await navigate('/requests/' + state.requests[27].id); await expand(); await capture('request-rejected', 'Rejected Material Request and Decision History');
  });
  await group('05-procurement', async () => {
    await role('Procurement'); await navigate('/requests/' + state.requests[18].id + '/quotes'); await capture('stock-sourcing', 'Check Site Stock and Source Project Selection');
    await navigate('/requests/' + draftQuoteRequest.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(2)'); await expand(); await capture('quote-review-draft', 'Supplier Quotation Upload Review and Draft Editor');
    await clickSelector('[aria-label="Details for line 1"]'); await capture('quote-line-details', 'Supplier Quotation Material Line Details'); await close();
    await click('View documents'); await wait("return !!document.querySelector('dialog[open]');"); await sleep(750); await capture('quote-source-documents', 'Supplier Quotation Source Documents'); await close();
    await navigate('/requests/' + comparisonRequest.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(3)'); await expand(); await capture('quote-compare', 'Supplier Quotation Comparison Financial Summaries and Awards');
    await clickSelector('[aria-label^="Offer details for "]'); await capture('supplier-offer-details', 'Supplier Material Offer Details and Compliance'); await close();
    await clickSelector('[data-split-material]'); await capture('split-material-award', 'Split Material Award Quantity Allocation'); await close();
    await clickSelector('[data-award-supplier]'); await capture('supplier-award', 'Supplier Available Material Award Selection'); await close();
    await clickSelector('[data-choose-offer]'); await click('Review & save awards'); await capture('award-review', 'Supplier Award Review Before Saving'); await close();
    await click('Preview PDF'); await wait("return !!document.querySelector('dialog[open] .pdfViewer .page canvas');"); await capture('comparison-pdf-preview', 'Bid Comparison Report PDF Preview'); await close();
    await navigate('/requests/' + request.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(4)'); await capture('po-preparation', 'Purchase Order Preparation from Awarded Quotations');
  });
  await group('06-purchase-orders', async () => {
    await role('Procurement'); await navigate('/purchase-orders'); await capture('po-register', 'Purchase Order Register and Procurement Actions');
    await navigate('/purchase-orders/' + po[0].id); await expand(); await capture('po-draft', 'Draft Purchase Order Details and Costing');
    await navigate('/purchase-orders/' + po[0].id + '/edit'); await expand(); await capture('po-edit', 'Edit Purchase Order Lines Discounts and Supplier Terms');
    await navigate('/purchase-orders/' + po[20].id); await expand(); await capture('po-approved-issuance', 'Approved Purchase Order Supplier Issuance');
    await preview('po-print-preview', 'Purchase Order Print Preview');
    await navigate('/purchase-orders/' + po[30].id); await expand(); await capture('po-released', 'Released Purchase Order Payments and Delivery Progress');
    await role('Site Personnel'); await navigate('/purchase-orders/' + po[30].id); await expand(); await capture('po-site-readonly', 'Linked Purchase Order Site Personnel View');
  });
  await group('07-accounting', async () => {
    await role('Accounting'); await navigate('/accounting'); await capture('accounting-mrf-register', 'Accounting Material Request and Purchase Order Register');
    await fill('[aria-label="Search accounting"]', request.ref); await capture('accounting-expanded-mrf', 'Accounting Expanded Material Request and Related Purchase Orders');
    for (const [index, key, title] of [[6,'accounting-po-review','Purchase Order Financial Review and Approval'],[12,'accounting-po-held','Held Purchase Order and Review Reason'],[24,'accounting-upfront-pending','Full Disbursement Payment Proof and Verification'],[26,'accounting-upfront-verified','Verified Full Payment and Delivery Clearance'],[25,'accounting-credit-unpaid','Credit Terms Outstanding Balance and Payment Verification'],[29,'accounting-credit-partial','Credit Installment Verification and Payment History'],[42,'accounting-documents-complete','Completed Accounting Documents and Delivery Evidence']]) {
      await navigate('/accounting/' + po[index].id); await expand(); await capture(key, title);
    }
    await navigate('/accounting/' + po[6].id); await click('Hold with reason'); await capture('accounting-hold-form', 'Purchase Order Hold Decision and Reason');
  });
  await group('08-finance', async () => {
    await role('Finance'); await navigate('/finance'); await capture('finance-active', 'Active Supplier Payment Coordination Queue');
    await click('Settled (', '[role=tab]', true); await capture('finance-settled', 'Settled Supplier Payment Coordination');
    await click('Legacy payment requests', '[role=tab]'); await capture('finance-legacy', 'Legacy Payment Requests and Filters');
    await navigate('/finance/' + po[24].id); await expand(); await capture('finance-upfront-review', 'Full Disbursement Payment Coordination and Status Update');
    await navigate('/finance/' + po[25].id); await expand(); await capture('finance-credit-review', 'Credit Terms Payment Coordination and Balance');
  });
  await group('09-deliveries', async () => {
    await role('Logistics'); await navigate('/deliveries'); await capture('delivery-register', 'Delivery Batch Register and Site Stock Transfers');
    await click('Ready to schedule', '[role=tab]'); await capture('deliveries-ready', 'Purchase Orders Ready for Delivery Scheduling');
    await navigate('/deliveries/new?poId=' + po[30].id); await capture('delivery-create', 'Schedule Supplier to Site Delivery Batch');
    await fill('select[name="leg"]', 'supplier-warehouse'); await capture('delivery-create-warehouse', 'Schedule Supplier to Company Warehouse Delivery');
    const expected = batches.find(batch => batch.status === 'expected');
    await navigate('/deliveries/' + expected.id); await expand(); await capture('delivery-dispatch', 'Scheduled Delivery Details and Dispatch');
    const warehouse = batches.find(batch => batch.leg === 'supplier-warehouse');
    await navigate('/deliveries/' + warehouse.id); await expand(); await capture('warehouse-forwarding', 'Warehouse Receipt and Onward Delivery Progress');
    await navigate('/deliveries/new?poId=' + warehouse.poId + '&parentBatchId=' + warehouse.id); await capture('warehouse-onward-scheduling', 'Schedule Warehouse to Site Onward Delivery');
    await role('Site Personnel');
    for (const [status, key, title] of [['dispatched','delivery-site-receiving','Delivery Site Receiving Quantities and Shortage Notes'],['confirmed','delivery-stock-posting','Received Delivery Site Stock Posting Preview'],['posted','delivery-completed','Posted Delivery Receipt Evidence and Stock History']]) {
      const batch = batches.find(value => value.status === status && value.leg !== 'supplier-warehouse');
      await navigate('/deliveries/' + batch.id); await expand(); await capture(key, title);
    }
    await preview('delivery-receipt-print-preview', 'Delivery Receipt Print Preview');
  });
  await group('10-inventory', async () => {
    await role('Site Personnel'); await navigate('/inventory'); await capture('inventory-register', 'Site Inventory Balances Availability and Material Register');
    await clickSelector('[aria-label^="View inventory details for "]'); await capture('inventory-material-dialog', 'Inventory Material Balance and Movement Details'); await close();
    const material = inventoryFor(state, site.id).find(item => item.onHand > 0);
    await navigate('/inventory/' + site.id + '/' + material.id); await expand(); await capture('inventory-record-usage', 'Inventory Record Movement History and Site Usage');
    await role('Accounting'); await navigate('/inventory/' + site.id + '/' + material.id); await expand(); await capture('inventory-adjustment', 'Inventory Stock Adjustment and Audit History');
  });
  await group('11-stock-transfers', async () => {
    await role('Site Personnel'); await navigate('/stock-transfers/' + transfers[0].id); await expand(); await capture('transfer-source-review', 'Site Stock Transfer Source Release Review');
    await role('Logistics'); await navigate('/stock-transfers/' + transfers[1].id); await expand(); await capture('transfer-dispatch', 'Site Stock Transfer Trip Scheduling and Dispatch');
    await role('Site Personnel'); await navigate('/stock-transfers/' + transfers[2].id); await expand(); await capture('transfer-receiving', 'Site Stock Transfer Destination Receiving');
    await navigate('/stock-transfers/' + transfers[3].id); await expand(); await capture('transfer-posted', 'Completed Site Stock Transfer Receipt and Evidence');
    await preview('transfer-receipt-preview', 'Site Stock Transfer Receipt Print Preview');
    await role('Accounting'); await navigate('/stock-transfers/' + transfers[3].id); await expand(); await capture('transfer-accounting-review', 'Site Stock Transfer Accounting Document Review');
  });
  await group('12-suppliers-and-reports', async () => {
    await role('Procurement'); await navigate('/suppliers'); await capture('supplier-directory', 'Supplier Directory Contact and Accreditation');
    await clickSelector('[id^="supplier-details-"]'); await capture('supplier-details', 'Supplier Profile Contact Accreditation and Quotation History'); await close();
    await role('Project Manager'); await navigate('/reports'); await expand(); await capture('reports-all-projects', 'Management Reports Budgets Workflow Credit Documents and Inventory');
    const settled = await run("return [...document.querySelectorAll('[role=tab]')].some(el=>el.checkVisibility()&&el.textContent.startsWith('Settled ('));");
    if (settled) { await click('Settled (', '[role=tab]', true); await capture('reports-settled-coordination', 'Management Report Settled Payment Coordination'); }
  });
  await group('13-administration', async () => {
    await role('Administrator'); await navigate('/admin'); await capture('admin-projects', 'Administration Project Directory');
    if (await run("return !!document.querySelector('a[href=\"/admin/maintenance\"]');")) throw Error('Clear workspace action is still available');
    await click('Activity', '[role=tab]'); await capture('admin-activity', 'Administration Workspace Activity and Audit Filters');
    await click('Show details'); await capture('admin-activity-details', 'Administration Activity Event Details'); await close();
    await click('Users', '[role=tab]'); await capture('admin-users', 'Administration User Accounts Roles and Status');
    await click('Add user'); await capture('admin-add-user', 'Add User Account Role and Project Assignments');
    await clickSelector('.user-project-option');
    if (!await run("return new FormData(document.querySelector('.user-edit-form')).getAll('siteIds').length===1;")) throw Error('Project assignment selection failed');
    await clickSelector('.user-project-option');
    for (const width of [320,375,414,768,1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 801 }); await sleep(150);
      if (!await run("return document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.user-project-option')].every(el=>{const box=el.getBoundingClientRect(),text=el.querySelector('.user-project-copy').getBoundingClientRect(),input=el.querySelector('input').getBoundingClientRect();return text.left>=input.right&&text.right<=box.right;});")) throw Error('Assignment layout overflow at ' + width);
    }
    await close();
    await run("const row=[...document.querySelectorAll('.admin-users tbody tr')].find(el=>el.textContent.includes('Site Personnel'));[...row.querySelectorAll('button')].find(el=>el.textContent.trim()==='Edit').click();"); await sleep(200); await capture('admin-edit-user', 'Edit User Identity Role and Assigned Projects'); await close();
    await click('Reset password'); await capture('admin-password-reset', 'User Account Password Reset Form'); await close();
    await call('Page.navigate', { url: base + '/admin/maintenance' });
    await wait("return location.pathname==='/admin'&&!!document.querySelector('h1');");
    const retired = entries.filter(entry => entry.key === 'workspace-maintenance');
    entries = entries.filter(entry => entry.key !== 'workspace-maintenance');
    for (const entry of retired) await unlink(path.join(output, entry.file));
  });
  await group('14-archived-document-viewer', async () => {
    await role('Project Manager');
    const file = state.pos.find(value => value.archive?.fileId)?.archive.fileId;
    await navigate('/demo-files/' + file); await wait("return !!document.querySelector('.pdfViewer .page canvas');"); await capture('archived-document-viewer', 'Archived Purchase Order PDF Viewer and Download');
  });
  await group('15-supporting-views', async () => {
    await role('Finance'); await navigate('/projects'); await capture('projects-shared-readonly', 'Project Directory Shared Budget View');
    await navigate('/finance/' + po[25].id); await fill('.payment-coordination-form select[name="status"]', 'Delayed'); await capture('finance-delay-reason', 'Payment Coordination Delay Reason Form');
    await role('Project Manager'); await navigate('/requests/' + comparisonRequest.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(3)'); await expand(); await capture('comparison-readonly', 'Supplier Quotation Comparison Read-Only Management View');
    await role('Site Personnel'); await navigate('/requests/' + request.id); await expand();
    await clickSelector('.document-gallery-card'); await wait("return !!document.querySelector('dialog[open] .pdfViewer .page canvas');"); await capture('mrf-supporting-document', 'Material Request Supporting Document Preview'); await close();
    await role('Procurement'); await navigate('/requests/' + draftQuoteRequest.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(2)'); await click('Find quotation'); await capture('quotation-picker', 'Quotation Selection and Supplier Review Navigation'); await close();
    await role('Accounting'); await navigate('/accounting/' + po[35].id); await expand(); await capture('credit-fully-paid', 'Fully Paid Credit Terms Payment History and Delivery Status');
    await navigate('/accounting/' + po[26].id); await expand(); await click('Reopen verification'); await capture('upfront-correction', 'Full Payment Verification Correction Reason Form');
    await navigate('/accounting/' + po[29].id); await expand(); await click('Void incorrect payment'); await capture('credit-payment-correction', 'Credit Payment Correction and Audit Reason Form');
    await navigate('/accounting/' + po[42].id); await expand(); await click('View file'); await wait("return !!document.querySelector('dialog[open] .pdfViewer .page canvas');"); await capture('accounting-evidence-preview', 'Accounting Invoice and Supporting Evidence Preview'); await close();
  });
  await group('16-operational-form-examples', async () => {
    // Advance actual workflows only in this isolated demo browser to expose usable forms.
    await role('Accounting'); await navigate('/accounting/' + po[28].id); await expand(); await click('Confirm delivery clearance'); await wait("return !!document.querySelector('.confirm-dialog[open]');"); await clickSelector('.confirm-dialog[open] .confirm-actions button:last-child');
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).pos.find(p=>p.id===${JSON.stringify(po[28].id)}).status==='released';`);
    await role('Logistics'); await navigate('/deliveries'); await click('Ready to schedule', '[role=tab]'); await capture('deliveries-ready', 'Purchase Orders Ready for Delivery Scheduling');
    await navigate('/deliveries/new?poId=' + po[28].id); await fill('input[name="evidence"]', 'Supplier delivery coordination reference'); await capture('delivery-create', 'Schedule Supplier to Site Delivery Batch');
    await fill('select[name="leg"]', 'supplier-warehouse'); await capture('delivery-create-warehouse', 'Schedule Supplier to Company Warehouse Delivery');
    await click('Log batch'); await wait("return !!document.querySelector('.confirm-dialog[open]');"); await clickSelector('.confirm-dialog[open] .confirm-actions button:last-child');
    await wait("return /^\\/deliveries\\/[^/]+$/.test(location.pathname)&&location.pathname!='/deliveries/new'&&[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Dispatch delivery');");
    const warehouseId = await run("return location.pathname.split('/').at(-1);");
    await click('Dispatch delivery'); await wait("return !!document.querySelector('.confirm-dialog[open]');"); await clickSelector('.confirm-dialog[open] .confirm-actions button:last-child');
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).batches.find(b=>b.id===${JSON.stringify(warehouseId)}).status==='dispatched';`);
    await role('Procurement'); await navigate('/deliveries/' + warehouseId); await expand(); await capture('warehouse-receiving-form', 'Company Warehouse Receiving Accepted Quantities and Shortage Notes');
    await role('Site Personnel'); await navigate('/stock-transfers/' + transfers[2].id); await click('Confirm receiving'); await wait("return !!document.querySelector('.confirm-dialog[open]');"); await clickSelector('.confirm-dialog[open] .confirm-actions button:last-child');
    await wait(`return JSON.parse(localStorage.getItem('hml-constructsync-demo-v12')).transferDeliveries.some(d=>d.transferId===${JSON.stringify(transfers[2].id)}&&d.status==='confirmed');`);
    await expand(); await capture('transfer-stock-posting', 'Site Stock Transfer Accepted Quantity and Stock Posting Preview');
  });
  await group('17-notification-menu', async () => {
    await role('Administrator'); await navigate('/dashboard'); await clickSelector('.notification-trigger'); await capture('notifications', 'Notifications and Pending Task Menu'); await clickSelector('.notification-trigger');
  });
  await group('18-stock-sourcing-review', async () => {
    await role('Procurement'); await navigate('/requests/' + state.requests[18].id + '/quotes');
    const choice = await run("return [...document.querySelectorAll('select[aria-label^=\"Stock for \"]')].filter(el=>!el.disabled).map(el=>({label:el.getAttribute('aria-label'),value:[...el.options].find(option=>option.value)?.value})).find(el=>el.value);");
    if (!choice) throw Error('No suitable demo source stock');
    await fill(`select[aria-label=${JSON.stringify(choice.label)}]`, choice.value);
    await click('Review selections'); await capture('stock-selection-validation', 'Site Stock Transfer Quantity Validation');
    await fill('input[aria-label^="Quantity from "]', 1);
    await capture('stock-selection-quantity', 'Site Stock Material Matching and Transfer Quantity');
    await click('Review selections'); await wait("return !!document.querySelector('dialog[open]');"); await capture('stock-selection-review', 'Review Site Stock Selections and Remaining Purchasing Needs'); await close();
  });
  await group('19-quotation-review-modes', async () => {
    await role('Procurement'); await navigate('/requests/' + request.id + '/quotes'); await clickSelector('.procurement-steps button:nth-child(2)'); await click('All quotations'); await expand(); await capture('all-quotations-review', 'All Supplier Quotations Review and Financial Worksheets');
  });
  await group('20-mrf-import-sources', async () => {
    await role('Site Personnel'); await navigate('/requests/new');
    const sourceId = request.documents[0].fileId;
    const encoded = await run(`const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hml-quotation-files',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const blob=await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').get(${JSON.stringify(sourceId)});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));`);
    const sourcePath = path.join(profile, 'Pasig-Health-Center-Material-Request.pdf');
    await writeFile(sourcePath, Buffer.from(encoded, 'base64'));
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '.mrf-ai-import input[type="file"]' });
    await call('DOM.setFileInputFiles', { nodeId, files: [sourcePath] });
    await wait("return !!document.querySelector('.mrf-ai-sources');"); await capture('mrf-ai-import-source', 'Material Request AI Import Source Selection');
    await click('View source'); await wait("return !!document.querySelector('dialog[open] .pdfViewer .page canvas');"); await capture('mrf-ai-source-preview', 'Material Request AI Import Hardcopy Source Preview'); await close();
  });
  }
  await saveIndex();
  console.log(JSON.stringify({ images: entries.length, completed: coverage.filter(item => item.status === 'complete').length, incomplete: coverage.filter(item => item.status !== 'complete').map(item => item.id), output }));
} finally { ws?.close(); browser.kill(); }
