import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

export async function checkSupplierDirectory({ browser, second, client, login, logout, sessionCookie, sql }) {
  const staff = [];
  for (const role of ['Procurement', 'Procurement', 'Accounting', 'Site Personnel']) {
    const email = `${randomUUID()}@example.invalid`, password = randomUUID();
    const result = await client.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(result.error, null);
    const id = result.data.user.id;
    assert.equal((await client.from('profiles').insert({ user_id: id, display_name: `Supplier ${role}`, is_active: true })).error, null);
    assert.equal((await client.from('role_grants').insert({ user_id: id, role })).error, null);
    staff.push({ id, email, password });
  }
  for (const page of [browser, second]) {
    if (await page.run("return !!document.querySelector('.masthead-account')")) await logout(page);
  }
  await login(browser, staff[0]);
  await browser.navigate('/suppliers');
  await browser.wait("return document.querySelector('h1')?.textContent==='Suppliers'&&!!document.querySelector('.page-header .primary')");
  await browser.click('.page-header .primary');
  await browser.wait("return !!document.querySelector('.record-dialog[open] input[name=name]')");
  const name = `Supplier browser ${randomUUID()}`;
  await browser.fill('input[name=name]', name);
  await browser.click('.record-dialog .form-actions .primary');
  await browser.wait(`return location.pathname.startsWith('/suppliers/')&&document.querySelector('h1')?.textContent===${JSON.stringify(name)}`);
  const id = await browser.run("return location.pathname.split('/').at(-1)");
  await login(second, staff[1]);
  await second.navigate(`/suppliers/${id}`);
  await second.wait(`return document.querySelector('h1')?.textContent===${JSON.stringify(name)}`);
  const session = await sessionCookie(second);
  const claims = await client.auth.getClaims(session.access_token);
  assert.equal(claims.error, null);
  const context = await fetch(client.supabaseUrl + '/rest/v1/rpc/auth_session_context', { method: 'POST',
    headers: { apikey: client.supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
  const actor = { userId: staff[1].id, sessionId: claims.data.claims.session_id, revision: context.revision, activeRole: 'Procurement' };
  const command = async input => {
    const result = await client.rpc('supplier_command', { actor, command: { requestId: randomUUID(), ...input } });
    assert.equal(result.error, null);
    return result.data;
  };
  const current = async () => {
    const result = await client.rpc('suppliers_read', { actor, target_supplier: id });
    assert.equal(result.error, null);
    return result.data.supplier;
  };
  await browser.click('.page-header .secondary');
  await browser.wait("return !!document.querySelector('.record-dialog[open] input[name=phone]')");
  await browser.fill('input[name=phone]', 'Preserved phone');
  for (const address of ['Newer address', 'Another intervening address']) {
    const supplier = await current();
    await command({ type: 'saveSupplier', supplierId: id, expectedVersion: supplier.version, profile: { ...supplier, address } });
    await browser.wait(`return document.querySelector('.record-dialog [role=status]')?.textContent.includes(${JSON.stringify(address)})`);
    assert.equal(await browser.run("return document.querySelector('input[name=phone]').value"), 'Preserved phone');
    assert.equal(await browser.run("return document.querySelector('.record-dialog .form-actions .primary').disabled"), true);
    await browser.run("[...document.querySelectorAll('.record-dialog button')].find(b=>b.textContent.includes('I reviewed')).click()");
  }
  await browser.click('.record-dialog .form-actions .primary');
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.body.innerText.includes('Preserved phone')");
  assert.equal((await current()).phone, 'Preserved phone');
  await browser.run("[...document.querySelectorAll('.page-header button')].find(b=>b.textContent==='Deactivate supplier').click()");
  await browser.wait("return !!document.querySelector('textarea[name=reason]')");
  await browser.fill('textarea[name=reason]', 'No longer selected');
  await browser.click('.record-dialog .form-actions .primary');
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&!![...document.querySelectorAll('.page-header button')].find(b=>b.textContent==='Reactivate supplier')");
  await second.wait("return document.body.innerText.includes('No longer selected')&&!![...document.querySelectorAll('.page-header button')].find(b=>b.textContent==='Reactivate supplier')");
  await browser.navigate('/suppliers');
  await browser.wait("return !!document.querySelector('input[type=search]')");
  await browser.fill('input[type=search]', name);
  assert.equal(await browser.run(`return [...document.querySelectorAll('tbody a')].some(a=>a.textContent===${JSON.stringify(name)})`), false);
  await browser.run("const s=document.querySelector('.register-toolbar select');s.value='Inactive';s.dispatchEvent(new Event('change',{bubbles:true}));");
  await browser.wait(`return [...document.querySelectorAll('tbody a')].some(a=>a.textContent===${JSON.stringify(name)})`);
  // Duplicate names remain reserved while inactive, through the actual form action.
  await browser.click('.page-header .primary');
  await browser.wait("return !!document.querySelector('input[name=name]')");
  await browser.fill('input[name=name]', name.toUpperCase().replaceAll(' ', '   '));
  await browser.click('.record-dialog .form-actions .primary');
  await browser.wait(`return !!document.querySelector('.record-dialog a[href="/suppliers/${id}"]')`);
  await browser.fill('input[name=name]', '');
  await browser.click('.record-modal-close');
  await browser.wait("return !document.querySelector('.record-dialog[open]')");
  await browser.navigate(`/suppliers/${id}`);
  await browser.run("[...document.querySelectorAll('.page-header button')].find(b=>b.textContent==='Reactivate supplier').click()");
  await browser.wait("return !!document.querySelector('textarea[name=reason]')");
  await browser.fill('textarea[name=reason]', 'Details confirmed again');
  await browser.click('.record-dialog .form-actions .primary');
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.body.innerText.includes('Details confirmed again')");
  for (const width of [1440, 375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 375 });
    await browser.run("document.querySelector('.mobile-scrim')?.click()");
    if (width === 375) await browser.wait("return document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth'), true);
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/supplier-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  // Reader screens have no maintenance controls; Site has neither navigation nor API data.
  await logout(browser);
  await login(browser, staff[2]);
  await browser.navigate(`/suppliers/${id}`);
  await browser.wait("return document.querySelector('h1')?.textContent.startsWith('Supplier browser')");
  assert.equal(await browser.run("return !!document.querySelector('.page-header button')"), false);
  assert.match(await browser.run('return document.body.innerText'), /Details confirmed again/);
  await logout(browser);
  await login(browser, staff[3]);
  assert.equal(await browser.run("return !!document.querySelector('nav a[href=\"/suppliers\"]')"), false);
  assert.equal(await browser.run("return (await fetch('/api/foundation/view?view=suppliers')).status"), 403);
  await browser.navigate(`/suppliers/${id}`);
  await browser.wait("return location.pathname==='/projects'");
  await logout(browser);
  // Revocation clears an open dirty supplier editor and denies the old actor.
  await second.click('.page-header .secondary');
  await second.wait("return !!document.querySelector('input[name=phone]')");
  await second.fill('input[name=phone]', 'Revoked dirty input');
  await sql(`update public.profiles set is_active=false where user_id='${staff[1].id}';`);
  await second.run("window.dispatchEvent(new Event('focus'))");
  await second.wait("return location.pathname==='/sign-in'");
  assert.equal(await second.run("return !!document.querySelector('input[name=phone]')"), false);
  assert.notEqual((await client.rpc('suppliers_read', { actor })).error, null);
  console.log('Shared supplier forms, repeated conflicts, inactive duplicates, history, reader/Site denial and dirty-editor revocation passed.');
}
