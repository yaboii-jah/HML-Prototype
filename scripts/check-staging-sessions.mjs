import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { requireStaging, STAGING_URL, STAGING_REF } from './helpers/supabase-target.mjs';

requireStaging(process.env);
if (process.argv.length !== 2 || !process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_') || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw Error('Staging parity needs the private staging project secret, publishable key and maintenance PAT, without arguments.');
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
const admin = createClient(STAGING_URL, process.env.SUPABASE_SECRET_KEY, options);
const browser = () => createClient(STAGING_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const user = browser(), temporary = browser();
const runId = randomUUID(), userId = randomUUID(), email = `foundation-${runId}@example.invalid`;
const password = randomUUID();
let passed = false, cleaned = false;
const ok = (result, label) => { if (result.error) throw Error(label); return result.data; };
async function snapshot() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read_only: true, query: `select jsonb_build_object(
      'profiles',(select coalesce(jsonb_agg(jsonb_build_array(user_id,version::text,access_revision::text,is_active,first_signed_in_at) order by user_id),'[]'::jsonb) from public.profiles),
      'counts',jsonb_build_array((select count(*) from auth.users),(select count(*) from auth.sessions),
        (select count(*) from public.role_grants),(select count(*) from public.project_assignments),
        (select count(*) from public.projects),(select count(*) from public.scopes),
        (select count(*) from public.project_budgets),(select count(*) from public.scope_budgets),
        (select count(*) from private.session_bindings),(select count(*) from private.audit_events),
        (select count(*) from private.account_operations)),
      'guard',(select revision::text from private.account_guard where id)) as snapshot;` }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Staging retained-state inspection failed.');
  const data = await response.json();
  if (!data[0]?.snapshot) throw Error('Invalid staging snapshot.');
  return data[0].snapshot;
}
await mkdir('.verification', { recursive: true });
const before = await snapshot();
await writeFile('.verification/staging-sessions.json', JSON.stringify({ passed: false, cleaned: false, runId, userId, authOnly: true }, null, 2));
try {
  ok(await admin.auth.admin.createUser({ id: userId, email, password, email_confirm: true,
    app_metadata: { foundation_check_id: runId }, user_metadata: { role: 'Administrator' } }), 'Create run-owned Auth-only identity');
  const session = ok(await user.auth.signInWithPassword({ email, password }), 'Auth-only password sign-in').session;
  const verified = ok(await user.auth.getClaims(session.access_token), 'Verify Auth-only claims');
  assert.equal(verified.claims.sub, userId);
  assert.equal(ok(await admin.rpc('auth_login_preflight', { login_email: email }), 'Unmanaged preflight'), null);
  assert.equal(ok(await user.rpc('auth_session_context'), 'Unmanaged context'), null, 'Forged metadata provides no application access');
  assert.ok((await user.rpc('accounts_directory', { actor: { userId, sessionId: verified.claims.session_id, revision: '1', activeRole: 'Administrator' } })).error, 'Browser cannot invoke service account RPC');
  assert.ok((await user.rpc('auth_bind_session', { target_user: userId, target_session: verified.claims.session_id, expected_revision: '1', expected_credential: '0'.repeat(64) })).error);
  assert.equal((await user.auth.updateUser({ password: randomUUID() })).error?.code, 'current_password_required');
  ok(await user.auth.refreshSession(), 'Refresh unmanaged Auth token');
  assert.equal(ok(await user.rpc('auth_session_context'), 'Unmanaged refreshed context'), null);
  const recovery = ok(await admin.auth.admin.generateLink({ type: 'recovery', email }), 'Generate restricted recovery proof without email');
  ok(await temporary.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token }), 'Verify restricted recovery proof');
  assert.equal(ok(await temporary.rpc('auth_session_context'), 'Temporary unbound context'), null);
  const updatedPassword = randomUUID();
  ok(await temporary.auth.updateUser({ password: updatedPassword }), 'Save recovered password');
  assert.ok((await user.auth.refreshSession()).error, 'Successful reset revokes old Auth refresh session');
  assert.equal(ok(await user.rpc('auth_session_context'), 'Old unmanaged context after reset'), null);
  ok(await temporary.auth.signOut({ scope: 'local' }), 'End unbound recovery session');
  assert.ok((await temporary.auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token })).error, 'Recovery proof cannot be replayed');
  ok(await user.auth.signInWithPassword({ email, password: updatedPassword }), 'New password works');
  assert.equal(ok(await user.rpc('auth_session_context'), 'New Auth-only login'), null);
  passed = true;
} finally {
  await Promise.allSettled([user.auth.signOut({ scope: 'local' }), temporary.auth.signOut({ scope: 'local' })]);
  const lookup = await admin.auth.admin.getUserById(userId);
  if (lookup.data?.user) {
    const owned = lookup.data.user;
    if (owned.email !== email || owned.app_metadata?.foundation_check_id !== runId) throw Error('Synthetic Auth cleanup ownership mismatch.');
    ok(await admin.auth.admin.deleteUser(userId), 'Clean only the run-owned Auth identity');
    cleaned = true;
  } else if (lookup.error?.status === 404 || lookup.error?.code === 'user_not_found') cleaned = true;
  else throw Error('Synthetic Auth cleanup could not verify ownership.');
  const after = await snapshot();
  assert.deepEqual(after, before, 'Retained records, audits and real Administrator versions/revisions are unchanged');
  await writeFile('.verification/staging-sessions.json', JSON.stringify({ passed, cleaned, runId, authOnly: true,
    retainedStateMatches: true, emailSent: false, before, after }, null, 2));
}
assert.ok(passed && cleaned);
console.log('Staging Auth-only recovery, replay, refresh and access-denial checks passed; retained state unchanged; no email sent.');
