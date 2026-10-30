import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { bootstrapAdministrator } from './helpers/bootstrap-administrator.mjs';
import { authBrowser } from './helpers/auth-browser.mjs';
import { requireLoopback } from './helpers/supabase-target.mjs';

export async function checkAuthFoundation({ api, anon, secret, mailpit, sql, environment }) {
  requireLoopback(api);
  requireLoopback(mailpit);
  const base = 'http://127.0.0.1:3198';
  const client = createClient(api, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const passwordClient = () => createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  const request = (path, token = anon, options = {}) => fetch(api + path, {
    ...options, headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000),
  });
  const create = async (roles, active = true) => {
    const email = `${randomUUID()}@example.invalid`;
    const password = randomUUID();
    const data = ok(await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'Administrator' } }), 'Create run-owned Auth user');
    const id = data.user.id;
    ok(await client.from('profiles').insert({ user_id: id, display_name: 'Foundation staff', is_active: active }), 'Create profile');
    ok(await client.from('role_grants').insert(roles.map(role => ({ user_id: id, role }))), 'Create current grants');
    return { id, email, password };
  };

  // Recover an identity created before a failed checkpoint save, then race two
  // distinct bootstrap attempts. Exactly one wins; the loser cleans its own user.
  const bootstrapInputs = Array.from({ length: 2 }, () => ({ name: 'Initial Administrator', email: `${randomUUID()}@example.invalid`, password: randomUUID() }));
  const checkpoints = [null, null];
  const options = index => ({ client, ...bootstrapInputs[index], load: async () => structuredClone(checkpoints[index]), save: async value => { checkpoints[index] = structuredClone(value); } });
  let interrupted = false;
  await assert.rejects(bootstrapAdministrator({ ...options(0), save: async value => {
    if (value.userId && !interrupted) { interrupted = true; throw Error('Simulated interrupted private checkpoint save'); }
    checkpoints[0] = structuredClone(value);
  } }));
  let arrivals = 0;
  let release;
  const barrier = new Promise(done => { release = done; });
  const racingClient = new Proxy(client, { get(target, key) {
    if (key === 'rpc') return async (...args) => { if (++arrivals === 2) release(); await barrier; return target.rpc(...args); };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const attempts = await Promise.allSettled([0, 1].map(index => bootstrapAdministrator({ ...options(index), client: racingClient })));
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1, 'Concurrent bootstrap retains one Administrator');
  const winner = attempts.findIndex(item => item.status === 'fulfilled');
  await bootstrapAdministrator(options(winner));
  assert.equal((await sql("select count(*) from private.audit_events where action='administrator.bootstrapped';")).output.trim(), '1', 'Retry does not duplicate the bootstrap audit');
  assert.equal((await sql('select count(*) from public.profiles;')).output.trim(), '1', 'Losing bootstrap grants no profile');
  const loser = 1 - winner;
  assert.ok((await client.auth.admin.getUserById(checkpoints[loser].userId)).error, 'Losing run-owned Auth identity cleaned');
  const late = { ...options(winner), load: async () => null };
  await assert.rejects(bootstrapAdministrator(late), /already initialized/);

  const manager = await create(['Project Manager']);
  const multi = await create(['Accounting', 'Finance']);
  const site = await create(['Site Personnel']);
  const inactive = await create(['Administrator'], false);
  const fixtureProject = randomUUID();
  ok(await client.from('projects').insert({ id: fixtureProject, name: 'Session browser fixture' }), 'Create run-owned project');
  const user = passwordClient();
  const rawLogin = ok(await user.auth.signInWithPassword({ email: manager.email, password: manager.password }), 'Authenticate outside app');
  const token = rawLogin.session.access_token;
  assert.equal(await (await request('/rest/v1/rpc/auth_session_context', token, { method: 'POST', body: '{}' })).json(), null, 'An Auth login alone has no application binding');
  assert.ok((await request('/rest/v1/rpc/auth_bind_session', token, { method: 'POST', body: JSON.stringify({ target_user: manager.id, target_session: randomUUID(), expected_revision: '1' }) })).status >= 400, 'Browser cannot bind itself');
  const directPassword = await user.auth.updateUser({ password: randomUUID() });
  assert.equal(directPassword.error?.code, 'current_password_required', 'Ordinary JWT cannot reset a password without current-password proof');

  const appEnvironment = {
    ...environment, NEXT_PUBLIC_SUPABASE_URL: api, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SECRET_KEY: secret, SUPABASE_ACCESS_TOKEN: '', SUPABASE_DB_PASSWORD: '', APP_ORIGIN: base,
    GOOGLE_DRIVE_ENABLED: 'false', GEMINI_API_KEY: '',
  };
  requireLoopback(appEnvironment.NEXT_PUBLIC_SUPABASE_URL);
  const build = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], { env: appEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  let buildLog = '';
  build.stdout.on('data', chunk => { buildLog += chunk; }); build.stderr.on('data', chunk => { buildLog += chunk; });
  const buildCode = await new Promise((done, reject) => { build.on('error', reject); build.on('close', done); });
  await writeFile('.verification/auth-build.log', buildLog);
  if (buildCode !== 0) throw Error('Auth browser build failed: ' + buildLog.slice(-2500));
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3198'], {
    env: { ...appEnvironment, NODE_OPTIONS: '--import=./scripts/helpers/no-external-network.mjs' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-16000); });
  server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-16000); });
  const stopped = new Promise(done => server.once('close', done));
  const browsers = [];
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (server.exitCode !== null) throw Error('Isolated app exited');
      try { ready = (await fetch(base + '/sign-in')).ok; } catch {}
      if (!ready) await delay(100);
    }
    assert.ok(ready, 'Isolated production app ready');
    const browser = await authBrowser(base); browsers.push(browser);
    const second = await authBrowser(base); browsers.push(second);
    const login = async (browser, account) => {
      await browser.navigate('/sign-in');
      await browser.wait("return !!document.querySelector('#signin-email')&&!document.querySelector('.signin-submit').disabled");
      await browser.fill('#signin-email', account.email); await browser.fill('#signin-password', account.password);
      await browser.click('.signin-submit');
    };
    const logout = async browser => {
      await browser.click('.masthead-account');
      await browser.wait("return !!document.querySelector('.account-modal[open]')");
      await browser.click('.account-modal .account-modal-actions button');
      await browser.wait("return location.pathname==='/sign-in'&&!!document.querySelector('#signin-email')");
    };
    const sessionCookie = async browser => {
      const { cookies } = await browser.call('Network.getAllCookies');
      const parts = cookies.filter(c => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      assert.ok(parts.length && parts.every(part => part.httpOnly), 'Auth cookies are HttpOnly');
      const encoded = parts.map(part => part.value).join('');
      assert.ok(encoded.startsWith('base64-'));
      return JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString());
    };
    await login(browser, { ...manager, password: randomUUID() });
    await browser.wait("return !!document.querySelector('#signin-error')");
    assert.match(await browser.run("return document.querySelector('#signin-error').textContent"), /Invalid email or password/);
    await login(browser, manager);
    await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    const managerSession = await sessionCookie(browser);
    const context = await (await request('/rest/v1/rpc/auth_session_context', managerSession.access_token, { method: 'POST', body: '{}' })).json();
    assert.equal(context.userId, manager.id);
    assert.deepEqual(context.roles, ['Project Manager'], 'Editable Administrator metadata grants no role');
    assert.equal(await browser.run("return /auth-token/.test(document.cookie)"), false, 'Browser JS cannot read Auth cookies');
    assert.equal(await browser.run("return Object.keys(localStorage).some(k=>/hml-constructsync-(demo|users|session)/.test(k))"), false, 'Authenticated runtime does not initialize demo state');
    assert.equal(await browser.run("return (await fetch('/api/drive/projects',{method:'POST',body:'forged'})).status"), 503);
    assert.match(await browser.run("return (await fetch('/projects')).headers.get('cache-control')"), /no-store/, 'Protected responses cannot be shared from cache');
    await second.navigate('/projects');
    assert.equal(await second.run('return location.pathname'), '/sign-in', 'Another browser does not inherit the session');
    for (const route of ['/requests/new', '/admin/maintenance', '/demo-files/forged']) {
      await browser.navigate(route);
      assert.match(await browser.run('return document.body.innerText'), /temporarily unavailable/);
    }
    await logout(browser);
    assert.equal(await (await request('/rest/v1/rpc/auth_session_context', managerSession.access_token, { method: 'POST', body: '{}' })).json(), null, 'Copied signed JWT loses application access on logout');
    await login(browser, multi);
    await browser.wait("return location.pathname==='/choose-role'&&!!document.querySelector('#active-role')");
    const select = async (selector, value) => browser.run(`const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));`);
    await select('#active-role', 'Accounting'); await browser.click('.signin-form button');
    await browser.wait("return location.pathname==='/projects'&&document.querySelector('.account-label small')?.textContent==='Accounting'");
    const beforeSwitch = await sessionCookie(browser);
    await browser.click('.masthead-account'); await browser.wait("return !!document.querySelector('.account-modal[open]')");
    await select('#switch-role', 'Finance'); await browser.click('.account-modal .signin-form button');
    await browser.wait("return document.querySelector('.account-label small')?.textContent==='Finance'");
    const afterSwitch = await sessionCookie(browser);
    assert.equal(afterSwitch.user.id, beforeSwitch.user.id, 'Role switching preserves permanent identity');
    assert.ok(afterSwitch.access_token === beforeSwitch.access_token, 'Role switching does not authenticate as another account');
    await logout(browser);
    await login(browser, multi);
    await browser.wait("return location.pathname==='/projects'&&document.querySelector('.account-label small')?.textContent==='Finance'");
    await browser.call('Network.setCookie', { name: `constructsync-role-${multi.id}`, value: 'Administrator', url: base, httpOnly: true });
    await browser.navigate('/projects');
    assert.equal(await browser.run('return location.pathname'), '/choose-role', 'Forged remembered role grants no authority');
    assert.equal(await browser.run("return [...document.querySelector('#active-role').options].some(o=>o.value==='Administrator')"), false);
    await select('#active-role', 'Accounting'); await browser.click('.signin-form button');
    await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    const stale = await sessionCookie(browser);
    ok(await client.from('role_grants').delete().eq('user_id', multi.id).eq('role', 'Finance'), 'Revoke a role');
    assert.equal(await browser.run("return (await fetch('/api/drive/projects',{method:'POST'})).status"), 401, 'Missed notifications do not preserve revoked access');
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', anon, { method: 'POST', body: JSON.stringify({ refresh_token: stale.refresh_token }) });
    assert.equal(refreshed.status, 200);
    const refreshedSession = await refreshed.json();
    assert.equal(await (await request('/rest/v1/rpc/auth_session_context', refreshedSession.access_token, { method: 'POST', body: '{}' })).json(), null, 'Real JWT refresh never renews revoked binding');
    await browser.navigate('/projects');
    assert.equal(await browser.run('return location.pathname'), '/sign-in');
    await login(browser, multi); await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    ok(await client.from('profiles').update({ is_active: false }).eq('user_id', multi.id), 'Deactivate account');
    assert.equal(await browser.run("return (await fetch('/api/documents/preview',{method:'POST'})).status"), 401, 'Deactivation immediately denies operations');
    await login(second, site); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    ok(await client.from('project_assignments').insert({ user_id: site.id, project_id: fixtureProject }), 'Change site assignment');
    await second.navigate('/projects');
    assert.equal(await second.run('return location.pathname'), '/sign-in', 'Assignment changes require fresh sign-in');
    await login(second, inactive); await second.wait("return !!document.querySelector('#signin-error')");
    assert.match(await second.run("return document.querySelector('#signin-error').textContent"), /workspace access/);

    const inspectedMessages = new Set();
    const mailLink = async (email, type) => {
      for (let i = 0; i < 100; i++) {
        const listing = await fetch(mailpit + '/api/v1/messages').then(r => r.json());
        const messages = (listing.messages ?? []).filter(m => !inspectedMessages.has(m.ID) && m.To?.some(to => to.Address === email));
        for (const message of messages) {
          const detail = await fetch(mailpit + '/api/v1/message/' + message.ID).then(r => r.json());
          const href = detail.HTML?.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
          assert.ok(href, 'Mailpit captured a confirmation link');
          const url = new URL(href);
          if (url.searchParams.get('type') !== type) continue;
          assert.equal(url.origin, base); assert.equal(url.pathname, '/auth/confirm');
          inspectedMessages.add(message.ID);
          return url.pathname + url.search;
        }
        await delay(100);
      }
      throw Error('Mailpit did not capture the expected message');
    };
    const inviteEmail = `${randomUUID()}@example.invalid`;
    const invited = ok(await client.auth.admin.inviteUserByEmail(inviteEmail), 'Send invitation to captured SMTP');
    const invite = { id: invited.user.id, email: inviteEmail, password: randomUUID() };
    ok(await client.from('profiles').insert({ user_id: invite.id, display_name: 'Invited staff', is_active: true }), 'Prepare invited profile');
    ok(await client.from('role_grants').insert({ user_id: invite.id, role: 'Project Manager' }), 'Prepare invitation grants');
    const invitation = await mailLink(inviteEmail, 'invite');
    await second.navigate(invitation);
    assert.equal(await second.run("return !!document.querySelector('#new-password')"), true, 'GET does not consume invitation');
    const savePassword = async (browser, password) => { await browser.fill('#new-password', password); await browser.fill('#confirm-password', password); await browser.click('.signin-form button'); };
    await second.fill('#new-password', invite.password); await second.fill('#confirm-password', randomUUID());
    await second.click('.signin-form button');
    await second.wait("return !!document.querySelector('[role=alert]')");
    assert.match(await second.run("return document.querySelector('[role=alert]').textContent"), /matching passwords/);
    await savePassword(second, invite.password);
    await second.wait("return location.pathname==='/sign-in'&&!!document.querySelector('#signin-email')");
    await login(second, invite); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    await logout(second);
    await second.navigate(invitation); await savePassword(second, randomUUID());
    await second.wait("return !!document.querySelector('[role=alert]')");
    assert.match(await second.run("return document.querySelector('[role=alert]').textContent"), /invalid or expired/);
    ok(await passwordClient().auth.resetPasswordForEmail(invite.email), 'Send recovery to captured SMTP');
    const recovery = await mailLink(invite.email, 'recovery');
    await second.navigate(recovery);
    invite.password = randomUUID(); await savePassword(second, invite.password);
    await second.wait("return location.pathname==='/sign-in'&&!!document.querySelector('#signin-email')");
    await login(second, invite); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    await logout(second);
    ok(await passwordClient().auth.resetPasswordForEmail(invite.email), 'Create expiring recovery link');
    const expiring = await mailLink(invite.email, 'recovery');
    await sql(`update auth.users set recovery_sent_at=now()-interval '2 hours' where id='${invite.id}';`);
    await second.navigate(expiring); await savePassword(second, randomUUID());
    await second.wait("return !!document.querySelector('[role=alert]')");
    assert.match(await second.run("return document.querySelector('[role=alert]').textContent"), /invalid or expired/);
    for (const browser of browsers) browser.assertIsolated();
    await writeFile('.verification/auth-foundation.json', JSON.stringify({ passed: true, bootstrap: true, sessions: true, roles: true, revocation: true, capturedEmail: true, isolated: true }, null, 2));
    console.log('Real-account browser, session revocation, role, bootstrap and captured-email checks passed.');
  } finally {
    const cleanup = await Promise.allSettled(browsers.map(browser => browser.close()));
    server.kill(); await Promise.race([stopped, delay(5000)]);
    await writeFile('.verification/auth-server.log', serverLog);
    if (cleanup.some(result => result.status === 'rejected')) throw Error('Run-owned browser profile cleanup failed');
  }
}
