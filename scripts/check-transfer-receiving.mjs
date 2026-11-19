import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { transferBrowserTools } from './check-transfer-approval.mjs';
import { transferResult } from './check-transfer-races.mjs';
import { transferReceivingCheckSql } from './helpers/transfer-receiving-check.mjs';

export async function checkTransferReceiving({ browser,second,client,sql,login,logout,drive }) {
  const definition=await transferReceivingCheckSql({ definitionsOnly:true });
  const fixture=await transferResult(sql,definition+`
    create function pg_temp.receiving_browser_fixture() returns jsonb language plpgsql as $$
    declare f jsonb:=pg_temp.trip_fixture(); parent uuid:=gen_random_uuid();
    begin
      perform public.transfer_trip_command(f->'logistics',pg_temp.trip_input(f,'scheduleTrip',parent,pg_temp.trip_plan(f,'site-warehouse','6')));
      perform public.transfer_trip_command(f->'logistics',pg_temp.trip_input(f,'dispatchTrip',parent,jsonb_build_object('departure',pg_temp.departure())));
      return f||jsonb_build_object('warehouse',parent);
    end $$;
    select pg_temp.receiving_browser_fixture(); commit;
  `);
  const [folderId,rootId]=(await sql(`select folder_id||'|'||root_id from private.project_document_folders where project_id='${fixture.destination}' and current;`)).output.trim().split('|');
  drive.files.set(rootId,{ id:rootId,name:'Fixture root',parents:[],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{ canAddChildren:true } });
  drive.files.set(folderId,{ id:folderId,name:'Transfer fixture',parents:[rootId],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{ canAddChildren:true } });
  const { staff,click,field }=transferBrowserTools(client);
  const procurement=await staff('Procurement'),logistics=await staff('Logistics');
  const destination=await staff('Site Personnel',fixture.destination),source=await staff('Site Personnel',fixture.source);
  const accounting=await staff('Accounting');
  const path=`/stock-transfers/${fixture.transfer}`;
  const content=(page,value)=>page.wait(`return document.querySelector('.transfer-trip-panel')?.textContent.includes(${JSON.stringify(value)});`);
  const enter=async(page,identity)=>{ await logout(page); await login(page,identity); await page.navigate(path); await content(page,'Transfer trips'); };

  await enter(browser,procurement);
  await click(browser,'Confirm warehouse receiving');
  await field(browser,'Accepted','5.5'); await field(browser,'Missing','0.5');
  await field(browser,'Discrepancy explanation','Half a bag was missing at the warehouse');
  await click(browser,'Save receiving');
  await content(browser,'5.5 available to forward');

  await enter(browser,logistics);
  await click(browser,'Schedule onward trip');
  await field(browser,'Load for Requested cement (bags)','4');
  await click(browser,'Save schedule');
  await content(browser,'Warehouse to site');
  await click(browser,'Record departure');
  await browser.run("document.querySelector('.transfer-trip-editor input[type=checkbox]').click()");
  await click(browser,'Record departure');
  await content(browser,'1.5 available to forward');
  const onward=await transferResult(sql,`select jsonb_build_object('id',id,'ref',ref) from private.transfer_trips
    where parent_trip_id='${fixture.warehouse}' and state='dispatched';`);

  await enter(browser,destination);
  await click(browser,'Confirm site receiving');
  await field(browser,'Accepted','3.8'); await field(browser,'Rejected','0.2');
  await field(browser,'Discrepancy explanation','A damaged package contained 0.2 bags');
  await click(browser,'Save receiving');
  await click(browser,'Post accepted stock');
  await browser.run(`window.transferPostFetch=window.fetch;
    window.fetch=async function(input,init){
      const response=await window.transferPostFetch.call(this,input,init);
      if (new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('postTrip')) {
        await response.clone().arrayBuffer(); throw Error('Interrupted stock posting receipt');
      }
      return response;
    };`);
  await click(browser,'Confirm stock posting');
  await browser.wait("return document.body.textContent.includes('Check saved outcome')");
  await browser.run('window.fetch=window.transferPostFetch;delete window.transferPostFetch;');
  await click(browser,'Check saved outcome');
  await content(browser,'Stock posted');
  assert.equal((await sql(`select quantity from private.stock_movements where source_id='${onward.id}' and source_kind='transfer_receipt';`)).output.trim(),'3.8');

  const selector=`section[aria-label="Receiving for ${onward.ref}"]`;
  await browser.wait(`return !!document.querySelector(${JSON.stringify(selector+' a[href^="/api/transfer-files/"]')})`,30000);
  await browser.run(`const section=document.querySelector(${JSON.stringify(selector)});
    const receipt=await fetch(section.querySelector('a[href^="/api/transfer-files/"]').href);
    if(!receipt.ok)throw Error('Generated transfer receipt unavailable');
    const files=new DataTransfer();
    files.items.add(new File([await receipt.blob()],'signed-transfer-fixture.pdf',{ type:'application/pdf' }));
    const input=[...section.querySelectorAll('input[type=file]')].find(input=>input.multiple);
    input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.wait(`return [...document.querySelectorAll(${JSON.stringify(selector+' li')})].some(li=>
    li.textContent.includes('signed-transfer-fixture.pdf')&&li.textContent.includes('complete'));`,30000);
  const signed=(await sql(`select f.id from private.transfer_receipt_files f join private.transfer_receipt_versions v on v.id=f.version_id
    where v.trip_id='${onward.id}' and f.kind='signed' and f.current_evidence;`)).output.trim();
  assert.equal(await browser.run(`return (await fetch('/api/transfer-files/${signed}')).status`),403);
  await enter(second,source);
  await content(second,'3.8 bags accepted');
  assert.equal(await second.run(`return !!document.querySelector(${JSON.stringify(selector+' a[href^="/api/transfer-files/"]')});`),false);

  await enter(browser,accounting);
  await click(browser,'Approve receipt evidence');
  await content(browser,'Evidence approved');
  assert.equal(await browser.run(`return (await fetch('/api/transfer-files/${signed}',{ headers:{ Range:'bytes=0-4' } })).status`),206);
  for (const width of [1440,375]) {
    await browser.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await browser.run("return !!document.querySelector('.mobile-scrim')")) await browser.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await browser.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Transfer receiving fits ${width}px`);
    await browser.run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView();`);
    const shot=await browser.call('Page.captureScreenshot',{ format:'png' });
    await writeFile(`.verification/transfer-receiving-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  console.log('Transfer receiving, warehouse forwarding, posting recovery, and protected evidence review passed.');
}
