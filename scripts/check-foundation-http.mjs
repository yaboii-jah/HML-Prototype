import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkFoundationHttp({ browser, second, client, login, logout, sessionCookie, administrator, base, passwordClient }) {
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  const paths = ['/api/foundation/view?view=projects', '/api/realtime/session'];
  const cookie = async target => (await target.call('Network.getAllCookies')).cookies
    .filter(item => item.domain === '127.0.0.1').map(item => `${item.name}=${item.value}`).join('; ');
  const read = async (path, cookies = '', headers = {}) => {
    const response = await fetch(base + path, { headers: { Cookie: cookies, ...headers }, signal: AbortSignal.timeout(20000) });
    assert.match(response.headers.get('cache-control'), /private.*no-store/, 'Every view/credential result is uncached');
    assert.match(response.headers.get('vary'), /Cookie/i);
    return { status: response.status, body: await response.json() };
  };
  for (const path of paths) assert.equal((await read(path)).status, 401, 'Anonymous HTTP access denied');
  await login(browser, administrator);
  await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  const adminCookies = await cookie(browser);
  assert.equal(await browser.run("try{new WebSocket('wss://example.invalid/realtime/v1/websocket');return false}catch(error){return error.message.includes('Unexpected Realtime') }"), true, 'Actual browser constructor rejects an unexpected socket before connecting');
  for (const path of paths) {
    assert.equal((await read(path, adminCookies, { Origin: 'https://example.invalid' })).status, 403, 'Cross-origin HTTP access denied');
    assert.equal((await read(path, adminCookies, { 'Sec-Fetch-Site': 'same-site' })).status, 403, 'Cross-site sibling access denied');
  }
  for (const path of ['/api/foundation/view', '/api/foundation/view?view=unknown', '/api/foundation/view?view=project&projectId=invalid']) {
    assert.equal((await read(path, adminCookies)).status, 400, 'Malformed view request rejected');
  }
  const ids = [randomUUID(), randomUUID()];
  ok(await client.from('projects').insert(ids.map((id, index) => ({ id, name: 'HTTP acceptance ' + id, location: 'Synthetic site', document_code: `HTTP-${index}-${id.slice(0, 8).toUpperCase()}` }))), 'HTTP owned projects');
  ok(await client.from('project_budgets').insert(ids.map(project_id => ({ project_id, amount: '987654.32' }))), 'HTTP owned finances');
  const siteId = randomUUID();
  ok(await client.from('scopes').insert({ id: siteId, project_id: ids[0], name: 'Structural Works' }), 'HTTP owned scope');
  ok(await client.from('scope_budgets').insert({ scope_id: siteId, amount: '123.45' }), 'HTTP scope finances');
  const roles = ['Administrator', 'Project Manager', 'Site Personnel', 'Procurement', 'Accounting', 'Finance', 'Logistics'];
  const financialKeys = value => {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => [
      ...(/budget|allocated|unallocated|amount|spent|committed/i.test(key) ? [key] : []), ...financialKeys(child),
    ]);
  };
  for (const role of roles) {
    const account = { email: randomUUID() + '@example.invalid', password: randomUUID() };
    const id = ok(await client.auth.admin.createUser({ ...account, email_confirm: true,
      user_metadata: { role: 'Administrator' } }), 'HTTP role fixture').user.id;
    ok(await client.from('profiles').insert({ user_id: id, display_name: 'HTTP ' + role, is_active: true }), 'HTTP profile');
    ok(await client.from('role_grants').insert({ user_id: id, role }), 'HTTP role');
    if (role === 'Site Personnel') ok(await client.from('project_assignments').insert({ user_id: id, project_id: ids[0] }), 'HTTP assignment');
    await login(second, account);
    await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    const cookies = await cookie(second);
    const directory = await read(paths[0], cookies), detail = await read('/api/foundation/view?view=project&projectId=' + ids[0], cookies);
    assert.equal(directory.status, 200, role + ' directory'); assert.equal(detail.status, 200, role + ' detail');
    assert.equal((await read('/api/foundation/view?view=accounts', cookies)).status, role === 'Administrator' ? 200 : 403);
    assert.equal((await read('/api/foundation/view?view=session', cookies)).body.session.userId, id);
    const credential = await read(paths[1], cookies);
    assert.equal(credential.status, 200);
    assert.deepEqual(Object.keys(credential.body).sort(), ['accessToken', 'expiresAt', 'session', 'sessionId', 'topic']);
    assert.equal(credential.body.topic, `foundation:${id}:${credential.body.session.revision}:${credential.body.sessionId}`);
    if (role === 'Site Personnel') {
      assert.deepEqual(financialKeys(directory.body), [], 'Site directory omits financial fields');
      assert.deepEqual(financialKeys(detail.body), [], 'Site detail omits financial fields');
      assert.ok(directory.body.view.data.projects.some(project => project.id === ids[0]));
      assert.equal(directory.body.view.data.projects.some(project => project.id === ids[1]), false);
      assert.equal((await read('/api/foundation/view?view=project&projectId=' + ids[1], cookies)).body.view.data.project, null);
    } else {
      assert.ok(financialKeys(detail.body).includes('budget'), role + ' gets authorized finances');
    }
    ok(await client.from('profiles').update({ is_active: false }).eq('user_id', id), 'HTTP fixture revocation');
    // Retained cookie deliberately bypasses browser navigation/automatic sign-out.
    for (const path of paths) assert.equal((await read(path, cookies)).status, 401, 'Revoked bound session rejected by HTTP');
  }
  const authOnly = { email: randomUUID() + '@example.invalid', password: randomUUID() };
  ok(await client.auth.admin.createUser({ ...authOnly, email_confirm: true }), 'HTTP unbound Auth-only identity');
  const rawClient = passwordClient();
  const raw = ok(await rawClient.auth.signInWithPassword(authOnly), 'Raw Auth sign-in').session;
  const cookieName = (await browser.call('Network.getAllCookies')).cookies.find(item => /^sb-.*-auth-token(?:\.\d+)?$/.test(item.name)).name.replace(/\.\d+$/, '');
  const rawCookie = cookieName + '=base64-' + Buffer.from(JSON.stringify(raw)).toString('base64url');
  for (const path of paths) assert.equal((await read(path, rawCookie)).status, 401, 'Valid unbound Auth session grants no HTTP workspace access');
  ok(await rawClient.auth.signOut({ scope: 'local' }), 'End owned unbound session');
  // Force only the stored expiry metadata near expiry. The signed JWT remains
  // genuine; renewal must contact real disposable Auth and rotate HttpOnly cookies.
  const before = await sessionCookie(browser);
  await delay(1100); // Auth JWT issue times have one-second resolution.
  const expired = { ...before, expires_at: Math.floor(Date.now() / 1000) + 30, expires_in: 30 };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(expired)).toString('base64url');
  const pieces = (await browser.call('Network.getAllCookies')).cookies.filter(item => /^sb-.*-auth-token(?:\.\d+)?$/.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let offset = 0;
  for (const [index, piece] of pieces.entries()) {
    const value = index === pieces.length - 1 ? encoded.slice(offset) : encoded.slice(offset, offset + piece.value.length);
    offset += value.length;
    await browser.call('Network.setCookie', { name: piece.name, value, url: base, path: '/', httpOnly: true, sameSite: 'Lax' });
  }
  assert.equal(await browser.run("const r=await fetch('/api/realtime/session');return r.status"), 200);
  const after = await sessionCookie(browser);
  assert.notEqual(after.access_token, before.access_token, 'Real Auth renewal returns a new signed JWT');
  assert.notEqual(after.refresh_token, before.refresh_token, 'Real refresh cookie rotates');
  assert.equal(after.user.id, before.user.id);
  const beforeClaims = ok(await client.auth.getClaims(before.access_token), 'Pre-renewal claims').claims;
  const afterClaims = ok(await client.auth.getClaims(after.access_token), 'Renewed claims').claims;
  assert.equal(afterClaims.session_id, beforeClaims.session_id, 'Renewal keeps the exact bound Auth session');
  assert.equal((await read(paths[0], await cookie(browser))).status, 200, 'Renewed binding still reads current data');
  await logout(browser);
  console.log('Real HTTP role matrix, Site finance omission, cache/origin/revocation checks and Auth renewal passed.');
}
