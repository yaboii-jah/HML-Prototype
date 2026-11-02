import assert from 'node:assert/strict';
import test from 'node:test';
import { standardAcceptance, databaseAcceptance, standardChecks, databaseChecks, authChecks, acceptanceRequirements } from '../scripts/helpers/foundation-acceptance.mjs';
import { canonicalSourceBytes } from '../scripts/helpers/verification-evidence.mjs';

const source = { sourceRevision: 'current', sourceHash: 'current-source', migrationHash: 'current-migrations' };
const evidence = { ...source, complete: true, passed: true };
test('source fingerprints normalize cross-platform scripts and preserve every binary byte', () => {
  assert.equal(canonicalSourceBytes('scripts/render-document-templates.ps1', Buffer.from('Write-Output 1\r\n')),
    canonicalSourceBytes('scripts/render-document-templates.ps1', Buffer.from('Write-Output 1\n')));
  for (const path of ['public/logo.webp', 'src/server/document-assets/comparison.pdf']) {
    const first = Buffer.from([0x80, 13, 10]), second = Buffer.from([0x81, 13, 10]);
    assert.deepEqual(canonicalSourceBytes(path, first), first);
    assert.notDeepEqual(canonicalSourceBytes(path, first), canonicalSourceBytes(path, second));
    assert.notDeepEqual(canonicalSourceBytes(path, first), canonicalSourceBytes(path, Buffer.from([0x80, 10])));
  }
});
test('standard acceptance requires every completed check and the maintained browser profile', () => {
  const standard = { ...evidence, results: standardChecks.map(name => ({ name, code: 0 })) };
  const browser = { ...evidence, results: [{ name: 'foundation-public', code: 0, timedOut: false }] };
  assert.equal(standardAcceptance(source, standard, browser, true).passed, true);
  for (const name of standardChecks) assert.throws(() => standardAcceptance(source,
    { ...standard, results: standard.results.filter(result => result.name !== name) }, browser, true));
  assert.throws(() => standardAcceptance(source, standard, { ...browser, results: [] }, true));
  assert.throws(() => standardAcceptance(source, standard, { ...browser, complete: false }, true));
  assert.throws(() => standardAcceptance(source, standard, { ...browser, sourceRevision: 'old' }, true));
  assert.equal(standardAcceptance(source, standard, null, false).browserRequired, false);
});

test('database acceptance maps every requirement and refuses missing checks or cleanup', () => {
  const database = { ...evidence, checks: databaseChecks, cleaned: true, typeMatch: true };
  const auth = { ...evidence, checks: authChecks, cleaned: true, isolated: true };
  const summary = databaseAcceptance(source, database, auth);
  assert.deepEqual(Object.keys(summary.scenarios), Object.keys(acceptanceRequirements));
  assert.ok(Object.values(summary.scenarios).every(scenario => scenario.passed));
  for (const check of databaseChecks) assert.throws(() => databaseAcceptance(source,
    { ...database, checks: databaseChecks.filter(name => name !== check) }, auth));
  for (const check of authChecks) assert.throws(() => databaseAcceptance(source, database,
    { ...auth, checks: authChecks.filter(name => name !== check) }));
  for (const patch of [{ cleaned: false }, { typeMatch: false }, { sourceHash: 'old' }, { migrationHash: 'old' }]) {
    assert.throws(() => databaseAcceptance(source, { ...database, ...patch }, auth));
  }
});
