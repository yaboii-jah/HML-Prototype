import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { transferCheckSql } from './helpers/transfer-check.mjs';

export function transferBrowserTools(client) {
  async function staff(role,projectId) {
    const identity={ email:randomUUID()+'@example.invalid',password:randomUUID() };
    const user=await client.auth.admin.createUser({ ...identity,email_confirm:true });
    assert.ifError(user.error);
    const userId=user.data.user.id;
    assert.ifError((await client.from('profiles').insert({ user_id:userId,display_name:'Transfer '+role,is_active:true })).error);
    assert.ifError((await client.from('role_grants').insert({ user_id:userId,role })).error);
    if (projectId) assert.ifError((await client.from('project_assignments').insert({ user_id:userId,project_id:projectId })).error);
    return identity;
  }
  const click=async (page,label) => {
    const expression=`const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await page.wait(expression+'return !!b;');
    await page.run(expression+'b.click();');
  };
  const field=(page,label,value,index=0)=>page.run(`
    const field=[...document.querySelectorAll('label.field')].filter(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)})[${index}];
    const input=field?.querySelector('select,input,textarea'); if(!input)throw Error('Transfer input missing');
    const type=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(type,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`);
  return { staff,click,field };
}

export async function checkTransferApproval({ browser,second,client,sql,login,logout }) {
  const definition=await transferCheckSql({definitionsOnly:true});
  const fixture=JSON.parse((await sql(definition+'select pg_temp.transfer_fixture(); commit;')).output.split('\n').find(line=>line.startsWith('{')));
  const { staff,click,field }=transferBrowserTools(client);
  const procurement=await staff('Procurement'), destination=await staff('Site Personnel',fixture.destination);
  const source=await staff('Site Personnel',fixture.source);
  await logout(browser); await login(browser,procurement);
  await browser.navigate(`/stock-transfers/source/${fixture.request}`);
  await browser.wait("return document.body.textContent.includes('Source project stock')");
  await field(browser,'Source project',fixture.source);
  await click(browser,'Add material');
  await field(browser,'Requested material',fixture.item);
  await field(browser,'Available source stock',fixture.direct);
  await field(browser,'Quantity','4');
  await browser.run("document.querySelector('.stock-transfer-approval-form input[type=checkbox]').click()");
  await click(browser,'Add material');
  await field(browser,'Requested material',fixture.item,1);
  await field(browser,'Available source stock',fixture.alternative,1);
  await field(browser,'Quantity','5',1);
  await field(browser,'Why this stock may meet the same specifications','Verified equivalent grade');
  await click(browser,'Send stock requests');
  await browser.wait("return document.body.textContent.includes('Awaiting destination review')&&document.body.textContent.includes('Awaiting source approval')");
  const rows=JSON.parse((await sql(`select jsonb_object_agg(status,id) from private.transfers where request_id='${fixture.request}';`)).output.trim());

  await logout(second); await login(second,destination); await second.navigate(`/stock-transfers/${rows.review_pending}`);
  await click(second,'Confirm suitability');
  await second.run("document.querySelector('.stock-transfer-approval-form input[type=checkbox]').click()");
  await field(second,'Written specification confirmation','Same specification and packaging');
  await click(second,'Save decision');
  await browser.wait("return document.body.textContent.includes('Suitable · awaiting release request')",30000);
  await browser.navigate(`/stock-transfers/${rows.review_pending}`);
  await click(browser,'Request source release');
  await field(browser,'Quantity for Requested cement (bags)','3');
  await click(browser,'Save decision');
  await browser.wait("return document.body.textContent.includes('Release requested')");

  await logout(second); await login(second,source); await second.navigate(`/stock-transfers/${rows.release_pending}`);
  assert.equal(await second.run(`return !!document.querySelector('a[href="/requests/${fixture.request}"]')`),false);
  await click(second,'Approve release');
  await field(second,'Quantity for Requested cement (bags)','2.5');
  await field(second,'Reason','Keep the balance for current site work');
  await second.run(`window.transferFetch=window.fetch;
    window.fetch=async function(input,init){
      const response=await window.transferFetch.call(this,input,init);
      if (new Headers(init?.headers).has('Next-Action') && typeof init?.body==='string' && init.body.includes('approveRelease')){
        await response.clone().arrayBuffer(); throw new Error('Interrupted transfer acknowledgement');
      }
      return response;
    };`);
  await click(second,'Save decision');
  await second.wait("return document.body.textContent.includes('Check saved outcome')");
  await second.run('window.fetch=window.transferFetch;delete window.transferFetch;');
  await click(second,'Check saved outcome');
  await second.wait("return document.body.textContent.includes('Approved · stock reserved')");
  assert.equal((await sql(`select quantity::text from private.stock_reservations where owner_id='${rows.release_pending}';`)).output.trim(),'2.5');
  for (const width of [1440,375]) {
    await second.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await second.run("return !!document.querySelector('.mobile-scrim')")) await second.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await second.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await second.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Transfer fits ${width}px`);
    const shot=await second.call('Page.captureScreenshot',{format:'png'});
    await writeFile(`.verification/transfer-approval-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await second.call('Emulation.clearDeviceMetricsOverride');
  console.log('Transfer sourcing, suitability, partial release, assigned access and lost-response recovery passed.');
}
