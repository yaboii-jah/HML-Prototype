import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { parseAccountCommand, parseDirectory } from '../src/domain/accounts/accounts.ts';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  return next(specifier, context);
} });
const { executeAccountCommand } = await import('../src/server/accounts/workflow.ts');
const id = randomUUID(), requestId = randomUUID();
const actor = { userId: randomUUID(), sessionId: randomUUID(), revision: '2', activeRole: 'Administrator' };
const draft = { name: ' Staff ', email: 'Staff@Example.invalid', roles: ['Accounting', 'Finance'], projectIds: [], active: true, clearAssignments: false };
const account = { id, name: 'Staff', email: 'staff@example.invalid', roles: ['Accounting', 'Finance'], projectIds: [], active: true,
  version: '3', confirmed: false, firstSignedInAt: null, messageStatus: 'not_sent' };

test('account inputs validate roles, versions and assignments without trusting extra authority', () => {
  const input = { type: 'invite', requestId, draft, actor: { role: 'Administrator' } };
  assert.deepEqual(parseAccountCommand(input), { type: 'invite', requestId, draft: { ...draft, name: 'Staff', email: 'staff@example.invalid' } });
  for (const change of [{ roles: [] }, { roles: ['owner'] }, { roles: ['Site Personnel', 'Accounting'] }, { roles: ['Finance', 'Finance'] },
    { projectIds: [id] }, { roles: ['Site Personnel'], projectIds: [id, id] }, { name: ' ' }]) assert.equal(parseAccountCommand({ ...input, draft: { ...draft, ...change } }), null);
  assert.ok(parseAccountCommand({ ...input, draft: { ...draft, roles: ['Site Personnel'], projectIds: [] } }));
  assert.equal(parseAccountCommand({ type: 'save', requestId, id, version: 3, draft }), null);
  assert.equal(parseDirectory({ users: [account], projects: [{ id, name: 'Project' }], history: [] }).users[0].id, id);
  assert.equal(parseDirectory({ users: [{ ...account, roles: ['Site Personnel', 'Administrator'] }], projects: [], history: [] }), null);
});

test('provisioning reconciles a timed-out create by UUID and trusted marker; disabled email saves pending', async () => {
  const calls = []; let identity = null, creates = 0;
  const gateway = {
    emailEnabled: false,
    rpc: async (name, params) => { calls.push([name, params]); return name === 'account_reserve' ? { id, state: 'reserved' } : account; },
    identity: async queried => { assert.equal(queried, id); return identity; },
    create: async (target, email, operation) => { creates++; identity = { id: target, email, marker: operation }; throw Error('Response lost after successful create'); },
    send: async () => { throw Error('Disabled email must not send'); },
  };
  const command = parseAccountCommand({ type: 'invite', requestId, draft });
  assert.equal((await executeAccountCommand(command, actor, gateway)).ok, true);
  assert.equal(creates, 1);
  assert.deepEqual(calls.map(c => c[0]), ['account_reserve', 'account_complete']);
  await executeAccountCommand(command, actor, gateway);
  assert.equal(creates, 1, 'Retry reuses the owned identity');
  identity.marker = randomUUID();
  await assert.rejects(executeAccountCommand(command, actor, gateway), /could not be verified/);
});

test('message retry never repeats accepted or uncertain dispatch; starting recovery does not revoke sessions', async () => {
  let sends = 0; let state = null; const calls = [];
  const gateway = {
    emailEnabled: true, identity: async () => null, create: async () => {},
    send: async () => { sends++; throw Error('Network timeout'); },
    rpc: async (name, input) => {
      calls.push(name); assert.equal(name, 'account_message');
      if (input.outcome) { state = input.outcome; return { state }; }
      if (state) return { dispatch: false, state };
      state = 'sending'; return { dispatch: true, state, email: account.email };
    },
  };
  const command = { type: 'message', id, version: '3', kind: 'recovery', requestId };
  assert.equal((await executeAccountCommand(command, actor, gateway)).ok, false);
  assert.equal(state, 'uncertain');
  assert.equal((await executeAccountCommand(command, actor, gateway)).ok, false);
  assert.equal(sends, 1);
  state = 'accepted';
  assert.equal((await executeAccountCommand(command, actor, gateway)).ok, true);
  assert.equal(sends, 1);
  assert.ok(calls.every(name => name === 'account_message'));
});
