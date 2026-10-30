import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Successful audited account workflows run only in the disposable CI stack. */
export async function checkAccountAdministration({ browser, second, client, login, logout, sessionCookie, mailLink, savePassword, administrator, passwordClient, sql }) {
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  await login(browser, administrator);
  await browser.wait("return location.pathname==='/projects'&&document.querySelector('.account-label small')?.textContent==='Administrator'");
  await browser.navigate('/admin');
  await browser.wait("return !!document.querySelector('input[aria-label=\"Search users\"]')");
  assert.equal(await browser.run("return !!document.querySelector('input[name=password]')"), false, 'Administrator never chooses another user password');
  const rootSession = await sessionCookie(browser);
  const verified = ok(await client.auth.getClaims(rootSession.access_token), 'Verify Administrator test claims');
  const contextResponse = await fetch(client.supabaseUrl + '/rest/v1/rpc/auth_session_context', { method: 'POST',
    headers: { apikey: client.supabaseKey, Authorization: `Bearer ${rootSession.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const context = await contextResponse.json();
  const actor = { userId: context.userId, sessionId: verified.claims.session_id, revision: context.revision, activeRole: 'Administrator' };
  const email = `${randomUUID()}@example.invalid`, name = 'Managed account fixture';
  const confirm = async () => { await browser.wait("return !!document.querySelector('.confirm-dialog[open]')"); await browser.click('.confirm-dialog[open] .primary'); };
  await browser.click('.page-header .primary');
  await browser.wait("return !!document.querySelector('.record-dialog[open] input[name=name]')");
  await browser.fill('.record-dialog input[name=name]', name); await browser.fill('.record-dialog input[name=email]', email);
  await browser.click('input[name=roles][value=Accounting]');
  await browser.click('input[name=roles][value=Finance]');
  await browser.click('.record-dialog .form-actions .primary'); await confirm();
  await browser.wait(`return [...document.querySelectorAll('[data-account-id]')].some(row=>row.textContent.includes(${JSON.stringify(email)}))`);
  const directory = ok(await client.rpc('accounts_directory', { actor }), 'Read authorized directory');
  const staff = directory.users.find(user => user.email === email);
  assert.ok(staff, 'UI saved one permanent identity');
  assert.deepEqual(staff.roles, ['Accounting', 'Finance']);
  assert.equal(staff.firstSignedInAt, null, 'Invitation does not establish application onboarding');
  assert.equal(staff.messageStatus, 'accepted', 'UI dispatch reached Mailpit provider');
  const invitation = await mailLink(email, 'invite');
  const row = `[data-account-id="${staff.id}"]`;
  await browser.click(row + ' .account-row-actions button:first-child');
  await browser.wait("return !!document.querySelector('.record-dialog[open] input[name=email]')");
  assert.equal(await browser.run("return document.querySelector('.record-dialog input[name=email]').readOnly"), true, 'Saved email is fixed');
  // Change the name from another authorized command while the editor has a draft.
  await browser.fill('.record-dialog input[name=name]', 'Preserved draft');
  ok(await client.rpc('account_save', { actor, operation: randomUUID(), target: staff.id, expected_version: staff.version,
    draft: { name: 'Newer record', roles: staff.roles, projectIds: [], active: true, clearAssignments: false } }), 'Concurrent account edit');
  await browser.click('.record-dialog .form-actions .primary'); await confirm();
  await browser.wait("return document.querySelector('.record-dialog [role=alert]')?.textContent.includes('draft is preserved')");
  assert.equal(await browser.run("return document.querySelector('.record-dialog input[name=name]').value"), 'Preserved draft');
  await browser.run("[...document.querySelectorAll('.record-dialog button')].find(b=>b.textContent.includes('I reviewed')).click()");
  await browser.click('.record-dialog .form-actions .primary'); await confirm();
  await browser.wait("return !document.querySelector('.record-dialog[open]')");
  assert.match(await browser.run(`return document.querySelector(${JSON.stringify(row)}).textContent`), /Preserved draft/);
  await second.navigate(invitation);
  const password = randomUUID(); await savePassword(second, password);
  await second.wait("return location.pathname==='/sign-in'");
  await login(second, { email, password });
  await second.wait("return location.pathname==='/choose-role'");
  await second.run("const el=document.querySelector('#active-role');el.value='Accounting';el.dispatchEvent(new Event('change',{bubbles:true}));");
  await second.click('.signin-form button');
  await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  const old = await sessionCookie(second);
  const staffClient = passwordClient();
  ok(await staffClient.auth.setSession({ access_token: old.access_token, refresh_token: old.refresh_token }), 'Use current non-Administrator session');
  assert.ok((await staffClient.rpc('accounts_directory', { actor })).error, 'A browser JWT cannot invoke service-only account queries');
  await second.navigate('/admin'); assert.equal(await second.run('return location.pathname'), '/projects', 'Direct account URL requires active Administrator role');
  // Forge the actual Server Action request from a non-Administrator browser.
  const manifest = JSON.parse(await readFile('.next/server/server-reference-manifest.json', 'utf8'));
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === 'accountCommandAction')?.[0];
  assert.ok(actionId, 'Account Server Action is present in the isolated build');
  const forged = { type: 'save', requestId: randomUUID(), id: staff.id, version: '1', draft: { name: 'FORGED', roles: ['Administrator'], projectIds: [], active: true, clearAssignments: false } };
  assert.equal(await second.run(`return fetch('/admin',{method:'POST',headers:{'Next-Action':${JSON.stringify(actionId)},'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify([${JSON.stringify(forged)}])}).then(r=>r.text()).then(t=>t.includes('Use your Administrator role'))`), true, 'Actual Server Action rejects forged non-Administrator request');
  assert.equal(ok(await client.rpc('accounts_directory', { actor }), 'Directory after forged action').users.find(u => u.id === staff.id).name, 'Preserved draft');

  // A new recovery attempt preserves sessions until the native password save.
  await browser.navigate('/admin');
  const clickMessage = async () => { await browser.click(row + ' .account-row-actions button:nth-child(2)'); await confirm(); await browser.wait("return !!document.querySelector('.account-notice')"); };
  await clickMessage();
  const recovery = await mailLink(email, 'recovery');
  assert.ok(ok(await staffClient.rpc('auth_session_context'), 'Session remains before reset'), 'Sending recovery does not revoke');
  const captured = ok(await client.rpc('auth_login_preflight', { login_email: email }), 'Capture pre-reset credential proof');
  // A second successful recovery replaces the old same-kind link.
  await browser.navigate('/admin'); await clickMessage();
  const replacement = await mailLink(email, 'recovery');
  await second.navigate(recovery); await savePassword(second, randomUUID());
  await second.wait("return document.querySelector('[role=alert]')?.textContent.includes('invalid or expired')");
  await second.navigate(replacement); const changedPassword = randomUUID(); await savePassword(second, changedPassword);
  await second.wait("return location.pathname==='/sign-in'");
  assert.equal(ok(await staffClient.rpc('auth_session_context'), 'Old access after reset'), null, 'Native reset deletes old session and binding');
  assert.ok((await staffClient.auth.refreshSession()).error, 'Reset also rejects old refresh token');
  assert.equal(ok(await client.rpc('auth_bind_session', { target_user: staff.id, target_session: verified.claims.session_id,
    expected_revision: captured.revision, expected_credential: captured.credential }), 'Old challenge completion'), false, 'Credential proof captured before reset cannot bind');
  await login(second, { email, password: changedPassword });
  await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  const fresh = await sessionCookie(second);
  const current = ok(await client.rpc('accounts_directory', { actor }), 'Read staff version').users.find(u => u.id === staff.id);
  assert.ok(current.firstSignedInAt, 'Successful app sign-in qualifies onboarding');
  // Change grants through the actual Admin command and invalidate a live session.
  ok(await client.rpc('account_save', { actor, operation: randomUUID(), target: staff.id, expected_version: current.version,
    draft: { name: current.name, roles: ['Accounting'], projectIds: [], active: true, clearAssignments: false } }), 'Revoke grant transaction');
  await staffClient.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token });
  const refreshed = ok(await staffClient.auth.refreshSession(), 'Refresh after grant change');
  assert.ok(refreshed.session);
  assert.equal(ok(await staffClient.rpc('auth_session_context'), 'Changed grants reject refreshed JWT'), null);
  await second.navigate('/projects'); assert.equal(await second.run('return location.pathname'), '/sign-in');
  const audit = ok(await client.rpc('accounts_directory', { actor }), 'Read immutable account history').history;
  assert.ok(audit.some(event => event.targetId === staff.id && event.action === 'account.created'));
  assert.ok(audit.some(event => event.targetId === staff.id && event.action === 'account.updated'));
  assert.ok(audit.every(event => !/token|password|credential/i.test(JSON.stringify(event))), 'History has no credential material');
  await logout(browser);
  // All audited synthetic rows remain until the owned CI stack is destroyed.
  assert.ok((await sql(`select count(*) from private.audit_events where entity_id='${staff.id}';`)).output.trim() !== '0');
}
