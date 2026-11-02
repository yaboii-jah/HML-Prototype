import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

export async function checkFoundationShell({ browser, client, login, logout, administrator, sql }) {
  const ready = "return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')&&!!document.querySelector('.page-header')&&!document.querySelector('.foundation-status')";
  const key = async name => {
    await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name,
      windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[name], ...(name === 'Enter' ? { text: '\r' } : {}) });
    await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name });
  };
  await login(browser, administrator); await browser.wait(ready);
  for (const width of [1440, 375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth'), true, 'Shell fits viewport');
    if (width === 375) {
      await browser.run("document.querySelector('.mobile-menu').focus()"); await key('Enter');
      await browser.wait("return document.querySelector('.mobile-menu').getAttribute('aria-expanded')==='true'");
      await key('Escape');
      await browser.wait("return document.querySelector('.mobile-menu').getAttribute('aria-expanded')==='false'");
      await browser.click('.mobile-menu'); await browser.click('.mobile-scrim');
      await browser.wait("return !document.querySelector('.mobile-scrim')");
      await browser.wait("return getComputedStyle(document.querySelector('.side-nav')).visibility==='hidden'&&document.querySelector('.side-nav').getBoundingClientRect().right<=0");
    }
    await browser.run("document.querySelector('.masthead-account').focus()"); await key('Enter');
    await browser.wait("return !!document.querySelector('.account-modal[open]')");
    for (let index = 0; index < 5; index++) {
      await key('Tab');
      const focus = await browser.run("return {inside:document.querySelector('.account-modal').contains(document.activeElement),browserChrome:document.activeElement===document.body,open:document.querySelector('.account-modal').open}");
      assert.equal(focus.open, true);
      assert.ok(focus.inside || focus.browserChrome, 'Modal prevents Tab from reaching background application controls');
      if (focus.browserChrome) {
        // Native Chrome/Edge dialogs allow the browser toolbar in the tab cycle.
        // The next Tab must return to the dialog, never to background controls.
        await key('Tab');
        assert.equal(await browser.run("return document.querySelector('.account-modal').contains(document.activeElement)"), true);
      }
    }
    await key('Escape');
    await browser.wait("return !document.querySelector('.account-modal[open]')&&document.activeElement===document.querySelector('.masthead-account')");
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/foundation-shell-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  console.log('Authenticated shell keyboard and responsive controls passed.');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of ['dark', 'light']) {
    if (await browser.run('return document.documentElement.dataset.theme') !== theme) await browser.click('.theme-toggle');
    await browser.wait(`return document.documentElement.dataset.theme==='${theme}'`);
    assert.equal(await browser.run("return document.querySelector('.theme-toggle').getAttribute('aria-pressed')"), String(theme === 'dark'));
    await browser.navigate('/projects'); await browser.wait(ready);
    assert.equal(await browser.run('return document.documentElement.dataset.theme'), theme);
  }
  await browser.click('.sidebar-toggle');
  const sidebar = await browser.run('return document.documentElement.dataset.sidebar');
  await browser.navigate('/projects'); await browser.wait(ready);
  assert.equal(await browser.run('return document.documentElement.dataset.sidebar'), sidebar);
  await logout(browser);
  const account = { email: randomUUID() + '@example.invalid', password: randomUUID() };
  const created = await client.auth.admin.createUser({ ...account, email_confirm: true });
  assert.equal(created.error, null);
  const id = created.data.user.id;
  assert.equal((await client.from('profiles').insert({ user_id: id, display_name: 'Shell roles', is_active: true })).error, null);
  assert.equal((await client.from('role_grants').insert(['Accounting', 'Finance'].map(role => ({ user_id: id, role })))).error, null);
  await login(browser, account);
  await browser.wait("return location.pathname==='/choose-role'&&!!document.querySelector('#active-role')");
  await browser.run("const el=document.querySelector('#active-role');el.value='Accounting';el.dispatchEvent(new Event('change',{bubbles:true}))");
  await browser.click('.signin-form button'); await browser.wait(ready);
  assert.equal(await browser.run("return !!document.querySelector('a.side-link[href=\"/admin\"]')"), false);
  await browser.click('.masthead-account');
  await browser.wait("return !!document.querySelector('.account-modal[open]')");
  await browser.run("const el=document.querySelector('#switch-role');el.value='Finance';el.dispatchEvent(new Event('change',{bubbles:true}))");
  await browser.click('.account-modal .signin-form button');
  await browser.wait("return document.querySelector('.account-label small')?.textContent==='Finance'&&!document.querySelector('.foundation-status')");
  await browser.navigate('/projects'); await browser.wait(ready);
  assert.equal(await browser.run('return document.documentElement.dataset.sidebar'), sidebar, 'Role switching retains sidebar preference');
  assert.equal(await browser.run('return document.documentElement.dataset.theme'), 'light', 'Role switching retains theme');
  await logout(browser);
  await login(browser, administrator); await browser.wait(ready);
  console.log('Authenticated shell preferences and role switching passed.');
  await browser.click('a.side-link[href="/admin"]');
  await browser.wait("return location.pathname==='/admin'&&!!document.querySelector('input[aria-label=\"Search users\"]')");
  assert.equal(await browser.run("return document.querySelector('a.side-link[href=\"/admin\"]').getAttribute('aria-current')"), 'page');
  await browser.click('a.side-link[href="/projects"]'); await browser.wait(ready);
  assert.equal(await browser.run("return !!document.querySelector('[aria-busy=true]')"), false, 'Warm route completes loading');
  // Fail only the real project read in this disposable database. Restore the
  // privilege before retrying, even if the browser assertion fails.
  await sql('revoke execute on function public.projects_read(jsonb,uuid) from service_role;');
  try {
    await browser.navigate('/projects');
    await browser.wait("return document.querySelector('h1')?.textContent==='Workspace unavailable'");
    assert.equal(await browser.run("return !!document.querySelector('[aria-busy=true]')"), false, 'Error replaces loading');
  } finally {
    await sql('grant execute on function public.projects_read(jsonb,uuid) to service_role;');
  }
  await browser.click('.state-card .primary');
  await browser.wait(ready);
  console.log('Server read failure recovers through the page retry control.');
  await browser.navigate('/projects/' + randomUUID());
  await browser.wait("return !document.querySelector('[aria-busy=true]')&&document.querySelector('h1')?.textContent==='404'&&document.body.innerText.includes('This page could not be found.')");
  console.log('Missing project completes with the supported 404 state.');
  await logout(browser);
  // Storage errors are injected into this isolated profile before any app code.
  const blocked = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    Storage.prototype.getItem=function(){throw new DOMException('Test storage denied','SecurityError')};
    Storage.prototype.setItem=function(){throw new DOMException('Test storage denied','SecurityError')};
  ` });
  try {
    await login(browser, administrator); await browser.wait(ready);
    const previous = await browser.run('return document.documentElement.dataset.theme');
    await browser.click('.theme-toggle');
    await browser.wait(`return document.documentElement.dataset.theme!==${JSON.stringify(previous)}`);
    const previousSidebar = await browser.run('return document.documentElement.dataset.sidebar');
    await browser.click('.sidebar-toggle');
    await browser.wait(`return document.documentElement.dataset.sidebar!==${JSON.stringify(previousSidebar)}`);
    await logout(browser);
  } finally {
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
  }
  console.log('Blocked browser storage preserves working shell controls.');
  // Delay only the disposable RPC, retaining its real authorization and records.
  // Observe the streaming fallback before the document finishes loading.
  await sql(`create or replace function public.projects_read(actor jsonb,target_project uuid default null) returns jsonb
    language plpgsql security invoker set search_path='' as $$ begin perform pg_sleep(3); return private.projects_read(actor,target_project); end $$;`);
  try {
    for (const motion of ['no-preference', 'reduce']) {
      await login(browser, administrator); await browser.wait(ready);
      await browser.navigate('/admin');
      await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
      await browser.call('Page.navigate', { url: 'http://127.0.0.1:3198/projects?loading=' + randomUUID() });
      await browser.wait("return !!document.querySelector('.page-skeleton[aria-busy=true]')");
      await browser.wait("return getComputedStyle(document.querySelector('.page-skeleton .loading-visual')).visibility==='visible'");
      assert.equal(await browser.run("return !!document.querySelector('.loading-status[role=status]')&&!document.querySelector('.loading-status').closest('[aria-busy=true]')"), true);
      assert.equal(await browser.run("return document.querySelector('.page-skeleton .loading-visual').getAttribute('aria-hidden')"), 'true');
      if (motion === 'reduce') assert.equal(await browser.run("return getComputedStyle(document.querySelector('.skeleton'),'::after').animationName"), 'none');
      await browser.wait("return document.readyState==='complete'&&!!document.querySelector('.page-header')&&!document.querySelector('.page-skeleton[aria-busy=true]')");
      await logout(browser);
    }
  } finally {
    await sql(`create or replace function public.projects_read(actor jsonb,target_project uuid default null) returns jsonb
      language sql security invoker set search_path='' as $$ select private.projects_read(actor,target_project); $$;`);
  }
  await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await login(browser, administrator); await browser.wait(ready);
  await logout(browser);
  console.log('Authenticated responsive shell, keyboard/dialog, preferences, storage failure and recoverable page errors passed.');
}
