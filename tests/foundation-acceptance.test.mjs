import assert from 'node:assert/strict';
import test from 'node:test';
import { standardAcceptance, databaseAcceptance, standardChecks, databaseChecks, authChecks, acceptanceRequirements } from '../scripts/helpers/foundation-acceptance.mjs';

const source = { sourceRevision: 'current', sourceHash: 'current-source', migrationHash: 'current-migrations' };
const evidence = { ...source, complete: true, passed: true };
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
