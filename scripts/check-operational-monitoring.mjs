import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { transferBrowserTools } from './check-transfer-approval.mjs';
import { transferResult } from './check-transfer-races.mjs';
import { monitoringCheckSql } from './helpers/monitoring-check.mjs';

export async function checkOperationalMonitoring({ browser, second, client, sql, login, logout }) {
  const fixture = await transferResult(sql, await monitoringCheckSql({ definitionsOnly: true }) +
    'select pg_temp.monitoring_fixture(); commit;');
  const { staff, click, field } = transferBrowserTools(client);
  const source = await staff('Site Personnel', fixture.source);
  const receiver = await staff('Site Personnel', fixture.destination);
  const logistics = await staff('Logistics');
  const consumption = '/inventory?view=consumption';
  const read = (page, path) => page.run(`const response=await fetch(${JSON.stringify(path)});
    return { status:response.status, cache:response.headers.get('cache-control'), body:await response.json() };`);
  const text = (page, value) => page.wait(`return document.body.textContent.includes(${JSON.stringify(value)})`);

  await logout(second);
  await second.navigate(consumption);
  assert.equal(await second.run("return location.pathname + location.search"), '/sign-in',
    'Signed-out users enter without carrying the previous workspace route');
  assert.equal((await read(second, '/api/monitoring/view?mode=bell')).status, 401);
  assert.equal((await read(second, '/api/monitoring/consumption.csv')).status, 401);
  await login(second, source);
  assert.equal(await second.run('return location.pathname'), '/dashboard');
  await text(second, 'Approve source stock release');
  await second.wait("return document.querySelector('.workspace-action-bell')?.getAttribute('aria-label')==='Ready actions (1)'");
  const transferPath = '/stock-transfers/' + fixture.transfer;
  assert.equal(await second.run(`return !!document.querySelector('#actions a[href="${transferPath}"]')`), true);
  const lifecycle = '/api/monitoring/view?mode=lifecycle&target=' + fixture.request;
  assert.equal((await read(second, lifecycle)).status, 404);
  assert.equal((await read(second, '/api/monitoring/view?mode=reports')).status, 403);
  assert.equal((await read(second, '/api/monitoring/consumption.csv?projectId=' + fixture.destination)).status, 403);
  assert.equal(await second.run("return !!document.querySelector('nav a[href=\"/reports\"]')"), false);
  await second.click(`#actions a[href="${transferPath}"]`);
  await second.wait(`return location.pathname===${JSON.stringify(transferPath)}`);

  await logout(browser);
  await login(browser, receiver);
  await browser.navigate('/requests/' + fixture.request);
  await text(browser, 'Source release pending');
  const safe = await read(browser, lifecycle);
  assert.equal(safe.status, 200);
  assert.match(safe.cache, /private.*no-store/);
  assert.equal(safe.body.view.items[0].releasePending, '8');
  assert.deepEqual(safe.body.view.purchasing, []);
  assert.deepEqual(safe.body.view.shipments, []);

  await second.navigate(consumption);
  await text(second, 'Consumption reconciliation');
  await text(second, 'Requested cement');
  await field(second, 'Material', 'Requested cement');
  await field(second, 'Unit', 'bags');
  await second.run(`window.monitoringFetch=window.fetch;
    let fail=true;
    window.fetch=async(input,init)=>{
      if(fail&&String(input).includes('mode=consumption')&&String(input).includes('search=')){
        fail=false; return new Response('{}',{status:503});
      }
      return window.monitoringFetch(input,init);
    };`);
  await click(second, 'Apply filters');
  await text(second, 'Updates could not be checked.');
  await click(second, 'Retry');
  await second.wait(`const link=document.querySelector('a[href^="/api/monitoring/consumption.csv"]');
    return !!link&&new URL(link.href).searchParams.get('search')==='Requested cement';`);
  const exported = await second.run(`const link=document.querySelector('a[href^="/api/monitoring/consumption.csv"]');
    const response=await fetch(link.href);
    return { cache:response.headers.get('cache-control'), type:response.headers.get('content-type'), body:await response.text() };`);
  assert.match(exported.cache, /private.*no-store/);
  assert.match(exported.type, /^text\/csv/);
  assert.match(exported.body, /Requested cement/);
  assert.doesNotMatch(exported.body, /Same grade cement/);

  await logout(browser);
  await login(browser, logistics);
  await browser.navigate('/reports');
  await text(browser, 'Operations reports');
  await field(browser, 'Project', fixture.source);
  await field(browser, 'From (PH)', '2000-01-01');
  await field(browser, 'Through (PH)', '2000-01-01');
  await click(browser, 'Apply filters');
  await text(browser, 'No activity was recorded for this selection.');
  await browser.click('#operations-report-tab-2');
  await text(browser, 'Requested cement');
  await browser.click('#operations-report-tab-3');
  await text(browser, 'Outstanding Credit');
  for (const width of [1440, 375]) {
    await second.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    if (width < 500) await second.wait("return document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await second.run(`return document.documentElement.scrollWidth<=innerWidth+1
      && [...document.querySelectorAll('.monitoring-filters .field,.monitoring-filter-form button,.header-actions a,.register-footer')].every(node=>{
        const bounds=node.getBoundingClientRect(); return bounds.left>=0&&bounds.right<=innerWidth+1;
      });`), true, `Monitoring filters, download and pagination fit ${width}px`);
    const shot = await second.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/operational-monitoring-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  await second.call('Emulation.clearDeviceMetricsOverride');
  console.log('Operational monitoring role boundaries, owning links, date filters, CSV, and read recovery passed.');
}
