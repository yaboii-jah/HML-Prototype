import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { requireLoopback } from './helpers/supabase-target.mjs';

/** Never use successful audited fixtures on hosted staging. */
export async function checkRealtimeFoundation({ api, anon, secret, sql }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  requireLoopback(api);
  const admin = createClient(api, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const clients = [];
  const ok = (result, label) => { assert.equal(result.error?.message, undefined, label); return result.data; };
  const until = async predicate => {
    const deadline = Date.now() + 15000;
    while (!predicate() && Date.now() < deadline) await delay(50);
    assert.ok(predicate(), 'Expected committed private broadcast arrived');
  };
  const login = async (role, existing) => {
    const email = existing?.email ?? randomUUID() + '@example.invalid', password = existing?.password ?? randomUUID();
    const id = existing?.id ?? ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create realtime fixture').user.id;
    if (!existing) {
      ok(await admin.from('profiles').insert({ user_id: id, display_name: 'Realtime fixture' }), 'Realtime profile');
      ok(await admin.from('role_grants').insert({ user_id: id, role }), 'Realtime grant');
    }
    const proof = ok(await admin.rpc('auth_login_preflight', { login_email: email }), 'Realtime preflight');
    const client = createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    const session = ok(await client.auth.signInWithPassword({ email, password }), 'Realtime login').session;
    const claims = ok(await client.auth.getClaims(), 'Realtime claims').claims;
    assert.equal(ok(await admin.rpc('auth_bind_session', { target_user: id, target_session: claims.session_id,
      expected_revision: proof.revision, expected_credential: proof.credential }), 'Realtime binding'), true);
    const context = ok(await client.rpc('auth_session_context'), 'Realtime context');
    await client.realtime.setAuth(session.access_token);
    return { id, email, password, client, context, sessionId: claims.session_id,
      topic: `foundation:${id}:${context.revision}:${claims.session_id}` };
  };
  const subscribe = (staff, topic = staff.topic, privateChannel = true) => new Promise(resolve => {
    const events = [];
    const channel = staff.client.channel(topic, { config: { private: privateChannel, broadcast: { ack: true } } })
      .on('broadcast', { event: '*' }, message => events.push(message))
      .subscribe((status) => { if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve({ status, channel, events }); });
    setTimeout(() => resolve({ status: 'DEADLINE', channel, events }), 12000).unref();
  });
  try {
    const manager = await login('Project Manager'), receiver = await login('Accounting'), unassigned = await login('Site Personnel');
    const managerSocket = await subscribe(manager), receiverSocket = await subscribe(receiver), siteSocket = await subscribe(unassigned);
    assert.equal(managerSocket.status, 'SUBSCRIBED'); assert.equal(receiverSocket.status, 'SUBSCRIBED'); assert.equal(siteSocket.status, 'SUBSCRIBED');
    for (const topic of [manager.topic, receiver.topic.replace(':' + receiver.context.revision + ':', ':999:'), receiver.topic.replace(receiver.sessionId, randomUUID())]) {
      const denied = await subscribe(receiver, topic);
      assert.notEqual(denied.status, 'SUBSCRIBED', 'Wrong user, revision or session cannot join');
      await receiver.client.removeChannel(denied.channel);
    }
    const publicSocket = await subscribe(receiver, 'public-fixture-' + randomUUID(), false);
    assert.notEqual(publicSocket.status, 'SUBSCRIBED', 'Public channels disabled');
    await receiver.client.removeChannel(publicSocket.channel);
    const sent = await receiverSocket.channel.send({ type: 'broadcast', event: 'foundation_changed', payload: { forged: true } });
    assert.notEqual(sent, 'ok', 'Client cannot publish authoritative invalidations');
    const actor = { userId: manager.id, sessionId: manager.sessionId, revision: manager.context.revision, activeRole: 'Project Manager' };
    const requestId = randomUUID(), command = { type: 'createProject', requestId, name: 'Realtime ' + requestId, location: 'Disposable',
      code: 'RT-' + requestId.replaceAll('-', '').slice(0, 12).toUpperCase(), budget: '100.00' };
    const baseline = receiverSocket.events.length, siteBaseline = siteSocket.events.length;
    const result = ok(await admin.rpc('project_command', { actor, command }), 'Publish project change');
    await until(() => receiverSocket.events.length > baseline);
    const payload = receiverSocket.events.at(-1).payload;
    assert.deepEqual(Object.keys(payload).filter(key => key !== 'id'), [], 'Broadcast contains no record or financial fields');
    await delay(200);
    assert.equal(siteSocket.events.length, siteBaseline, 'Unassigned Site receives no project signals');
    const count = receiverSocket.events.length;
    ok(await admin.rpc('project_command', { actor, command }), 'Retry project');
    const current = ok(await admin.rpc('projects_read', { actor, target_project: result.projectId }), 'Read project').project;
    ok(await admin.rpc('project_command', { actor, command: { ...command, type: 'saveProject', requestId: randomUUID(), projectId: result.projectId, projectVersion: current.version } }), 'Unchanged project');
    await delay(400);
    assert.equal(receiverSocket.events.length, count, 'Retry and no-op emit no duplicate invalidations');
    // A second session of the same identity receives a different topic. Removing
    // one binding must never keep its socket informed through the surviving one.
    const survivor = await login('Accounting', receiver), survivorSocket = await subscribe(survivor);
    assert.equal(survivorSocket.status, 'SUBSCRIBED');
    ok(await admin.rpc('auth_unbind_session', { target_user: receiver.id, target_session: receiver.sessionId }), 'Unbind one exact session');
    await until(() => receiverSocket.events.some(event => event.event === 'access_changed'));
    const revokedCount = receiverSocket.events.length, survivorCount = survivorSocket.events.length;
    ok(await admin.rpc('project_command', { actor, command: { ...command, requestId: randomUUID(), name: command.name + ' next', code: command.code + 'X' } }), 'Change after exact-session revocation');
    await until(() => survivorSocket.events.length > survivorCount);
    await delay(200);
    assert.equal(receiverSocket.events.length, revokedCount, 'Held-open revoked socket receives no later record signal');
    const refreshed = ok(await receiver.client.auth.refreshSession(), 'Refresh revoked session');
    assert.ok(refreshed.session);
    assert.equal(ok(await receiver.client.rpc('auth_session_context'), 'Current check after refresh'), null);
    await receiver.client.removeChannel(receiverSocket.channel);
    const retry = await subscribe(receiver, receiver.topic);
    assert.notEqual(retry.status, 'SUBSCRIBED', 'Refreshed JWT cannot rejoin obsolete binding');
    console.log('Private Realtime delivery, data-free payloads, isolation, denial, retries and exact-session revocation passed.');
  } finally {
    await Promise.all(clients.map(async client => { await client.removeAllChannels(); client.realtime.disconnect(); }));
  }
}
