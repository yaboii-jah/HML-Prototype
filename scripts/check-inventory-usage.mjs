import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { transferBrowserTools } from './check-transfer-approval.mjs';
import { transferResult } from './check-transfer-races.mjs';
import { inventoryCheckSql } from './helpers/inventory-check.mjs';

export async function checkInventoryUsage({ browser,second,client,sql,login,logout }) {
  const fixture=await transferResult(sql,await inventoryCheckSql({ definitionsOnly:true })+'select pg_temp.transfer_fixture(); commit;');
  const { staff,click,field }=transferBrowserTools(client);
  const accounting=await staff('Accounting');
  const site=await staff('Site Personnel',fixture.destination);
  const source=await staff('Site Personnel',fixture.source);
  const finance=await staff('Finance');
  const content=(page,text)=>page.wait(`return document.body.textContent.includes(${JSON.stringify(text)});`);
  const enter=async(page,actor,path='/inventory')=>{ await logout(page); await login(page,actor); await page.navigate(path); };
  const open=(page,label,selector)=>page.wait(`
    if (document.querySelector(${JSON.stringify(selector)})) return true;
    [...document.querySelectorAll('button')].find(b=>!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})?.click();
    return false;`);
  await enter(browser,accounting);
  await open(browser,'Opening stock','select[required]');
  await field(browser,'Project',fixture.destination);
  await field(browser,'Material description','Fixture counted tiles');
  await field(browser,'Unit','box');
  await field(browser,'Opening quantity','7.125');
  await field(browser,'Reason','Counted stock already on site');
  await click(browser,'Review opening stock');
  await click(browser,'Confirm opening stock');
  await content(browser,'Stock entry recorded.');
  const account=(await sql(`select id from private.stock_accounts where project_id='${fixture.destination}' and description='Fixture counted tiles';`)).output.trim();
  const path=`/inventory/${fixture.destination}/${account}`;
  await enter(second,source);
  const denied=await second.run(`return (await fetch('/api/foundation/view?view=inventory&mode=material&projectId=${fixture.destination}&target=${account}')).json()`);
  assert.equal(denied.view.data.found,false);
  assert.deepEqual(denied.view.data.accounts,[]);
  assert.deepEqual(denied.view.data.movements,[]);
  assert.equal(await second.run(`return (await (await fetch(${JSON.stringify(path)})).text()).includes('Fixture counted tiles')`),false);

  await enter(browser,site,`/inventory/usage/new?siteId=${fixture.destination}&materialId=${account}`);
  await browser.wait("return !!document.querySelector('[aria-label^=\"Quantity used for Fixture counted tiles\"]:not(:disabled)')");
  await field(browser,'Usage explanation','Installed the tiles at the site');
  await browser.fill('[aria-label^="Quantity used for Fixture counted tiles"]','1.125');
  const draftPath=`/inventory/usage/new?siteId=${fixture.destination}&materialId=${account}`;
  await enter(browser,source,draftPath);
  assert.equal(await browser.run("return !!document.querySelector('[aria-label^=\"Quantity used for Fixture counted tiles\"]')"),false);
  await enter(browser,site,draftPath);
  await browser.wait("return document.querySelector('[aria-label^=\"Quantity used for Fixture counted tiles\"]')?.value==='1.125'");
  await click(browser,'Review usage');
  await content(browser,'6 box available after posting');
  await browser.run(`window.inventoryFetch=window.fetch;
    window.fetch=async(input,init)=>{
      const response=await window.inventoryFetch(input,init);
      if(new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('expectedVersion')){
        await response.clone().arrayBuffer(); throw Error('Lost usage response');
      }
      return response;
    };`);
  await click(browser,'Record usage');
  await content(browser,'Check saved outcome');
  await browser.navigate(draftPath);
  await click(browser,'Check saved outcome');
  await browser.wait("return /^\\/inventory\\/usage\\/[0-9a-f-]{36}$/.test(location.pathname)&&document.querySelector('h1')?.textContent==='Usage entry'");
  assert.equal((await sql(`select count(*) from private.stock_movements where account_id='${account}' and posting_kind='usage';`)).output.trim(),'1');
  await browser.navigate(path);
  await browser.wait("return !!document.querySelector('button.text-link')");
  await open(browser,'Link correction','.panel h2 + p');
  await content(browser,'Linked to the');
  await field(browser,'Quantity (box)','0.25');
  await field(browser,'Reason','Adjusted the usage after recounting');
  await click(browser,'Review correction');
  await click(browser,'Confirm correction');
  await content(browser,'6.25 box');
  await enter(second,finance,path);
  await content(second,'6.25 box');
  assert.equal(await second.run("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Review correction')"),false);
  for (const width of [1440,375]) {
    await second.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await second.run("return !!document.querySelector('.mobile-scrim')")) await second.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await second.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await second.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Inventory fits ${width}px`);
    const shot=await second.call('Page.captureScreenshot',{format:'png'});
    await writeFile(`.verification/inventory-usage-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await second.call('Emulation.clearDeviceMetricsOverride');
  console.log('Inventory role checks, opening count, draft reload, exactly-once usage and linked correction passed.');
}
