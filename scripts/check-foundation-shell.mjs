import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

export async function checkFoundationShell({ browser, login, logout, administrator, sql }) {
  const ready = "return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')";
  const key = async name => {
    await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[name] });
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
    }
    await browser.run("document.querySelector('.masthead-account').focus()"); await key('Enter');
    await browser.wait("return !!document.querySelector('.account-modal[open]')");
    for (let index = 0; index < 5; index++) {
      await key('Tab');
      assert.equal(await browser.run("return document.querySelector('.account-modal').contains(document.activeElement)"), true, 'Native account dialog traps keyboard focus');
    }
    await key('Escape');
    await browser.wait("return !document.querySelector('.account-modal[open]')&&document.activeElement===document.querySelector('.masthead-account')");
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/foundation-shell-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
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
  await browser.navigate('/projects/' + randomUUID());
  await browser.wait("return !document.querySelector('[aria-busy=true]')&&/not found|not available|unavailable|removed/i.test(document.body.innerText)");
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
    await browser.click('.sidebar-toggle');
    await browser.wait("return ['expanded','collapsed'].includes(document.documentElement.dataset.sidebar)");
    await logout(browser);
  } finally {
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
  }
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
