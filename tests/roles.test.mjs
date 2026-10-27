import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../src/domain/types.ts';
import { ACCOUNT_FIXTURES, LocalDemoSession, SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { blankWorkspace } from '../src/mock/blank-workspace.ts';
import { seedDemo } from './fixtures/workspace.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { bindAccountCommands } from '../src/app-state/command-gateway.ts';

import { LocalUserDirectory } from '../src/app-state/user-directory.ts';
let testDirectory;
const workspaceKey = 'hml-constructsync-demo-v12';
const legacySessionKey = 'hml-constructsync-demo-session-v1';
async function withStorage(entries, check) {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  const saved = new Map(entries);
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = initializedWorkspaceStorage({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) });
  try { testDirectory = new LocalUserDirectory(); await testDirectory.load(); await check(saved); }
  finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
}

test('seven active roles can sign in while removed assignment commands remain rejected', () => {
  assert.deepEqual(ROLES, ['Site Personnel', 'Project Manager', 'Procurement', 'Finance', 'Logistics', 'Accounting', 'Administrator']);
  assert.deepEqual(ACCOUNT_FIXTURES.map(account => account.role), ROLES);
  const state = blankWorkspace(), original = structuredClone(state);
  const result = applyCommand(state, { type: 'setRole', role: 'Unknown role' });
  assert.equal(result.ok, false); assert.match(result.message, /Unknown role/); assert.deepEqual(state, original);
  const retiredAssignment = applyCommand({ ...seedDemo(), role: 'Administrator' }, { type: 'updateAssignment', siteId: 'site-a', manager: 'New manager' });
  assert.equal(retiredAssignment.ok, false); assert.match(retiredAssignment.message, /Unknown command/);
});

test('project creation requires name, document code, location and budget', () => {
  const state = { ...blankWorkspace(), role: 'Administrator' };
  const result = applyCommand(state, { type: 'addSite', documentCode: 'CLIENT-PROJECT', name: 'Client project', location: 'Pasig', budget: 10000 });
  assert.equal(result.ok, true, result.message);
  const site = result.snapshot.sites[0];
  assert.equal(site.name, 'Client project'); assert.equal(site.budget, 10000); assert.equal(Object.hasOwn(site, 'manager'), false);
  for (const patch of [{ name: '' }, { location: '' }, { budget: -1 }]) assert.equal(applyCommand(state, { type: 'addSite', documentCode: 'CLIENT-PROJECT', name: 'Client project', location: 'Pasig', budget: 10000, ...patch }).ok, false);
});

