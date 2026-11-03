import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

/** Real accounts and ordinary browser saves; disposable CI only. */
export async function checkRequestDrafts({ browser, second, client, login, logout, sql }) {
  const staff = [];
  for (let index = 0; index < 2; index++) {
    const email = `${randomUUID()}@example.invalid`, password = randomUUID();
    const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const id = created.data.user.id;
    assert.equal((await client.from('profiles').insert({ user_id: id, display_name: `MRF Site ${index}`, is_active: true })).error, null);
    assert.equal((await client.from('role_grants').insert({ user_id: id, role: 'Site Personnel' })).error, null);
    staff.push({ id, email, password });
  }
  const project = randomUUID(), code = 'MRF-' + randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  await sql(`insert into public.projects(id,name,location,document_code) values('${project}','MRF browser ${project}','CI','${code}');
    insert into public.project_budgets values('${project}',0);
    insert into public.project_assignments values('${staff[0].id}','${project}'),('${staff[1].id}','${project}');`);
  await login(browser, staff[0]);
  await browser.navigate('/requests/new');
  await browser.wait("return !!document.querySelector('select[name=projectId]')");
  await browser.run(`const el=document.querySelector('select[name=projectId]');el.value='${project}';el.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.click('.request-wizard-actions .primary');
  await browser.wait(`return document.querySelector('h1')?.textContent==='${code}-MRF-0001'`);
  const id = await browser.run("return location.pathname.split('/').at(-1)");
  await login(second, staff[1]);
  await second.navigate(`/requests/${id}/edit`);
  await second.fill('input[name=sourceRef]', 'My preserved input');
  await browser.navigate(`/requests/${id}/edit`);
  await browser.fill('input[name=sourceRef]', 'Other saved input');
  await browser.click('.request-wizard-actions .primary');
  await browser.wait(`return location.pathname==='/requests/${id}'`);
  await second.wait("return document.body.innerText.includes('Review saved changes')");
  assert.equal(await second.run("return document.querySelector('input[name=sourceRef]').value"), 'My preserved input');
  assert.match(await second.run('return document.body.innerText'), /Other saved input/);
  await second.run("[...document.querySelectorAll('button')].find(el=>el.textContent.includes('I reviewed the latest MRF')).click()");
  await second.click('.request-wizard-actions .primary');
  await second.wait(`return location.pathname==='/requests/${id}'`);
  assert.match(await second.run('return document.body.innerText'), /My preserved input/);
  await browser.navigate(`/requests/${id}`);
  assert.match(await browser.run('return document.body.innerText'), /My preserved input/);
  for (const width of [1440, 375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/request-detail-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  await sql(`delete from public.project_assignments where user_id='${staff[1].id}' and project_id='${project}';`);
  assert.equal(await second.run("return (await fetch('/api/foundation/view?view=requests')).status"), 401);
  await logout(browser);
  // The second session is now invalid. Its browser is reclaimed by the caller.
  console.log('Shared MRF creation, two-person editing, conflict preservation and immediate revocation denial passed.');
}
