import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonicalMoney, formatPhp, moneyCents, parseProjectCommand, parseProject, parseProjectHistory } from '../src/domain/projects/projects.ts';

const id = randomUUID(), requestId = randomUUID();
const draft = { type: 'createProject', requestId, name: ' Project ', location: ' Site ', code: ' abc-01 ', budget: '9999999999999999.99' };
test('PHP values retain every cent through the full supported range', () => {
  assert.equal(canonicalMoney('9999999999999999.99'), '9999999999999999.99');
  assert.equal(moneyCents('9999999999999999.99'), BigInt('999999999999999999'));
  assert.equal(canonicalMoney('0000000000000001.1'), '1.10');
  assert.equal(canonicalMoney('0'), '0.00');
  assert.equal(formatPhp('9999999999999999.99'), '₱9,999,999,999,999,999.99');
  assert.equal(formatPhp(null), 'Unavailable');
  for (const value of ['', null, 0, '-1', '1.001', 'NaN', 'Infinity', '1e3', '1,000', '10000000000000000']) assert.equal(canonicalMoney(value), null);
});
test('project commands normalize input without rounding or accepting unknown operations', () => {
  assert.deepEqual(parseProjectCommand(draft), { ...draft, name: 'Project', location: 'Site', code: 'ABC-01' });
  for (const changes of [{ name: '' }, { location: '' }, { code: 'A--B' }, { code: 'a/b' }, { budget: '' }, { budget: 100 }, { type: 'resetWorkspace' }]) assert.equal(parseProjectCommand({ ...draft, ...changes }), null);
  const scope = { type: 'createScope', requestId, projectId: id, projectVersion: '999999999999999999', name: 'Structural Works', budget: '0' };
  assert.equal(parseProjectCommand(scope).budget, '0.00');
  assert.equal(parseProjectCommand({ ...scope, name: 'Custom scope' }), null);
  assert.equal(parseProjectCommand({ ...scope, projectVersion: 1 }), null);
  assert.equal(parseProjectCommand({ type: 'deleteProject', requestId, projectId: id, projectVersion: '1', assignmentIds: [id, id], clearAssignments: true }), null);
});
test('Site project contracts reject financial payloads and omit assignment administration', () => {
  const summary = { id, name: 'Project', location: '', code: null, codeLocked: false, version: '1', scopeCount: 1,
    scopes: [{ id: requestId, name: 'Electrical', version: '2' }] };
  const site = parseProject(summary, false, true, 'Site Personnel');
  assert.ok(site);
  assert.equal('financial' in site, false); assert.equal('budget' in site.scopes[0], false);
  assert.equal(parseProject({ ...summary, financial: { budget: '0', allocated: '0', unallocated: '0' } }, false, true, 'Site Personnel'), null);
  assert.equal(parseProject({ ...summary, scopes: [{ ...summary.scopes[0], budget: '0' }] }, false, true, 'Site Personnel'), null);
  assert.deepEqual(parseProjectHistory([], false), []);
  assert.equal(parseProjectHistory([{}], false), null);
  const finance = parseProject({ ...summary, financial: { budget: null, allocated: '0', unallocated: null }, scopes: [{ ...summary.scopes[0], budget: null }] }, true, true, 'Accounting');
  assert.equal(finance.financial.budget, null, 'Missing is distinct from zero');
  assert.equal(finance.financial.allocated, '0.00');
});
