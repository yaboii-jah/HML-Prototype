import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireStaging, requireLoopback, STAGING_REF, PRODUCTION_REF, STAGING_URL } from '../scripts/helpers/supabase-target.mjs';
import { migrationHash } from '../scripts/helpers/database-migrations.mjs';

test('remote tooling requires explicit staging and its own access token', () => {
  const valid = { SUPABASE_PROJECT_REF: STAGING_REF, SUPABASE_ACCESS_TOKEN: 'test-only', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL };
  assert.equal(requireStaging(valid), STAGING_REF);
  for (const patch of [
    { SUPABASE_PROJECT_REF: undefined }, { SUPABASE_PROJECT_REF: PRODUCTION_REF },
    { SUPABASE_ACCESS_TOKEN: '' }, { NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` },
    { DATABASE_URL: 'postgresql://example.invalid/app' }, { SUPABASE_DB_URL: 'postgresql://example.invalid/app' },
    { SUPABASE_CLI_BINARY_OVERRIDE: 'other-binary' },
  ]) assert.throws(() => requireStaging({ ...valid, ...patch }));
});

test('disposable tests reject remote, disguised loopback and unsupported URLs', () => {
  for (const url of ['http://127.0.0.1:54321', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres']) {
    assert.equal(requireLoopback(url).hostname, '127.0.0.1');
  }
  for (const url of [STAGING_URL, `https://${PRODUCTION_REF}.supabase.co`, 'http://127.0.0.1.example.com', 'file:///tmp/test', 'http://localhost@remote.invalid', 'http://localhost/?target=remote']) {
    assert.throws(() => requireLoopback(url));
  }
});

test('migration evidence matches Windows/Linux line endings and rejects changed migrations', () => {
  const original = [{ name: '20261029205634_foundation.sql', sql: 'select 1;\nselect 2;\n' }];
  assert.equal(migrationHash(original), migrationHash([{ ...original[0], sql: 'select 1;\r\nselect 2;\r\n' }]));
  assert.notEqual(migrationHash(original), migrationHash([{ ...original[0], sql: 'select 3;\n' }]));
  assert.notEqual(migrationHash(original), migrationHash([{ ...original[0], name: '20261029205635_changed.sql' }]));
});
