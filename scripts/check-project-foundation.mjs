import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function checkProjectFoundation({ browser, second, client, login, logout, sessionCookie, administrator, passwordClient }) {
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  const fixture = async role => {
    const email = `${randomUUID()}@example.invalid`, password = randomUUID();
    const user = ok(await client.auth.admin.createUser({ email, password, email_confirm: true }), 'Create owned project account').user;
    ok(await client.from('profiles').insert({ user_id: user.id, display_name: `Project ${role}`, is_active: true }), 'Create project fixture profile');
    ok(await client.from('role_grants').insert({ user_id: user.id, role }), 'Grant fixture role');
    return { id: user.id, email, password };
  };
  const manager = await fixture('Project Manager'), site = await fixture('Site Personnel'), reader = await fixture('Accounting');
  await login(browser, administrator);
  await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  const session = await sessionCookie(browser);
  const claims = ok(await client.auth.getClaims(session.access_token), 'Verify project actor claims').claims;
  const context = await fetch(client.supabaseUrl + '/rest/v1/rpc/auth_session_context', { method: 'POST',
    headers: { apikey: client.supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
  const actor = { userId: context.userId, sessionId: claims.session_id, revision: context.revision, activeRole: 'Administrator' };
  const confirm = async (danger = false) => { await browser.wait("return !!document.querySelector('.confirm-dialog[open]')"); await browser.click(`.confirm-dialog[open] .${danger ? 'danger-outline' : 'primary'}`); };
  await browser.wait("return !!document.querySelector('.page-header .primary')&&!document.querySelector('.page-header .primary').disabled");
  await browser.click('.page-header .primary');
  await browser.wait("return !!document.querySelector('.project-editor')");
  const name = `Project browser ${randomUUID()}`, code = 'BR-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  await browser.fill('input[name=projectName]', name); await browser.fill('input[name=location]', 'Original site');
  await browser.fill('input[name=documentCode]', code); await browser.fill('input[name=projectBudget]', '100.00');
  await browser.click('.project-editor .form-actions .primary'); await confirm();
  await browser.wait(`return [...document.querySelectorAll('[data-project-id]')].some(row=>row.textContent.includes(${JSON.stringify(name)}))`);
  const directory = ok(await client.rpc('projects_read', { actor }), 'Read project directory');
  const project = directory.projects.find(p => p.name === name); assert.ok(project);
  const id = project.id;
  await browser.navigate(`/projects/${id}`);
  await browser.wait("return !!document.querySelector('.project-scope-panel .primary')&&!document.querySelector('.project-scope-panel .primary').disabled");
  const addScope = async (scopeName, budget) => {
    await browser.click('.project-scope-panel .primary'); await browser.wait("return !!document.querySelector('.scope-editor')");
    await browser.run(`const el=document.querySelector('select[name=scopeName]');el.value=${JSON.stringify(scopeName)};el.dispatchEvent(new Event('change',{bubbles:true}));`);
    await browser.fill('input[name=scopeBudget]', budget); await browser.click('.scope-editor .form-actions .primary'); await confirm();
  };
  await addScope('Structural Works', '70.00');
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.querySelector('[data-scope-id]')?.textContent.includes('Structural Works')");
  await addScope('Electrical', '40.00');
  await browser.wait("return document.querySelector('.scope-editor [role=alert]')?.textContent.includes('fit within')");
  assert.equal(await browser.run("return document.querySelector('input[name=scopeBudget]').value"), '40.00', 'Invalid allocation preserves draft');
  await browser.fill('input[name=scopeBudget]', '30.00'); await browser.click('.scope-editor .form-actions .primary'); await confirm();
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.querySelectorAll('[data-scope-id]').length===2");
  assert.match(await browser.run("return document.querySelector('.project-financials').textContent"), /100\.00/);
  // Another real manager sees the shared record, then makes an intervening edit.
  await login(second, manager); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  await second.navigate(`/projects/${id}`);
  assert.match(await second.run('return document.body.innerText'), /Structural Works/);
  await browser.click('.page-header .secondary'); await browser.wait("return !!document.querySelector('.project-editor')");
  await browser.fill('input[name=projectName]', 'Preserved project draft');
  const managerSession = await sessionCookie(second), managerClaims = ok(await client.auth.getClaims(managerSession.access_token), 'Verify manager session').claims;
  const managerContext = await fetch(client.supabaseUrl + '/rest/v1/rpc/auth_session_context', { method: 'POST', headers: { apikey: client.supabaseKey, Authorization: `Bearer ${managerSession.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
  const managerActor = { userId: manager.id, sessionId: managerClaims.session_id, revision: managerContext.revision, activeRole: 'Project Manager' };
  let current = ok(await client.rpc('projects_read', { actor, target_project: id }), 'Read current project').project;
  ok(await client.rpc('project_command', { actor: managerActor, command: { type: 'saveProject', requestId: randomUUID(), projectId: id, projectVersion: current.version, name, location: 'Newer location', code, budget: '100.00' } }), 'Manager edit');
  await browser.wait("return !![...document.querySelectorAll('.project-editor button')].find(b=>b.textContent.includes('I reviewed'))");
  assert.equal(await browser.run("return document.querySelector('.project-editor .form-actions .primary').disabled"), true, 'Live conflict blocks stale save before submission');
  assert.equal(await browser.run("return document.querySelector('input[name=projectName]').value"), 'Preserved project draft');
  await browser.run("[...document.querySelectorAll('.project-editor button')].find(b=>b.textContent.includes('I reviewed')).click()");
  await browser.click('.project-editor .form-actions .primary'); await confirm();
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.querySelector('h1')?.textContent==='Preserved project draft'");
  // Connect the existing Users assignment editor to the newly shared project.
  await browser.navigate('/admin');
  await browser.wait("return !!document.querySelector('input[aria-label=\"Search users\"]')");
  await browser.fill('input[aria-label="Search users"]', site.email);
  await browser.wait(`return !!document.querySelector('[data-account-id="${site.id}"]')`);
  await browser.click(`[data-account-id="${site.id}"] .account-row-actions button:first-child`);
  await browser.wait(`return !!document.querySelector('input[name=projectIds][value="${id}"]')`);
  await browser.click(`input[name=projectIds][value="${id}"]`);
  await browser.click('.record-dialog .form-actions .primary'); await confirm();
  await browser.wait("return !document.querySelector('.record-dialog[open]')");
  await logout(second);
  await login(second, site); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  await second.navigate(`/projects/${id}`);
  assert.equal(await second.run("return !!document.querySelector('.project-financials,.project-history,.project-removal')"), false, 'Site sees no financial/history/admin controls');
  assert.equal(await second.run("return document.querySelectorAll('th.numeric').length"), 0);
  const siteSession = await sessionCookie(second), siteClient = passwordClient();
  ok(await siteClient.auth.setSession({ access_token: siteSession.access_token, refresh_token: siteSession.refresh_token }), 'Use managed Site session');
  const directBudget = ok(await siteClient.from('project_budgets').select('*').eq('project_id', id), 'Direct Site budget read');
  assert.deepEqual(directBudget, []);
  const embedded = ok(await siteClient.from('projects').select('id,project_budgets(amount),scopes(id,scope_budgets(amount))').eq('id', id), 'Embedded Site finance read');
  const denied = value => value === null || Array.isArray(value) && value.length === 0;
  assert.ok(embedded.every(p => denied(p.project_budgets) && p.scopes.every(s => denied(s.scope_budgets))));
  const html = await second.run(`return fetch('/projects/${id}').then(r=>r.text())`);
  assert.equal(/\\?"financial\\?"\s*:/.test(html), false, 'Site page response omits financial DTOs');
  const manifest = JSON.parse(await readFile('.next/server/server-reference-manifest.json', 'utf8'));
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === 'projectCommandAction')?.[0];
  assert.ok(actionId);
  const forged = { type: 'createProject', requestId: randomUUID(), name: 'FORGED PROJECT', location: 'Forged', code: 'FORGED', budget: '1.00' };
  assert.equal(await second.run(`return fetch('/projects',{method:'POST',headers:{'Next-Action':${JSON.stringify(actionId)},'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify([${JSON.stringify(forged)}])}).then(r=>r.text()).then(t=>t.includes('Administrator or Project Manager'))`), true, 'Actual action rejects Site writes');
  await second.navigate('/projects/' + randomUUID());
  assert.equal(await second.run("return document.body.innerText.includes('Structural Works')"), false, 'Unassigned target does not reveal scopes');
  // All non-Site readers see financial values/history but cannot mutate.
  await second.navigate('/projects'); await logout(second);
  await login(second, reader); await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  await second.navigate(`/projects/${id}`);
  assert.equal(await second.run("return !!document.querySelector('.project-financials,.project-history')"), true);
  assert.equal(await second.run("return !!document.querySelector('.project-removal,.page-header button')"), false);
  await logout(second); await login(second, manager);
  await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
  await second.navigate(`/projects/${id}`);
  assert.equal(await second.run("return document.querySelector('.project-removal button').disabled"), true, 'PM cannot remove Administrator-managed assignments');
  // Keep a distinct live Site session: the browser's earlier Site session was
  // deliberately signed out while switching to the read-only/manager checks.
  const preflight = ok(await client.rpc('auth_login_preflight', { login_email: site.email }), 'Capture independent Site login proof');
  const independent = ok(await siteClient.auth.signInWithPassword({ email: site.email, password: site.password }), 'Independent Site sign-in');
  const independentClaims = ok(await siteClient.auth.getClaims(independent.session.access_token), 'Verify independent Site session').claims;
  assert.equal(ok(await client.rpc('auth_bind_session', { target_user: site.id, target_session: independentClaims.session_id,
    expected_revision: preflight.revision, expected_credential: preflight.credential }), 'Bind independent Site session'), true);
  assert.ok(ok(await siteClient.rpc('auth_session_context'), 'Site access before deletion'));
  await browser.navigate(`/projects/${id}`);
  await browser.wait("return !!document.querySelector('.project-removal button')&&!document.querySelector('.project-removal button').disabled");
  await browser.click('.project-removal button'); await confirm(true);
  await browser.wait("return location.pathname==='/projects'&&!document.querySelector('.record-dialog[open]')");
  assert.equal(ok(await client.rpc('projects_read', { actor, target_project: id }), 'Deleted project query').project, null);
  ok(await siteClient.auth.refreshSession(), 'Refresh Site after deletion');
  assert.equal(ok(await siteClient.rpc('auth_session_context'), 'Site context after deletion'), null, 'Assignment cascade rejects refreshed Site session');
  assert.ok(ok(await client.rpc('projects_read', { actor }), 'Deletion history').history.some(h => h.action === 'project.deleted' && h.projectId === id));
  // Verify the existing input control and rendered DTO retain the largest
  // supported PHP value, then inspect the authenticated mobile layout.
  await browser.wait("return !!document.querySelector('.page-header .primary')&&!document.querySelector('.page-header .primary').disabled");
  await browser.click('.page-header .primary'); await browser.wait("return !!document.querySelector('.project-editor')");
  const largeName = `Exact browser ${randomUUID()}`;
  await browser.fill('input[name=projectName]', largeName); await browser.fill('input[name=location]', 'Exact site');
  await browser.fill('input[name=documentCode]', 'LG-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase());
  await browser.fill('input[name=projectBudget]', '9999999999999999.99');
  await browser.click('.project-editor .form-actions .primary'); await confirm();
  await browser.wait(`return [...document.querySelectorAll('[data-project-id]')].some(row=>row.textContent.includes(${JSON.stringify(largeName)})&&row.textContent.includes('9,999,999,999,999,999.99'))`);
  const large = ok(await client.rpc('projects_read', { actor }), 'Exact UI project result').projects.find(p => p.name === largeName);
  await browser.navigate(`/projects/${large.id}`);
  await browser.wait("return !!document.querySelector('.project-scope-panel .primary')&&!document.querySelector('.project-scope-panel .primary').disabled");
  await addScope('General Requirement', '9999999999999999.99');
  await browser.wait("return !document.querySelector('.record-dialog[open]')&&document.querySelector('[data-scope-id]')?.textContent.includes('9,999,999,999,999,999.99')");
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await browser.wait('return innerWidth===375');
  assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth+1'), true, 'Authenticated project page fits the mobile viewport');
  await browser.call('Emulation.clearDeviceMetricsOverride');
  await logout(browser); await logout(second);
  console.log('Shared project/scope UI, role-safe reads, conflicts, assignments and deletion revocation passed.');
}
