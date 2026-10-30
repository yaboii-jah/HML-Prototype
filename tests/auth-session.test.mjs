import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseActiveRole, parseLoginPreflight, parseSessionContext, safeWorkspaceDestination } from '../src/domain/auth/session.ts';

test('remembered roles never establish a grant or change permanent identity', () => {
  assert.equal(chooseActiveRole(['Accounting'], 'Administrator'), 'Accounting');
  assert.equal(chooseActiveRole(['Accounting', 'Finance'], 'Administrator'), null);
  assert.equal(chooseActiveRole(['Accounting', 'Finance'], 'Finance'), 'Finance');
  assert.equal(chooseActiveRole(['Accounting', 'Finance'], null), null);
  const projection = { userId: 'd2060a60-ab04-481a-8eee-bc1b806dfac5', displayName: 'Staff', email: 'staff@example.invalid', revision: '3', roles: ['Accounting', 'Finance'], projectIds: [] };
  assert.equal(parseSessionContext(projection).userId, projection.userId);
  assert.deepEqual(parseLoginPreflight({ ...projection, credential: 'a'.repeat(64) }), { userId: projection.userId, revision: '3', credential: 'a'.repeat(64) });
  for (const value of [null, [], { userId: projection.userId, revision: 3 }, { userId: 'forged', revision: '3' }]) assert.equal(parseLoginPreflight(value), null);
  for (const override of [{ roles: ['Site Personnel', 'Administrator'] }, { roles: ['owner'] }, { revision: '0' }, { projectIds: ['forged'] }]) assert.equal(parseSessionContext({ ...projection, ...override }), null);
});

test('return destinations reject external, encoded, auth and malformed paths', () => {
  for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', '/projects/%2f%2fevil', '/auth/confirm', '/sign-in', '/projects\n', '/projects/../auth/confirm', null]) assert.equal(safeWorkspaceDestination(value), '/projects');
  assert.equal(safeWorkspaceDestination('/projects/abc'), '/projects/abc');
  assert.equal(safeWorkspaceDestination('/requests/new'), '/requests/new');
});
