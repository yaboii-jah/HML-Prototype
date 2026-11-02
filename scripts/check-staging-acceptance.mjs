import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { requireStaging, STAGING_REF, STAGING_URL } from './helpers/supabase-target.mjs';
import { stagingSnapshot } from './helpers/staging-snapshot.mjs';
import { verificationSource } from './helpers/verification-evidence.mjs';

requireStaging(process.env);
if (process.argv.length !== 2 || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw Error('Use the explicit staging environment without arguments.');
await mkdir('.verification', { recursive: true });
const source = await verificationSource();
const result = { ...source, passed: false, complete: false, projectRef: STAGING_REF, emailSent: false, checks: [] };
await writeFile('.verification/staging-acceptance.json', JSON.stringify(result));
const before = await stagingSnapshot();
async function run(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { env: process.env, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  assert.equal(code, 0, script + ' ' + args.join(' '));
}
async function denied(privateChannel) {
  const client = createClient(STAGING_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const channel = client.channel('foundation-acceptance-' + randomUUID(), { config: { private: privateChannel } });
  try {
    const rejection = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('Staging channel rejection timed out')), 20000);
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); reject(Error('Unauthorized staging subscription succeeded')); }
        if (status === 'CHANNEL_ERROR') { clearTimeout(timer); done(error?.message ?? String(error)); }
      });
    });
    if (!privateChannel) assert.match(rejection, /PrivateOnly|only allows private channels/, 'Protocol explicitly enforces private-only access');
    return true;
  } finally {
    await client.removeChannel(channel);
    client.realtime.disconnect();
  }
}
try {
  const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select version from supabase_migrations.schema_migrations order by version;', read_only: true }),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, 'Read-only staging migration history');
  assert.deepEqual((await response.json()).map(row => row.version),
    (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort().map(name => name.split('_')[0]));
  result.checks.push('migration-history');
  for (const action of ['auth-check', 'types-check', 'check']) {
    await run('scripts/staging-database.mjs', [action]); result.checks.push(action);
  }
  await run('scripts/check-staging-sessions.mjs'); result.checks.push('auth-only-parity');
  await denied(false); result.checks.push('private-only-protocol');
  await denied(true); result.checks.push('anonymous-private-denial');
  result.passed = true; result.complete = true;
} finally {
  const after = await stagingSnapshot();
  result.retainedStateMatches = JSON.stringify(after) === JSON.stringify(before);
  result.passed = result.passed && result.retainedStateMatches;
  result.complete = result.passed;
  await writeFile('.verification/staging-acceptance.json', JSON.stringify({ ...result, at: new Date().toISOString(), before, after }, null, 2));
  assert.deepEqual(after, before, 'Whole acceptance run preserves retained staging state');
}
console.log('Staging acceptance parity passed; retained state unchanged, no email sent.');
