import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalUserDirectory, USER_STORAGE_KEY } from '../src/app-state/user-directory.ts';
import { LocalDemoSession, ACCOUNT_FIXTURES, SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { bindAccountCommands } from '../src/app-state/command-gateway.ts';
import { validIdentity } from '../src/domain/audit.ts';

async function setup() {
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const directory = new LocalUserDirectory(() => storage); await directory.load();
  const admin = directory.getSnapshot().users.find(user => user.role === 'Administrator');
  const actor = user => ({ name: user.name, email: user.email, role: user.role, userId: user.id, sessionRevision: user.revision });
  return { saved, storage, directory, admin, actor, current: id => directory.getSnapshot().users.find(user => user.id === id) };
}

test('bootstrap accounts have salted hashes, support normalized sign-in and are not reseeded', async () => {
  const { saved, storage, directory } = await setup();
  assert.equal(directory.getSnapshot().users.length, 7);
  const raw = saved.get(USER_STORAGE_KEY), stored = JSON.parse(raw);
  assert.equal(new Set(stored.users.map(user => user.credential.salt)).size, 7);
  assert.equal(JSON.stringify(directory.getSnapshot()).includes('credential'), false);
  for (const account of ACCOUNT_FIXTURES) {
    assert.equal(raw.includes(account.password), false);
    assert.equal((await directory.authenticate(' ' + account.email.toUpperCase() + ' ', account.password)).role, account.role);
  }
  assert.equal(await directory.authenticate(ACCOUNT_FIXTURES[0].email, 'incorrect'), null);
  const reopened = new LocalUserDirectory(() => storage); await reopened.load();
  assert.equal(saved.get(USER_STORAGE_KEY), raw);
});

test('administrators manage named users with unique emails, password replacement and preserved history', async () => {
  const { saved, directory, admin, actor, current } = await setup();
  const pm = directory.getSnapshot().users.find(user => user.role === 'Project Manager');
  const add = { type: 'add', name: ' Second manager ', email: ' SECOND@EXAMPLE.COM ', role: 'Project Manager', password: 'Initial123!' };
  assert.equal((await directory.change(actor(pm), add)).ok, false);
  assert.equal((await directory.change(actor(admin), { ...add, password: 'short' })).ok, false);
  assert.equal((await directory.change(actor(admin), add)).ok, true);
  const user = directory.getSnapshot().users.find(user => user.email === 'second@example.com');
  assert.equal(user.name, 'Second manager');
  assert.equal((await directory.change(actor(admin), add)).ok, false);
  assert.equal((await directory.authenticate(user.email, add.password)).id, user.id);
  assert.equal((await directory.change(actor(admin), { type: 'edit', id: user.id, revision: user.revision, name: 'Renamed manager', email: 'new@example.com', role: 'Procurement' })).ok, true);
  assert.equal(await directory.authenticate(user.email, add.password), null);
  assert.equal((await directory.change(actor(admin), { type: 'password', id: user.id, revision: current(user.id).revision, password: 'Replacement123!' })).ok, true);
  assert.equal(await directory.authenticate('new@example.com', add.password), null);
  assert.equal((await directory.authenticate('new@example.com', 'Replacement123!')).role, 'Procurement');
  assert.equal((await directory.change(actor(admin), { type: 'status', id: user.id, revision: current(user.id).revision, active: false })).ok, true);
  assert.equal(await directory.authenticate('new@example.com', 'Replacement123!'), null);
  assert.equal((await directory.change(actor(admin), { type: 'status', id: user.id, revision: current(user.id).revision, active: true })).ok, true);
  assert.ok(await directory.authenticate('new@example.com', 'Replacement123!'));
  assert.equal(directory.getSnapshot().users.length, 8);
  assert.equal(directory.getSnapshot().activity.length, 5);
  assert.equal(directory.getSnapshot().activity.at(-1).entityRef, 'Second manager / second@example.com');
  for (const secret of ['Initial123!', 'Replacement123!']) assert.equal(saved.get(USER_STORAGE_KEY).includes(secret), false);
});

test('last Administrator, self-deactivation and stale account edits are blocked atomically', async () => {
  const { saved, directory, admin, actor } = await setup(); const before = saved.get(USER_STORAGE_KEY);
  for (const input of [{ type: 'status', id: admin.id, revision: 1, active: false }, { type: 'edit', id: admin.id, revision: 1, name: admin.name, email: admin.email, role: 'Project Manager' }, { type: 'password', id: admin.id, revision: 9, password: 'NewPassword123!' }]) {
    assert.equal((await directory.change(actor(admin), input)).ok, false); assert.equal(saved.get(USER_STORAGE_KEY), before);
  }
});

test('directory changes invalidate sessions and captured commands; presenter switching uses specific active accounts', async () => {
  const { directory, admin, actor, storage, current } = await setup();
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = storage;
  try {
    const user = directory.getSnapshot().users.find(user => user.role === 'Project Manager');
    const session = new LocalDemoSession(directory); session.select({ email: user.email, role: user.role, userId: user.id, revision: user.revision });
    const repository = new LocalDemoRepository(); await repository.load();
    const active = () => { const view = session.read(), account = current(view.userId); return view.role && account ? actor(account) : undefined; };
    const gateway = bindAccountCommands(repository, active(), active);
    await directory.change(actor(admin), { type: 'password', id: user.id, revision: 1, password: 'ResetPassword123!' });
    assert.equal(session.read().role, null); assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
    assert.equal((await gateway.run({ type: 'addSite', name: 'Stale project', location: 'Pasig', budget: 1 })).ok, false);
    session.select({ email: user.email, role: user.role, userId: user.id, revision: current(user.id).revision }); assert.equal(session.switchAccount(admin.id), true);
    await directory.change(actor(admin), { type: 'status', id: user.id, revision: current(user.id).revision, active: false });
    assert.equal(session.switchAccount(user.id), false);
    const raw = JSON.parse(storage.getItem(USER_STORAGE_KEY)); raw.users.find(value => value.id === admin.id).revision++;
    storage.setItem(USER_STORAGE_KEY, JSON.stringify(raw)); directory.refresh();
    assert.equal(session.read().role, null, 'Other-tab revisions end the current session');
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

test('workspace reset preserves users and retired Management history without reactivating its session', async () => {
  const { directory, saved, storage } = await setup(), priorWindow = globalThis.window, priorStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = storage;
  try {
    const state = seedDemo(); state.role = 'Management';
    state.activity.push({ id: 'retired', entity: state.sites[0].id, actor: 'Management', actorIdentity: { name: 'Historical manager', email: 'old@example.com', role: 'Management' }, action: 'Historical oversight', at: '2026-09-01T00:00:00Z' });
    storage.setItem('hml-constructsync-demo-v12', JSON.stringify(state));
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ email: 'hml.constructsync.management@gmail.com', role: 'Management' }));
    assert.equal(new LocalDemoSession(directory).read().role, null);
    const repository = new LocalDemoRepository(), view = await repository.load();
    assert.equal(view.status, 'ready'); assert.equal(view.snapshot.role, 'Project Manager');
    assert.deepEqual(view.snapshot.activity, state.activity); assert.deepEqual(view.snapshot.requests, state.requests);
    assert.equal(validIdentity(state.activity.at(-1).actorIdentity), true);
    const accounts = saved.get(USER_STORAGE_KEY); await repository.reset(); assert.equal(saved.get(USER_STORAGE_KEY), accounts);
  } finally { globalThis.window = priorWindow; globalThis.localStorage = priorStorage; }
});

test('Project Manager can create, edit, map and allocate projects while other departments cannot', () => {
  let state = { ...blankWorkspace(), role: 'Project Manager' };
  for (const command of [{ type: 'addSite', name: 'PM project', location: 'Pasig', budget: 10000 }]) {
    const result = applyCommand(state, command); assert.equal(result.ok, true, result.message); state = result.snapshot;
  }
  const id = state.sites[0].id;
  const commands = [{ type: 'updateSite', siteId: id, name: 'Updated', location: 'Manila', budget: 12000 }, { type: 'setProjectDriveFolder', siteId: id, folderId: 'folder-pm' }, { type: 'saveProjectScope', siteId: id, name: 'Structural', budget: 5000 }];
  for (const command of commands) {
    assert.equal(applyCommand({ ...state, role: 'Finance' }, command).ok, false);
    const result = applyCommand(state, command); assert.equal(result.ok, true, result.message); state = result.snapshot;
  }
});

test('unreadable account storage is preserved and cannot silently bootstrap replacement users', async () => {
  const raw = '{broken', saved = new Map([[USER_STORAGE_KEY, raw]]);
  const directory = new LocalUserDirectory(() => ({ getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) }));
  await directory.load(); assert.equal(directory.getSnapshot().status, 'recovery'); assert.equal(saved.get(USER_STORAGE_KEY), raw);
  assert.equal(await directory.authenticate(ACCOUNT_FIXTURES[0].email, ACCOUNT_FIXTURES[0].password), null);
});
