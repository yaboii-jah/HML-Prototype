import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { requireStaging, STAGING_URL } from './helpers/supabase-target.mjs';

requireStaging(process.env);
if (process.argv.length !== 2 || !process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_') || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw Error('Staging session parity needs the staging server secret and publishable key, without arguments.');
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
const admin = createClient(STAGING_URL, process.env.SUPABASE_SECRET_KEY, options);
const browser = createClient(STAGING_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const runId = randomUUID();
const email = `foundation-${runId}@example.invalid`;
let password = randomUUID();
let userId;
let passed = false;
let cleaned = false;
const ok = (result, message) => { if (result.error) throw Error(message); return result.data; };
const counts = async () => {
  const result = {};
  for (const table of ['profiles','role_grants','project_assignments','projects','scopes','project_budgets','scope_budgets']) {
    const query = await admin.from(table).select('*', { count: 'exact', head: true });
    if (query.error) throw Error('Retained staging counts could not be checked.');
    result[table] = query.count;
  }
  return result;
};
const before = await counts();
await writeFile('.verification/staging-sessions.json', JSON.stringify({ passed: false, cleaned: false, runId }, null, 2));
const freshLogin = async () => {
  const preflight = ok(await admin.rpc('auth_login_preflight', { login_email: email }), 'Read login preflight');
  const login = ok(await browser.auth.signInWithPassword({ email, password }), 'Synthetic password sign-in');
  const verified = ok(await browser.auth.getClaims(login.session.access_token), 'Verify synthetic JWT');
  assert.equal(verified.claims.sub, userId);
  const bound = ok(await admin.rpc('auth_bind_session', { target_user: userId, target_session: verified.claims.session_id, expected_revision: preflight.revision, expected_credential: preflight.credential }), 'Bind fresh synthetic session');
  assert.equal(bound, true);
  return { ...login.session, sessionId: verified.claims.session_id };
};
try {
  const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { foundation_check_id: runId }, user_metadata: { role: 'Administrator' } }), 'Create run-owned synthetic identity');
  userId = created.user.id;
  ok(await admin.from('profiles').insert({ user_id: userId, display_name: 'Synthetic session parity', is_active: true }), 'Create run-owned synthetic profile');
  ok(await admin.from('role_grants').insert([{ user_id: userId, role: 'Accounting' }, { user_id: userId, role: 'Finance' }]), 'Create synthetic grants');
  ok(await browser.auth.signInWithPassword({ email, password }), 'Authenticate without app binding');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read unbound projection'), null);
  const session = await freshLogin();
  let context = ok(await browser.rpc('auth_session_context'), 'Read current projection');
  assert.equal(context.userId, userId);
  assert.deepEqual(context.roles, ['Accounting','Finance']);
  assert.ok((await browser.rpc('auth_bind_session', { target_user: userId, target_session: session.sessionId, expected_revision: context.revision })).error, 'Browser cannot bind sessions');
  assert.equal((await browser.auth.updateUser({ password: randomUUID() })).error?.code, 'current_password_required');
  ok(await admin.from('role_grants').delete().eq('user_id', userId).eq('role', 'Finance'), 'Change only synthetic grants');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read revoked context'), null);
  ok(await browser.auth.refreshSession({ refresh_token: session.refresh_token }), 'Refresh real Auth session');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read refreshed revoked context'), null);
  const current = await freshLogin();
  ok(await admin.rpc('auth_unbind_session', { target_user: userId, target_session: current.sessionId }), 'Unbind synthetic session');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read signed-out context'), null);
  const recovery = ok(await admin.auth.admin.generateLink({ type: 'recovery', email }), 'Generate a restricted synthetic recovery link without sending email');
  ok(await browser.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token }), 'Verify one-time recovery proof');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read recovery context'), null, 'Recovery is unbound');
  password = randomUUID();
  ok(await browser.auth.updateUser({ password }), 'Recovery proof allows setting a password');
  ok(await browser.auth.signOut({ scope: 'local' }), 'End temporary recovery session');
  assert.ok((await browser.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token })).error, 'Recovery proof cannot be replayed');
  await freshLogin();
  ok(await admin.from('profiles').update({ is_active: false }).eq('user_id', userId), 'Deactivate only the synthetic profile');
  assert.equal(ok(await browser.rpc('auth_session_context'), 'Read inactive context'), null);
  assert.equal(ok(await admin.rpc('auth_login_preflight', { login_email: email }), 'Read inactive login preflight'), null);
  passed = true;
} finally {
  await browser.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (!userId) {
    // A create response may have been lost. Recover only this run's trusted
    // marker, never adopt an existing user solely because an email matches.
    for (let page = 1; page <= 100; page++) {
      const list = ok(await admin.auth.admin.listUsers({ page, perPage: 100 }), `Synthetic cleanup discovery failed for run ${runId}.`);
      const owned = list.users.find(user => user.email === email && user.app_metadata?.foundation_check_id === runId);
      if (owned) { userId = owned.id; break; }
      if (list.users.length < 100) break;
    }
  }
  if (userId) {
    const owned = ok(await admin.auth.admin.getUserById(userId), 'Verify synthetic cleanup ownership').user;
    if (owned.email !== email || owned.app_metadata?.foundation_check_id !== runId) throw Error(`Synthetic cleanup ownership mismatch for ${userId}.`);
    ok(await admin.from('profiles').delete().eq('user_id', userId), `Synthetic profile cleanup failed for ${userId}.`);
    ok(await admin.auth.admin.deleteUser(userId), `Synthetic Auth cleanup failed for ${userId}.`);
    cleaned = true;
  }
  const after = await counts();
  assert.deepEqual(after, before, 'Retained staging record counts are unchanged');
  await writeFile('.verification/staging-sessions.json', JSON.stringify({ passed, cleaned, runId, retainedCountsMatch: true, emailSent: false, before, after }, null, 2));
}
assert.ok(passed && cleaned);
console.log('Staging session, revocation, refresh and recovery parity passed; synthetic identity cleaned; no email sent.');
