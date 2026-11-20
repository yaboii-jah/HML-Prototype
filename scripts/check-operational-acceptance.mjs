import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { operationalAcceptanceSql } from './helpers/operational-acceptance-check.mjs';
import { transferBrowserTools } from './check-transfer-approval.mjs';
import { transferJson as json, transferResult } from './check-transfer-races.mjs';

const legacyMarker = 'hml-constructsync-empty-workspace-v1';
const legacySnapshot = 'hml-constructsync-demo-v12';

export async function checkPrototypeRetirement(page) {
  const chunks = '.next/static/chunks';
  const files = (await readdir(chunks, { recursive: true })).filter(name => name.endsWith('.js'));
  assert.ok(files.length, 'The production build emitted client bundles');
  for (const name of files) {
    assert.ok(!(await readFile(chunks + '/' + name, 'utf8')).includes(legacyMarker), `Legacy initialization in ${name}`);
  }
  await page.navigate('/dashboard');
  await page.wait("return document.querySelector('h1')?.textContent==='Dashboard'&&!!document.querySelector('.masthead-account')");
  const seed = await page.run(`localStorage.removeItem(${JSON.stringify(legacyMarker)});
    localStorage.setItem('${legacySnapshot}','legacy fixture must stay untouched');
    return localStorage.getItem('${legacySnapshot}');`);
  await page.navigate('/inventory');
  assert.equal(await page.run(`window.dispatchEvent(new StorageEvent('storage',{
    key:${JSON.stringify(legacyMarker)}, oldValue:'1',newValue:null,storageArea:localStorage,url:location.href}));
    await new Promise(resolve=>setTimeout(resolve, 20));
    return localStorage.getItem('${legacySnapshot}');`), seed);
  assert.equal(await page.run(`return localStorage.getItem(${JSON.stringify(legacyMarker)})`), null);
}

