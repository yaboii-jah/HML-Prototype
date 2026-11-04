import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireStaging, STAGING_REF } from './helpers/supabase-target.mjs';
import { supabase } from './helpers/supabase-cli.mjs';
import { migrationHash } from './helpers/database-migrations.mjs';
import { generateDatabaseTypes, normalizeDatabaseTypes } from './helpers/database-types.mjs';
import assert from 'node:assert/strict';
import { stagingSnapshot } from './helpers/staging-snapshot.mjs';

const action = process.argv[2];
if (!['preview', 'apply', 'types', 'types-check', 'check', 'auth-check', 'auth-apply', 'realtime-check', 'realtime-apply'].includes(action) || process.argv.length > 3) {
  throw new Error('Use preview, apply, types, types-check, check, auth-check, auth-apply, realtime-check or realtime-apply without extra arguments.');
}
requireStaging(process.env);

async function requireVerifiedMigrations() {
  const evidence = JSON.parse(await readFile('.verification/database-ci.json', 'utf8'));
  const { readdir } = await import('node:fs/promises');
  const files = [];
  for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    files.push({ name, sql: await readFile('supabase/migrations/' + name, 'utf8') });
  }
  if (evidence.migrationHash !== migrationHash(files) || evidence.passed !== true || evidence.typeMatch !== true
    || !evidence.runUrl?.startsWith('https://github.com/')) {
    throw Error('Download passing database CI evidence for these exact migrations before applying to staging.');
  }
}

const authSettings = {
  disable_signup: true,
  external_anonymous_users_enabled: false,
  external_email_enabled: true,
  site_url: 'http://127.0.0.1:3000',
  uri_allow_list: 'http://127.0.0.1:3000/auth/confirm',
  password_min_length: 8,
  security_update_password_require_current_password: true,
};

if (action.startsWith('realtime-')) {
  const endpoint = `https://api.supabase.com/v1/projects/${STAGING_REF}/config/realtime`;
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  if (action === 'realtime-apply') {
    await requireVerifiedMigrations();
    const updated = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ private_only: true }), signal: AbortSignal.timeout(30000) });
    if (!updated.ok) throw Error(`Staging Realtime configuration failed (${updated.status}).`);
  }
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Staging Realtime inspection failed (${response.status}).`);
  if ((await response.json()).private_only !== true) throw Error('Staging private-only channels are not enabled.');
  console.log('Staging Realtime accepts private channels only.');
} else if (action.startsWith('auth-')) {
  const endpoint = `https://api.supabase.com/v1/projects/${STAGING_REF}/config/auth`;
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  if (action === 'auth-apply') {
    const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(authSettings) });
    if (!response.ok) throw new Error(`Staging Auth update failed (${response.status}).`);
  }
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`Staging Auth inspection failed (${response.status}).`);
  const actual = await response.json();
  const differences = Object.keys(authSettings).filter(key => actual[key] !== authSettings[key]);
  if (differences.length) throw new Error(`Staging Auth settings differ: ${differences.join(', ')}. Review before db:staging:auth:apply.`);
  console.log('Staging Auth settings match the invitation-only development configuration.');
} else if (action === 'types' || action === 'types-check') {
  const output = await generateDatabaseTypes(async query => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: true }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Staging type introspection failed (${response.status}).`);
    return response.json();
  });
  if (action === 'types-check') {
    await mkdir('.verification', { recursive: true });
    await writeFile('.verification/staging.types.ts', output);
    assert.equal(output, normalizeDatabaseTypes(await readFile('src/server/database/database.types.ts', 'utf8')), 'Staging types match committed types');
    console.log('Read-only staging types match committed types.');
  } else {
    await mkdir('src/server/database', { recursive: true });
    await writeFile('src/server/database/database.types.ts', output);
    console.log('Generated staging database types.');
  }
} else if (action === 'check') {
  const before = await stagingSnapshot();
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/staging.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/sessions.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/accounts.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/projects.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/realtime.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/requests.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/documents.sql')]);
  await supabase(['db', 'query', '--linked', '--project-ref', STAGING_REF, '--file', resolve('supabase/checks/mrf-review.sql')]);
  const after = await stagingSnapshot();
  assert.deepEqual(after, before, 'Rollback checks preserve retained staging state');
  await mkdir('.verification', { recursive: true });
  await writeFile('.verification/staging-database-checks.json', JSON.stringify({ passed: true, retainedStateMatches: true, before, after }, null, 2));
} else {
  if (action === 'apply') {
    const evidence = JSON.parse(await readFile('.verification/database-ci.json', 'utf8'));
    const { readdir } = await import('node:fs/promises');
    const files = [];
    for (const file of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
      files.push({ name: file, sql: await readFile(`supabase/migrations/${file}`, 'utf8') });
    }
    if (evidence.migrationHash !== migrationHash(files) || evidence.passed !== true || evidence.typeMatch !== true || !evidence.runUrl?.startsWith('https://github.com/')) {
      throw new Error('Download passing database CI evidence for these exact migrations before applying to staging.');
    }
  }
  const args = ['db', 'push', '--linked', '--project-ref', STAGING_REF, '--skip-vault'];
  args.push(action === 'preview' ? '--dry-run' : '--yes');
  await supabase(args);
}
