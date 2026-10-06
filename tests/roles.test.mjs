import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../src/domain/types.ts';
import { ACCOUNT_FIXTURES, accountForCredentials, LocalDemoSession, SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { bindAccountCommands } from '../src/app-state/command-gateway.ts';

const workspaceKey = 'hml-constructsync-demo-v12';
const legacySessionKey = 'hml-constructsync-demo-session-v1';
async function withStorage(entries, check) {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  const saved = new Map(entries);
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  try { await check(saved); }
  finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
}

test('seven active roles can sign in and Project Manager credentials and commands are rejected', () => {
  assert.deepEqual(ROLES, ['Site Personnel', 'Procurement', 'Finance', 'Logistics', 'Accounting / Auditing', 'Management', 'Administrator']);
  assert.deepEqual(ACCOUNT_FIXTURES.map(account => account.role), ROLES);
  for (const account of ACCOUNT_FIXTURES) assert.equal(accountForCredentials(account.email, account.password)?.role, account.role);
  assert.equal(accountForCredentials('pm@constructsync.example', 'Demo123!'), null);
  const state = blankWorkspace(), original = structuredClone(state);
  const result = applyCommand(state, { type: 'setRole', role: 'Project Manager' });
  assert.equal(result.ok, false); assert.match(result.message, /Unknown role/); assert.deepEqual(state, original);
  const retiredAssignment = applyCommand({ ...seedDemo(), role: 'Administrator' }, { type: 'updateAssignment', siteId: 'site-a', manager: 'New manager' });
  assert.equal(retiredAssignment.ok, false); assert.match(retiredAssignment.message, /Unknown command/);
});

test('project creation needs only name, location and budget', () => {
  const state = { ...blankWorkspace(), role: 'Administrator' };
  const result = applyCommand(state, { type: 'addSite', name: 'Client project', location: 'Pasig', budget: 10000 });
  assert.equal(result.ok, true, result.message);
  const site = result.snapshot.sites[0];
  assert.equal(site.name, 'Client project'); assert.equal(site.budget, 10000); assert.equal(Object.hasOwn(site, 'manager'), false);
  for (const patch of [{ name: '' }, { location: '' }, { budget: -1 }]) assert.equal(applyCommand(state, { type: 'addSite', name: 'Client project', location: 'Pasig', budget: 10000, ...patch }).ok, false);
});

test('old role-only sessions require sign-in and preserve workspace records', async () => {
  const workspace = JSON.stringify(seedDemo());
  for (const role of ['Project Manager', 'Procurement']) await withStorage([[legacySessionKey, role], [workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession();
    assert.deepEqual(session.read(), { email: null, role: null, status: 'ready' });
    assert.equal(saved.has(legacySessionKey), false); assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('each account has its own password and emails normalize without changing passwords', () => {
  assert.equal(new Set(ACCOUNT_FIXTURES.map(account => account.password)).size, 7);
  for (const account of ACCOUNT_FIXTURES) {
    assert.deepEqual(accountForCredentials('  ' + account.email.toUpperCase() + '  ', account.password), { email: account.email, role: account.role });
    for (const other of ACCOUNT_FIXTURES.filter(value => value !== account)) assert.equal(accountForCredentials(account.email, other.password), null);
    for (const password of ['Demo123!', 'incorrect', account.password + ' ']) assert.equal(accountForCredentials(account.email, password), null);
  }
  assert.equal(accountForCredentials('unknown@gmail.com', ACCOUNT_FIXTURES[0].password), null);
});

test('account sessions survive reopening and sign-out preserves all workspace data', async () => {
  const workspace = JSON.stringify(seedDemo()), account = ACCOUNT_FIXTURES[0];
  await withStorage([[workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession(); session.select(account);
    assert.deepEqual(JSON.parse(saved.get(SESSION_STORAGE_KEY)), { email: account.email, role: account.role });
    assert.equal(saved.get(SESSION_STORAGE_KEY).includes(account.password), false);
    assert.deepEqual(new LocalDemoSession().read(), { email: account.email, role: account.role, status: 'ready' });
    session.clear(); assert.equal(saved.has(SESSION_STORAGE_KEY), false);
    assert.deepEqual(new LocalDemoSession().read(), { email: null, role: null, status: 'ready' });
    assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('malformed, unknown and mismatched account sessions require sign-in', async () => {
  const workspace = JSON.stringify(seedDemo());
  for (const raw of ['not-json', 'null', JSON.stringify('Procurement'), JSON.stringify({ role: 'Project Manager' }), JSON.stringify({ email: ACCOUNT_FIXTURES[0].email, role: 'Finance' }), JSON.stringify({ email: 'unknown@gmail.com', role: 'Site Personnel' })]) await withStorage([[SESSION_STORAGE_KEY, raw], [workspaceKey, workspace]], saved => {
    assert.equal(new LocalDemoSession().read().role, null);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false); assert.equal(saved.get(workspaceKey), workspace);
  });
});

test('department switching needs a signed-in account and remembers the full identity without altering records', async () => {
  const workspace = JSON.stringify(seedDemo());
  await withStorage([[workspaceKey, workspace]], saved => {
    const session = new LocalDemoSession();
    assert.equal(session.switchRole('Administrator'), false);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false);
    session.select(ACCOUNT_FIXTURES[0]);
    for (const account of ACCOUNT_FIXTURES) {
      assert.equal(session.switchRole(account.role), true);
      assert.deepEqual(new LocalDemoSession().read(), { email: account.email, role: account.role, status: 'ready' });
      assert.deepEqual(JSON.parse(saved.get(SESSION_STORAGE_KEY)), { email: account.email, role: account.role });
      assert.equal(saved.get(workspaceKey), workspace);
    }
    const before = session.read();
    assert.equal(session.switchRole('Project Manager'), false);
    assert.deepEqual(session.read(), before);
    session.clear();
    assert.equal(session.switchRole('Procurement'), false);
    assert.equal(saved.has(SESSION_STORAGE_KEY), false);
  });
});

test('department switches change new audit actors and reject commands captured by the previous account', async () => {
  const initial = { ...seedDemo(), role: 'Procurement' };
  await withStorage([[workspaceKey, JSON.stringify(initial)]], async () => {
    const repository = new LocalDemoRepository(), session = new LocalDemoSession();
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
    assert.equal((await admin.run({ type: 'addSite', name: 'New project', location: 'Pasig', budget: 1000 })).ok, true);
    assert.equal(repository.getSnapshot().snapshot.activity[0].actorIdentity.name, 'Daniel Garcia');
    assert.deepEqual(repository.getSnapshot().snapshot.activity.find(event => event.id === originalEvent.id), originalEvent);
    session.clear();
    assert.equal((await admin.run({ type: 'addSite', name: 'Signed-out project', location: 'Pasig', budget: 1000 })).ok, false);
  });
});

test('unavailable storage supports an in-memory account session and sign-out', () => {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  try {
    const session = new LocalDemoSession(); assert.equal(session.read().status, 'volatile');
    session.select(ACCOUNT_FIXTURES[0]); assert.equal(session.read().role, 'Site Personnel');
    assert.equal(session.read().status, 'volatile');
    assert.equal(session.switchRole('Finance'), true); assert.equal(session.read().email, ACCOUNT_FIXTURES.find(account => account.role === 'Finance').email);
    assert.equal(session.read().status, 'volatile'); session.clear(); assert.equal(session.read().role, null);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

test('v12 PM selection loads in memory and preserves transactions, old assignments and audit actors', async () => {
  const state = seedDemo(); state.role = 'Project Manager';
  state.sites[0].manager = 'Historical manager';
  state.activity.push({ id: 'past-review', entity: state.requests[0].id, at: '2026-09-01T09:00:00.000Z', actor: 'Project Manager', action: 'Historical review' });
  const raw = JSON.stringify(state);
  await withStorage([[workspaceKey, raw]], async saved => {
    const repository = new LocalDemoRepository(), view = await repository.load();
    assert.equal(view.status, 'ready');
    assert.deepEqual(view.snapshot, { ...JSON.parse(raw), role: 'Site Personnel' });
    assert.equal(saved.get(workspaceKey), raw, 'Loading must not rewrite stored records');
    const result = await repository.execute({ type: 'setRole', role: 'Accounting / Auditing' });
    assert.equal(result.ok, true);
    const persisted = JSON.parse(saved.get(workspaceKey));
    assert.deepEqual(persisted, { ...JSON.parse(raw), role: 'Accounting / Auditing' });
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