export async function checkOperationalAcceptance({ browser, second, client, sql, login, logout }) {
  const definitions = await operationalAcceptanceSql({ definitionsOnly: true });
  const write = body => sql(definitions + body + ' commit;');
  const f = await transferResult(sql, definitions + 'select pg_temp.acceptance_fixture(); commit;');
  const { staff, click, field } = transferBrowserTools(client);
  const ids = await Promise.all([
    staff('Site Personnel', f.destination), staff('Site Personnel', f.source),
    staff('Procurement'), staff('Logistics'), staff('Accounting'), staff('Finance'),
  ]);
  async function enter(page, identity) {
    if (await page.run("return !!document.querySelector('.masthead-account')")) await logout(page);
    await login(page, identity);
    return page.run(`const result = await (await fetch('/api/realtime/session')).json();
      const { userId, revision, activeRole } = result.session;
      return { userId, revision, activeRole, sessionId: result.sessionId };`);
  }
  const site = await enter(second, ids[0]);
  const procurement = await enter(browser, ids[2]);
  const transfer = await transferResult(sql, definitions +
    `select pg_temp.acceptance_transfer(${json(f)},${json(procurement)}); commit;`);
  const source = await enter(browser, ids[1]);
  const requestRow = `[data-progress-request="${f.request}"]`;
  const progressPath = '/api/monitoring/view?mode=dashboardProgress&search=' + encodeURIComponent(f.ref);
  const sourceView = await browser.run(`return (await (await fetch(${JSON.stringify(progressPath)})).json()).view`);
  assert.deepEqual(sourceView.rows, [], 'Source-only Site sees no destination progress row');
  await browser.wait(`return !!document.querySelector('#actions a[href="/stock-transfers/${transfer.transfer}"]')`);
  await write(`select public.transfer_command(${json(source)},pg_temp.transfer_input(${json(transfer)},'approveRelease',
    '${transfer.transfer}',jsonb_build_object('quantities',jsonb_build_object('${transfer.line}','12'))));`);
  const finance = await enter(browser, ids[5]);
  await write(`select pg_temp.payment_action(${json(f)},'coordinate',
    '{"expectedLedger":"0","plan":{"priority":"Normal","status":"Pending","plannedDate":"","note":""}}',${json(finance)});`);
  const clearingAccountant = await enter(browser, ids[4]);
  await write(`select pg_temp.payment_action(${json(f)},'clear','{}',${json(clearingAccountant)});`);
  const logistics = await enter(browser, ids[3]);
  const delivery = randomUUID(), warehouse = randomUUID(), onward = randomUUID();
  await write(`select public.delivery_command(${json(logistics)},pg_temp.delivery_input(${json(f)},'schedule','${delivery}',
      jsonb_build_object('plan',pg_temp.delivery_plan(${json(f)},'6'))));
    select public.delivery_command(${json(logistics)},pg_temp.delivery_input(${json(f)},'dispatch','${delivery}',
      jsonb_build_object('departure',pg_temp.departure())));
    select public.delivery_command(${json(site)},pg_temp.delivery_input(${json(f)},'receive','${delivery}',
      pg_temp.acceptance_delivery_counts(${json(f)},'6')));
    select public.delivery_command(${json(site)},pg_temp.delivery_input(${json(f)},'post','${delivery}'));
    select public.transfer_trip_command(${json(logistics)},pg_temp.trip_input(${json(transfer)},'scheduleTrip','${warehouse}',
      pg_temp.trip_plan(${json(transfer)},'site-warehouse','12')));
    select public.transfer_trip_command(${json(logistics)},pg_temp.trip_input(${json(transfer)},'dispatchTrip','${warehouse}',
      jsonb_build_object('departure',pg_temp.departure())));`);
  const receiver = await enter(browser, ids[2]);
  await write(`select public.transfer_receipt_command(${json(receiver)},pg_temp.trip_input(${json(transfer)},'receiveTrip','${warehouse}',
    pg_temp.transfer_counts(${json(transfer)},'12','0','0')));`);
  const forwarder = await enter(browser, ids[3]);
  await write(`select public.transfer_trip_command(${json(forwarder)},pg_temp.trip_input(${json(transfer)},'scheduleTrip','${onward}',
      jsonb_set(pg_temp.trip_plan(${json(transfer)},'warehouse-site','12'),'{plan,parentTripId}',to_jsonb('${warehouse}'::uuid))));
    select public.transfer_trip_command(${json(forwarder)},pg_temp.trip_input(${json(transfer)},'dispatchTrip','${onward}',
      jsonb_build_object('departure',pg_temp.departure())));`);
  assert.equal((await sql(`select private.payment_paid('${f.po}');`)).output.trim(), '0');

  await second.navigate('/dashboard');
  await second.wait("return !!document.querySelector('input[name=reference]')");
  await field(second, 'Project', f.destination);
  await second.fill('input[name=reference]', f.ref.toLowerCase());
  await click(second, 'Search');
  await second.wait(`return document.querySelector('${requestRow} [data-stage="receipt"]')?.textContent.includes('Partial')`);
  assert.equal(await second.run(`return document.querySelector('${requestRow} a').getAttribute('href')`),
    `/requests/${f.request}#request-lifecycle-title`);
  for (const width of [1440, 375]) {
    await second.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    if (width < 500) await second.wait("return document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    await second.run("document.querySelector('#dashboard-progress-title').scrollIntoView()");
    assert.equal(await second.run('return document.documentElement.scrollWidth<=innerWidth+1'), true);
    const shot = await second.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/operational-acceptance-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  await second.call('Emulation.clearDeviceMetricsOverride');
  const network = offline => second.call('Network.emulateNetworkConditions', {
    offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await network(true);
  await enter(browser, ids[0]);
  await browser.navigate('/stock-transfers/' + transfer.transfer);
  await browser.wait(`
    const panel = document.querySelector('.transfer-trip-panel');
    if (panel?.textContent.includes('Discrepancy explanation')) return true;
    [...(panel?.querySelectorAll('button') ?? [])].find(button =>
      !button.disabled && button.textContent.trim() === 'Confirm site receiving')?.click();
    return false;`);
  await field(browser, 'Accepted', '12');
  await click(browser, 'Save receiving');
  await click(browser, 'Post accepted stock');
  await browser.run(`window.acceptanceFetch=window.fetch;
    window.fetch=async function(input,init){
      const response=await window.acceptanceFetch.call(this,input,init);
      if(new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('postTrip')){
        await response.clone().arrayBuffer();throw Error('Interrupted acceptance posting');
      }
      return response;
    };`);
  await click(browser, 'Confirm stock posting');
  await browser.wait("return document.body.textContent.includes('Check saved outcome')");
  await browser.run('window.fetch=window.acceptanceFetch;delete window.acceptanceFetch;');
  await click(browser, 'Check saved outcome');
  await browser.wait("return document.body.textContent.includes('Stock posted')");
  assert.equal((await sql(`select count(*) from private.stock_movements where source_id='${onward}' and posting_kind='receipt';`)).output.trim(), '1');
  assert.equal(await second.run(`return !!document.querySelector('${requestRow}')`), true);
  await network(false);
  await second.run("window.dispatchEvent(new Event('online'))");
  await second.wait(`return !document.querySelector('${requestRow}')`, 30000);
  await field(second, 'Requests', 'all');
  await second.wait(`return document.querySelector('${requestRow} [data-stage="posting"]')?.textContent.includes('Complete')`);

  const accountant = await enter(browser, ids[4]);
  const payment = { ...f, accountant };
  const draft = (await write(`select pg_temp.payment_draft(${json(payment)},'${f.net}','QA-${randomUUID()}');`)).output.match(/[0-9a-f-]{36}/)[0];
  await write(`select pg_temp.payment_proof(${json(payment)},'${draft}','${randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')}');
    select pg_temp.payment_action(${json(payment)},'verify',jsonb_build_object('draftId','${draft}','evidenceReviewed',true));`);
  assert.equal((await sql(`select private.payment_settled('${f.po}');`)).output.trim(), 't');
  const money = await browser.run(`return (await (await fetch('/api/monitoring/view?mode=reports&projectId=${f.destination}')).json()).view.financial[0]`);
  assert.equal(money.paid, f.net);
  assert.equal(Number(money.credit), 0);

  const account = (await sql(`select id from private.stock_accounts where project_id='${f.destination}';`)).output.trim();
  await enter(browser, ids[0]);
  await browser.navigate(`/inventory/usage/new?siteId=${f.destination}&materialId=${account}`);
  await browser.wait("return !!document.querySelector('[aria-label^=\"Quantity used for\"]:not(:disabled)')");
  await field(browser, 'Usage explanation', 'Accepted installation used three bags');
  await browser.fill('[aria-label^="Quantity used for"]', '3');
  await click(browser, 'Review usage');
  await click(browser, 'Record usage');
  await browser.wait("return document.querySelector('h1')?.textContent==='Usage entry'");
  assert.equal((await sql(`select private.stock_snapshot(array['${account}'::uuid])->0->>'onHand';`)).output.trim(), '15');
  const consumption = await browser.run(`return (await (await fetch('/api/monitoring/view?mode=consumption&projectId=${f.destination}')).json()).view.rows[0]`);
  assert.equal(consumption.receipts, '18');
  assert.equal(consumption.usage, '3');
  assert.equal(consumption.closing, '15');
  const lifecycle = await browser.run(`return (await (await fetch('/api/monitoring/view?mode=lifecycle&target=${f.request}')).json()).view`);
  assert.equal(lifecycle.items[0].posted, '18');
  assert.deepEqual(lifecycle.purchasing, [], 'The Site lifecycle keeps financial records confidential');
  await sql(`delete from public.project_assignments where user_id='${site.userId}' and project_id='${f.destination}';`);
  await second.wait(`return !document.querySelector('${requestRow}')||location.pathname==='/sign-in'`, 30000);
  const denied = await second.run(`const result=await fetch(${JSON.stringify(progressPath)});
    return { status:result.status, found:(await result.text()).includes(${JSON.stringify(f.request)}) };`);
  assert.equal(denied.found, false);
  assert.ok([200, 401, 403].includes(denied.status));
  console.log('Connected Credit purchase and warehouse transfer, shared posting, retry, usage, and current Site visibility passed.');
}