test('old role-only sessions require sign-in and preserve workspace records', async () => {
  const workspace = JSON.stringify(seedDemo());
  for (const role of ['Project Manager', 'Procurement']) await withStorage([[legacySessionKey, role], [workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession(testDirectory);
    assert.deepEqual(session.read(), { email: null, role: null, status: 'ready' });
    assert.equal(saved.has(legacySessionKey), false); assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('account sessions survive reopening and sign-out preserves all workspace data', async () => {
  const workspace = JSON.stringify(seedDemo()), account = ACCOUNT_FIXTURES[0];
  await withStorage([[workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession(testDirectory); session.select(account);
    assert.deepEqual(JSON.parse(saved.get(SESSION_STORAGE_KEY)), { email: account.email, role: account.role, userId: testDirectory.getSnapshot().users.find(user => user.email === account.email).id, revision: 1 });
    assert.equal(saved.get(SESSION_STORAGE_KEY).includes(account.password), false);
    assert.deepEqual(new LocalDemoSession(testDirectory).read(), { email: account.email, role: account.role, userId: testDirectory.getSnapshot().users.find(user => user.email === account.email).id, revision: 1, status: 'ready' });
    session.clear(); assert.equal(saved.has(SESSION_STORAGE_KEY), false);
    assert.deepEqual(new LocalDemoSession(testDirectory).read(), { email: null, role: null, status: 'ready' });
    assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('malformed, unknown and mismatched account sessions require sign-in', async () => {
  const workspace = JSON.stringify(seedDemo());
  for (const raw of ['not-json', 'null', JSON.stringify('Procurement'), JSON.stringify({ role: 'Project Manager' }), JSON.stringify({ email: ACCOUNT_FIXTURES[0].email, role: 'Finance' }), JSON.stringify({ email: 'unknown@gmail.com', role: 'Site Personnel' })]) await withStorage([[SESSION_STORAGE_KEY, raw], [workspaceKey, workspace]], saved => {
    assert.equal(new LocalDemoSession(testDirectory).read().role, null);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false); assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('department switching needs a signed-in account and remembers the full identity without altering records', async () => {
  const workspace = JSON.stringify(seedDemo());
  await withStorage([[workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession(testDirectory);
    assert.equal(session.switchRole('Administrator'), false);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false);
    session.select(ACCOUNT_FIXTURES[0]);
    for (const account of ACCOUNT_FIXTURES) {
      assert.equal(session.switchRole(account.role), true);
      assert.deepEqual(new LocalDemoSession(testDirectory).read(), { email: account.email, role: account.role, userId: testDirectory.getSnapshot().users.find(user => user.email === account.email).id, revision: 1, status: 'ready' });
      assert.deepEqual(JSON.parse(saved.get(SESSION_STORAGE_KEY)), { email: account.email, role: account.role, userId: testDirectory.getSnapshot().users.find(user => user.email === account.email).id, revision: 1 });
      assert.equal(saved.get(workspaceKey), workspace);
    }
    const before = session.read();
    assert.equal(session.switchRole('Unknown role'), false);
    assert.deepEqual(session.read(), before);
    session.clear();
    assert.equal(session.switchRole('Procurement'), false);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false);
  });
});

test('department switches change new audit actors and reject commands captured by the previous account', async () => {
  const initial = { ...seedDemo(), role: 'Procurement' };
  await withStorage([[workspaceKey, JSON.stringify(initial)]], async () => {
    const repository = new LocalDemoRepository(), session = new LocalDemoSession(testDirectory);
    session.select(ACCOUNT_FIXTURES.find(account => account.role === 'Procurement'));
    const active = () => {
      const account = ACCOUNT_FIXTURES.find(value => value.email === session.read().email);
      return account ? { name: account.name, email: account.email, role: account.role } : undefined;
    };
    const procurement = bindAccountCommands(repository, active(), active);
    assert.equal((await procurement.run({ type: 'reviewRequest', id: 'm6', decision: 'return', reason: 'Confirm quantities' })).ok, true);
    const originalEvent = structuredClone(repository.getSnapshot().snapshot.activity[0]);
    assert.equal(originalEvent.actorIdentity.name, 'Andrea Reyes');
    assert.equal(session.switchRole('Administrator'), true);
    assert.equal((await repository.execute({ type: 'setRole', role: session.read().role })).ok, true);
    const beforeStale = structuredClone(repository.getSnapshot().snapshot);
    assert.equal((await procurement.run({ type: 'reviewRequest', id: 'm6', decision: 'approve' })).ok, false);
    assert.deepEqual(repository.getSnapshot().snapshot, beforeStale);
    const admin = bindAccountCommands(repository, active(), active);
    assert.equal((await admin.run({ type: 'addSite', documentCode: 'NEW-PROJECT', name: 'New project', location: 'Pasig', budget: 1000 })).ok, true);
    assert.equal(repository.getSnapshot().snapshot.activity[0].actorIdentity.name, 'Daniel Garcia');
    assert.deepEqual(repository.getSnapshot().snapshot.activity.find(event => event.id === originalEvent.id), originalEvent);
    session.clear();
    assert.equal((await admin.run({ type: 'addSite', documentCode: 'SIGNED-OUT-PROJECT', name: 'Signed-out project', location: 'Pasig', budget: 1000 })).ok, false);
  });
});

test('v12 PM selection loads in memory and preserves transactions, old assignments and audit actors', async () => {
  const state = seedDemo(); state.role = 'Project Manager';
  state.sites[0].manager = 'Historical manager';
  state.activity.push({ id: 'past-review', entity: state.requests[0].id, at: '2026-09-01T09:00:00.000Z', actor: 'Project Manager', action: 'Historical review' });
  const raw = JSON.stringify(state);
  await withStorage([[workspaceKey, raw]], async saved => {
    const repository = new LocalDemoRepository(), view = await repository.load();
    assert.equal(view.status, 'ready');
    assert.deepEqual(view.snapshot, JSON.parse(raw));
    assert.equal(saved.get(workspaceKey), raw, 'Loading must not rewrite stored records');
    const result = await repository.execute({ type: 'setRole', role: 'Accounting' });
    assert.equal(result.ok, true);
    const persisted = JSON.parse(saved.get(workspaceKey));
    assert.deepEqual(persisted, { ...JSON.parse(raw), role: 'Accounting' });
    assert.equal((await new LocalDemoRepository().load()).status, 'ready');
    saved.set(workspaceKey, JSON.stringify({ ...state, role: 'Unknown role' }));
    assert.equal((await new LocalDemoRepository().load()).status, 'recovery');
  });
});

test('previous-workflow PM records still require explicit manual clearing', async () => {
  const raw = JSON.stringify({ ...seedDemo(), version: 11, role: 'Project Manager' });
  await withStorage([['hml-constructsync-demo-v11', raw]], async saved => {
    assert.equal((await new LocalDemoRepository().load()).status, 'recovery');
    assert.equal(saved.get('hml-constructsync-demo-v11'), raw); assert.equal(saved.has(workspaceKey), false);
  });
});
