import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { deliveryCheckSql } from './helpers/delivery-check.mjs';

/** Actual Logistics session/UI against owned disposable records; no hosted data. */
export async function checkDeliveries({ browser, second, client, sql, login, logout, drive }) {
  const definition = await deliveryCheckSql({ definitionsOnly:true });
  const fixture = JSON.parse((await sql(definition + 'select pg_temp.delivery_fixture(); commit;')).output.split('\n').find(x=>x.startsWith('{')));
  const [folderId, rootId] = (await sql(`select folder_id||'|'||root_id from private.project_document_folders where project_id='${fixture.project}' and current;`)).output.trim().split('|');
  drive.files.set(rootId,{ id:rootId,name:'Fixture root',parents:[],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{ canAddChildren:true } });
  drive.files.set(folderId,{ id:folderId,name:'Fixture deliveries',parents:[rootId],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{ canAddChildren:true } });
  const staff = { email:randomUUID()+'@example.invalid',password:randomUUID() };
  const user = await client.auth.admin.createUser({ ...staff,email_confirm:true });
  assert.ifError(user.error); staff.id = user.data.user.id;
  assert.ifError((await client.from('profiles').insert({ user_id:staff.id,display_name:'Delivery Logistics reviewer',is_active:true })).error);
  assert.ifError((await client.from('role_grants').insert({ user_id:staff.id,role:'Logistics' })).error);
  const click = async label => {
    const expression = `const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await browser.wait(expression+'return !!b;'); await browser.run(expression+'b.click();');
  };
  const field = async (label,value) => browser.run(`const l=[...document.querySelectorAll('label.field')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)});const el=l?.querySelector('input,textarea,select');if(!el)throw Error('Delivery field missing');const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`);
  await logout(browser); await login(browser,staff);
  await browser.navigate('/deliveries/new');
  await browser.wait("return document.body.textContent.includes('Select an issued purchase order')");
  await field('Purchase order',fixture.po); await click('Plan delivery');
  await field('Pickup address','Supplier bay'); await field('Destination address','Assigned project site access road');
  const quantityLabel = await browser.run("return document.querySelectorAll('fieldset')[1].querySelector('label.field span').textContent");
  await field(quantityLabel,'2'); await click('Save schedule');
  await browser.wait("return location.pathname.startsWith('/deliveries/')&&!location.pathname.endsWith('/new')&&document.body.textContent.includes('Retained history')");
  const id = await browser.run("return location.pathname.split('/').pop()");
  assert.equal(await browser.run("return [...document.querySelectorAll('button')].find(b=>b.textContent==='Record dispatch').disabled"),true);
  // Two authenticated colleagues see the same persisted load through protected refreshes.
  await logout(second); await login(second,staff); await second.navigate(`/deliveries/${id}`);
  await second.wait("return document.body.textContent.includes('Assigned project site access road')");
  await click('Revise schedule'); await field('Notes (optional)','Changed truck booking');
  await field('Reason for revision','Supplier changed the truck booking'); await click('Save schedule');
  await second.wait("return document.body.textContent.includes('Changed truck booking')",30000);
  await sql(definition+`select pg_temp.delivery_clear('${JSON.stringify(fixture)}'::jsonb); commit;`);
  await browser.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Record dispatch'&&!b.disabled)",30000);
  await click('Record dispatch');
  await browser.run("document.querySelector('.delivery-form input[type=checkbox]').click()");
  await browser.run(`window.deliveryOriginalFetch=window.fetch;window.deliveryLostResponse=false;
    window.fetch=async function(input,init){const response=await window.deliveryOriginalFetch.call(this,input,init);
      if(!window.deliveryLostResponse&&new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('dispatch')){
        window.deliveryLostResponse=true;await response.clone().arrayBuffer();throw new TypeError('Synthetic lost delivery acknowledgement');}
      return response;};`);
  await click('Confirm dispatch');
  await browser.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Check saved outcome'&&!b.disabled)");
  assert.equal(await browser.run('return window.deliveryLostResponse'),true);
  await browser.run('window.fetch=window.deliveryOriginalFetch;delete window.deliveryOriginalFetch;');
  await click('Check saved outcome');
  await browser.wait("return document.body.textContent.includes('Recorded departure')");
  assert.equal((await sql(`select state from private.deliveries where id='${id}';`)).output.trim(),'dispatched');
  await click('Correct departure details'); await field('Reference (optional)','Supplier DR-412');
  await field('Reason','Supplier provided the final reference');
  await browser.run("document.querySelector('.delivery-form input[type=checkbox]').click()");
  await click('Confirm correct'); await browser.wait("return document.body.textContent.includes('Supplier DR-412')");
  await mkdir('.verification',{ recursive:true });
  for (const width of [1440,375]) {
    await browser.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await browser.run("return !!document.querySelector('.mobile-scrim')")) await browser.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await browser.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Delivery fits ${width}px`);
    const shot = await browser.call('Page.captureScreenshot',{ format:'png' });
    await writeFile(`.verification/delivery-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  const site = { email:randomUUID()+'@example.invalid',password:randomUUID() };
  const createdSite = await client.auth.admin.createUser({ ...site,email_confirm:true });
  assert.ifError(createdSite.error); site.id = createdSite.data.user.id;
  assert.ifError((await client.from('profiles').insert({ user_id:site.id,display_name:'Assigned delivery receiver',is_active:true })).error);
  assert.ifError((await client.from('role_grants').insert({ user_id:site.id,role:'Site Personnel' })).error);
  assert.ifError((await client.from('project_assignments').insert({ user_id:site.id,project_id:fixture.project })).error);
  await logout(second); await login(second,site); await second.navigate(`/deliveries/${id}`);
  await second.wait("return document.body.textContent.includes('Supplier DR-412')");
  assert.equal(await second.run("return [...document.querySelectorAll('button')].some(b=>/Revise schedule|Record dispatch|Correct departure/.test(b.textContent))"),false);
  const projection = await second.run("return (await fetch('/api/foundation/view?view=deliveries')).json()");
  assert.equal(projection.view.data.role,'Site Personnel');
  assert.ok(projection.view.data.deliveries.some(d=>d.id===id));
  assert.doesNotMatch(JSON.stringify(projection.view.data),/"(?:gross|net|paid|proof|budget|unitPrice|calculation)"/);
  assert.equal(await second.run(`return (await fetch('/api/foundation/view?view=payments&poId=${fixture.po}')).status`),403);
  await logout(browser); await login(browser,site); await browser.navigate(`/deliveries/${id}`);
  await click('Confirm receipt');
  await field('Accepted','1.5'); await field('Missing','0.5');
  await field('Discrepancy explanation','Half a bag was short');
  await click('Save receipt');
  await browser.wait("return document.body.textContent.includes('Procurement follow-up required')");
  await browser.run(`window.deliveryOriginalFetch=window.fetch;window.deliveryLostResponse=false;
    window.fetch=async function(input,init){const response=await window.deliveryOriginalFetch.call(this,input,init);
      if(!window.deliveryLostResponse&&new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('"post"')){
        window.deliveryLostResponse=true;await response.clone().arrayBuffer();throw new TypeError('Synthetic lost stock acknowledgement');}
      return response;};`);
  await click('Post accepted stock');
  await browser.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Check saved outcome'&&!b.disabled)");
  await browser.run('window.fetch=window.deliveryOriginalFetch;delete window.deliveryOriginalFetch;');
  await click('Check saved outcome');
  await browser.wait("return document.body.textContent.includes('Stock posted')");
  assert.equal((await sql(`select quantity::text from private.stock_movements where source_id='${id}';`)).output.trim(),'1.5');
  await browser.wait("return [...document.querySelectorAll('a')].some(link=>link.textContent==='Open generated receipt')",30000);
  await browser.run(`const link=[...document.querySelectorAll('a')].find(link=>link.textContent==='Open generated receipt');
    const response=await fetch(link.href); if(!response.ok)throw Error('Receipt PDF unavailable');
    const transfer=new DataTransfer();transfer.items.add(new File([await response.blob()],'signed-fixture.pdf',{type:'application/pdf'}));
    const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.wait("return [...document.querySelectorAll('p')].some(p=>p.textContent.includes('Signed evidence')&&p.textContent.includes('complete'))",30000);
  const signedId = (await sql(`select f.id from private.delivery_receipt_files f join private.delivery_receipt_versions v on v.id=f.version_id where v.delivery_id='${id}' and f.current_evidence;`)).output.trim();
  assert.equal(await browser.run(`return (await fetch('/api/delivery-files/${signedId}')).status`),403);
  assert.equal(await browser.run("return [...document.querySelectorAll('a')].some(link=>link.textContent==='Open signed evidence')"),false);
  const accountant = { email:randomUUID()+'@example.invalid',password:randomUUID() };
  const createdAccountant = await client.auth.admin.createUser({ ...accountant,email_confirm:true });
  assert.ifError(createdAccountant.error); accountant.id = createdAccountant.data.user.id;
  assert.ifError((await client.from('profiles').insert({ user_id:accountant.id,display_name:'Receipt reviewer',is_active:true })).error);
  assert.ifError((await client.from('role_grants').insert({ user_id:accountant.id,role:'Accounting' })).error);
  await logout(browser); await login(browser,accountant); await browser.navigate(`/deliveries/${id}`);
  await click('Approve receipt evidence');
  await browser.wait("return [...document.querySelectorAll('p')].some(p=>p.textContent.includes('Accounting review')&&p.textContent.includes('approved'))");
  assert.equal(await browser.run(`return (await fetch('/api/delivery-files/${signedId}',{headers:{Range:'bytes=0-4'}})).status`),206);
  for (const width of [1440,375]) {
    await browser.call('Emulation.setDeviceMetricsOverride',{ width,height:1000,deviceScaleFactor:1,mobile:width<500 });
    if (width<500 && await browser.run("return !!document.querySelector('.mobile-scrim')")) await browser.run("document.querySelector('.mobile-scrim').click()");
    if (width<500) await browser.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth+1'),true,`Receiving fits ${width}px`);
    await browser.run("[...document.querySelectorAll('h2')].find(h=>h.textContent==='Site receipt').scrollIntoView()");
    const shot = await browser.call('Page.captureScreenshot',{ format:'png' });
    await writeFile(`.verification/receiving-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  console.log('Delivery scheduling, dispatch, receiving, stock recovery and protected evidence review passed.');
}
