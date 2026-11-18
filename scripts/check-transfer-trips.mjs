import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { transferBrowserTools } from './check-transfer-approval.mjs';
import { transferResult } from './check-transfer-races.mjs';
import { transferTripCheckSql } from './helpers/transfer-trip-check.mjs';

export async function checkTransferTrips({ browser,second,client,sql,login,logout }) {
  const definition=await transferTripCheckSql({ definitionsOnly:true });
  const fixture=await transferResult(sql,definition+'select pg_temp.trip_fixture(); commit;');
  const { staff,click,field }=transferBrowserTools(client);
  const logistics=await staff('Logistics'),procurement=await staff('Procurement'),source=await staff('Site Personnel',fixture.source);
  const path=`/stock-transfers/${fixture.transfer}`;
  const load='Load for Requested cement (bags)';
  const content=async(page,value)=>page.wait(`return document.querySelector('.transfer-trip-panel')?.textContent.includes(${JSON.stringify(value)});`);
  const confirm=page=>page.run("document.querySelector('.transfer-trip-editor input[type=checkbox]').click()");
  await logout(browser); await login(browser,logistics); await browser.navigate(path);
  await content(browser,'Transfer trips');
  await click(browser,'Schedule trip');
  await field(browser,load,'6');
  await field(browser,'Pickup and drop-off directions (optional)','Use the concrete loading bay');
  await click(browser,'Save schedule');
  await content(browser,'Use the concrete loading bay');
  await click(browser,'Revise trip');
  await field(browser,load,'4.125');
  await field(browser,'Reason','Short load confirmed at the source gate');
  await click(browser,'Save revision');
  await content(browser,'4.125 bags');
  await click(browser,'Schedule trip');
  await field(browser,'Route','site-warehouse');
  await field(browser,load,'3.875');
  await click(browser,'Save schedule');
  await content(browser,'Company Warehouse');
  await click(browser,'Record departure');
  await field(browser,'Driver (optional)','Original driver');
  await confirm(browser);
  await browser.run(`window.transferTripFetch=window.fetch;
    window.fetch=async function(input,init){
      const response=await window.transferTripFetch.call(this,input,init);
      if (new Headers(init?.headers).has('Next-Action') && typeof init?.body==='string' && init.body.includes('dispatchTrip')){
        await response.clone().arrayBuffer(); throw new Error('Interrupted dispatch acknowledgement');
      }
      return response;
    };`);
  await click(browser,'Record departure');
  await browser.wait("return document.body.textContent.includes('Check saved outcome')");
  await browser.run('window.fetch=window.transferTripFetch;delete window.transferTripFetch;');
  await click(browser,'Check saved outcome');
  await content(browser,'Original driver');
  await click(browser,'Correct departure');
  await field(browser,'Driver (optional)','Corrected driver');
  await field(browser,'Reason','Corrected spelling from the waybill');
  await click(browser,'Correct departure');
  await content(browser,'Corrected driver');

  await logout(second); await login(second,procurement); await second.navigate(path);
  await click(second,'Cancel undispatched balance');
  await second.wait("return document.querySelector('.transfer-trip-editor')?.textContent.includes('Trips that will be cancelled')");
  assert.match(await second.run("return document.querySelector('.transfer-trip-editor').textContent"),/Site to warehouse/);
  await field(second,'Reason','Remaining demand must reopen');
  await confirm(second);
  await click(second,'Cancel undispatched balance');
  await second.wait("return !document.querySelector('.transfer-trip-editor')&&[...document.querySelectorAll('.transfer-trip-heading .badge')].some(b=>b.textContent.trim()==='Cancelled')");
  const totals=await transferResult(sql,`select jsonb_build_object('moves',(select count(*) from private.stock_movements
    where source_kind='transfer_trip' and account_id='${fixture.direct}'),
    'quantity',(select sum(quantity) from private.stock_movements where source_kind='transfer_trip' and account_id='${fixture.direct}'),
    'demand',(select quantity from private.demand_claims where id='${fixture.line}'),
    'released',(select released from private.transfer_lines where id='${fixture.line}'));`);
  assert.deepEqual(totals,{moves:1,quantity:-4.125,demand:4.125,released:3.875});

  await logout(second); await login(second,source); await second.navigate('/stock-transfers');
  await second.wait(`return !!document.querySelector('a[href="${path}"]');`);
  await second.run(`document.querySelector('a[href="${path}"]').click();`);
  await content(second,'Corrected driver');
  assert.equal(await second.run(`return !!document.querySelector('a[href="/requests/${fixture.request}"]');`),false);
  assert.equal(await second.run("return [...document.querySelectorAll('.transfer-trip-panel button')].length;"),0);
  await second.run("document.querySelector('.transfer-trip-history summary').click(); document.querySelector('.transfer-trip-history li:nth-child(3) summary').click();");
  await content(second,'Original driver');
  for (const width of [1440,375]) {
    await second.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await second.run("return !!document.querySelector('.mobile-scrim')")) await second.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await second.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await second.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Trip detail fits ${width}px`);
    const shot=await second.call('Page.captureScreenshot',{format:'png'});
    await writeFile(`.verification/transfer-trip-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await second.call('Emulation.clearDeviceMetricsOverride');
  console.log('First-leg trip booking, split load, exactly-once departure, correction, balance cancellation and source visibility passed.');
}
