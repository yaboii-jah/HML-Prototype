import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkRealtimeBrowser({ browser, second, client, login, logout, sessionCookie, administrator }) {
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  // Controlled transport loss and clock ticks live only in this disposable
  // browser profile. No production test bypass or special endpoint is added.
  const preload = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__foundationTicks=[];window.__dropBroadcasts=false;
    const interval=window.setInterval;
    window.setInterval=function(fn,ms,...args){if(ms===30000)window.__foundationTicks.push(()=>fn(...args));return interval.call(this,fn,ms,...args)};
    const Native=window.WebSocket;
    window.WebSocket=class extends Native{
      set onmessage(listener){super.onmessage=event=>{
        let data;try{data=JSON.parse(event.data)}catch{}
        if(window.__dropBroadcasts&&(data?.event==='broadcast'||data?.[3]==='broadcast'))return;
        if(listener)listener.call(this,event);
      }}
      get onmessage(){return super.onmessage}
    };
  ` });
  try {
    await login(browser, administrator);
    await browser.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    const stored = await sessionCookie(browser);
    const claims = ok(await client.auth.getClaims(stored.access_token), 'Realtime browser claims').claims;
    const response = await fetch(client.supabaseUrl + '/rest/v1/rpc/auth_session_context', { method: 'POST',
      headers: { apikey: client.supabaseKey, Authorization: 'Bearer ' + stored.access_token, 'Content-Type': 'application/json' }, body: '{}' });
    const context = await response.json();
    const actor = { userId: context.userId, sessionId: claims.session_id, revision: context.revision, activeRole: 'Administrator' };
    const requestId = randomUUID(), name = 'Live browser ' + requestId;
    const base = { type: 'createProject', requestId, name, location: 'Original', code: 'LV-' + requestId.replaceAll('-', '').slice(0, 12).toUpperCase(), budget: '100.00' };
    const saved = ok(await client.rpc('project_command', { actor, command: base }), 'Realtime browser project');
    await browser.wait(`return [...document.querySelectorAll('[data-project-id]')].some(row=>row.textContent.includes(${JSON.stringify(name)}))`);
    await browser.navigate('/projects/' + saved.projectId);
    await browser.wait("return !document.querySelector('.foundation-status')&&!!document.querySelector('.project-scope-panel')");
    assert.equal(await browser.run("return Object.keys(localStorage).some(key=>key.includes('auth-token'))"), false, 'Realtime token is not persisted in browser storage');
    const boot = await browser.run("const r=await fetch('/api/realtime/session');const b=await r.json();return {status:r.status,cache:r.headers.get('cache-control'),keys:Object.keys(b)}");
    assert.equal(boot.status, 200); assert.match(boot.cache, /no-store/); assert.equal(boot.keys.includes('refreshToken'), false);
    await browser.click('.page-header .secondary');
    await browser.wait("return !!document.querySelector('.project-editor')");
    await browser.fill('input[name=projectName]', 'Draft survives missed events');
    await browser.run('window.__dropBroadcasts=true');
    let current = ok(await client.rpc('projects_read', { actor, target_project: saved.projectId }), 'Read for missed event').project;
    ok(await client.rpc('project_command', { actor, command: { ...base, type: 'saveProject', requestId: randomUUID(), projectId: saved.projectId, projectVersion: current.version, location: 'Missed event update' } }), 'Commit missed signal');
    await delay(500);
    await browser.run('for(const tick of window.__foundationTicks)tick()');
    await browser.wait("return !![...document.querySelectorAll('.project-editor button')].find(b=>b.textContent.includes('I reviewed'))");
    assert.equal(await browser.run("return document.querySelector('input[name=projectName]').value"), 'Draft survives missed events');
    await browser.run("[...document.querySelectorAll('.project-editor button')].find(b=>b.textContent.includes('I reviewed')).click()");
    await browser.run('window.__dropBroadcasts=false');
    current = ok(await client.rpc('projects_read', { actor, target_project: saved.projectId }), 'Read for repeated conflict').project;
    ok(await client.rpc('project_command', { actor, command: { ...base, type: 'saveProject', requestId: randomUUID(), projectId: saved.projectId, projectVersion: current.version, location: 'Another newer update' } }), 'Commit repeated signal');
    await browser.wait("return document.querySelector('.project-editor .form-actions .primary').disabled&&document.querySelector('.project-editor').textContent.includes('Another newer update')");
    await browser.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await browser.run('for(const tick of window.__foundationTicks)tick()');
    await browser.wait("return /stale|reconnecting/.test(document.querySelector('.foundation-status')?.textContent??'')");
    assert.equal(await browser.run("return document.querySelector('input[name=projectName]').value"), 'Draft survives missed events', 'Network failure preserves input');
    await browser.call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await browser.run("window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))");
    await browser.wait("return !document.querySelector('.foundation-status')");
    current = ok(await client.rpc('projects_read', { actor, target_project: saved.projectId }), 'Read for remote deletion').project;
    ok(await client.rpc('project_command', { actor, command: { type: 'deleteProject', requestId: randomUUID(), projectId: saved.projectId, projectVersion: current.version, assignmentIds: [], clearAssignments: false } }), 'Remote project deletion');
    await browser.wait("return document.querySelector('h1')?.textContent==='Project removed'");
    assert.equal(await browser.run("return document.querySelector('input[name=projectName]').value"), 'Draft survives missed events');
    assert.equal(await browser.run("return document.querySelector('.project-editor .form-actions .primary').disabled"), true);
    await browser.navigate('/projects');
    const email = randomUUID() + '@example.invalid', password = randomUUID();
    const staffId = ok(await client.auth.admin.createUser({ email, password, email_confirm: true }), 'Revocation browser fixture').user.id;
    ok(await client.from('profiles').insert({ user_id: staffId, display_name: 'Revocation browser staff', is_active: true }), 'Revocation profile');
    ok(await client.from('role_grants').insert({ user_id: staffId, role: 'Project Manager' }), 'Revocation role');
    await login(second, { email, password });
    await second.wait("return location.pathname==='/projects'&&!!document.querySelector('.masthead-account')");
    await second.click('.page-header .primary');
    await second.wait("return !!document.querySelector('.project-editor')");
    await second.fill('input[name=projectName]', 'Draft must clear on revocation');
    const staff = ok(await client.rpc('accounts_directory', { actor }), 'Read before browser revocation').users.find(user => user.id === staffId);
    ok(await client.rpc('account_save', { actor, operation: randomUUID(), target: staffId, expected_version: staff.version,
      draft: { name: staff.name, roles: staff.roles, projectIds: [], active: false, clearAssignments: false } }), 'Revoke open browser');
    await second.wait("return location.pathname==='/sign-in'&&!!document.querySelector('#signin-email')");
    assert.equal(await second.run("return !!document.querySelector('.project-editor,.project-financials')"), false, 'Confirmed revocation clears protected content and drafts');
    await logout(browser);
    console.log('Realtime browser delivery, silent-loss reconciliation, repeated conflicts, reconnect and deleted drafts passed.');
  } finally {
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload.identifier });
  }
}
