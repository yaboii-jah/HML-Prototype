import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOperationalStorage, EMPTY_WORKSPACE_MARKER } from '../src/mock/workspace-initialization.ts';
import { LocalUserDirectory, USER_STORAGE_KEY } from '../src/app-state/user-directory.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { blankWorkspace } from '../src/mock/blank-workspace.ts';
import { seedDemo } from './fixtures/workspace.ts';
import { applyCommand } from '../src/domain/commands.ts';

const currentKey = 'hml-constructsync-demo-v12';
function memoryStorage(entries = []) {
  const values = new Map(entries);
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const initialStorage = memoryStorage();
await new LocalUserDirectory(() => initialStorage).load();
const accounts = initialStorage.getItem(USER_STORAGE_KEY);

test('cleanup clears all operational records, drafts, documents and backups while preserving account details', async () => {
  const directory = JSON.parse(accounts), at = '2026-10-01T00:00:00Z';
  directory.users.find(user => user.role === 'Site Personnel').siteIds = ['sample-project', 'manual-project'];
  directory.users.push({ ...structuredClone(directory.users[0]), id: 'manual-person', name: 'Actual user', email: 'actual@example.test', active: false, siteIds: ['manual-project'] });
  directory.activity.push({ id: 'account-history', action: 'User added', at });
  const storage = memoryStorage([
    [currentKey, JSON.stringify(seedDemo())], [USER_STORAGE_KEY, JSON.stringify(directory)],
    ['hml-buildsync-demo-v1', 'old data'], ['hml-constructsync-demo-v11', 'old data'],
    ['constructsync-usage-draft-v1/person/project', 'usage draft'], ['constructsync-stock-draft-v1/person/request', 'stock draft'],
    ['hml-constructsync-showcase-installed-v1', 'old install'], ['hml-constructsync-showcase-installing-v1', 'interrupted install'],
    [SESSION_STORAGE_KEY, 'old session'], ['hml-constructsync-demo-session-v1', 'legacy session'], ['theme', 'dark'],
  ]);
  let files = ['generated-pdf', 'manual-upload'], backups = ['old-install-backup'];
  await clearOperationalStorage({ storage, clearFiles: async () => { files = []; }, clearBackups: async () => { backups = []; } });
  assert.deepEqual(JSON.parse(storage.getItem(currentKey)), blankWorkspace());
  assert.deepEqual(files, []); assert.deepEqual(backups, []);
  const saved = JSON.parse(storage.getItem(USER_STORAGE_KEY));
  assert.deepEqual(saved.activity, directory.activity); assert.equal(saved.users.length, directory.users.length);
  for (const user of saved.users) {
    const before = directory.users.find(value => value.id === user.id);
    assert.deepEqual(user.credential, before.credential);
    for (const key of ['id', 'name', 'email', 'role', 'active', 'createdAt']) assert.equal(user[key], before[key]);
    assert.equal(user.siteIds?.length || 0, 0);
    assert.equal(user.revision, before.revision + (before.siteIds?.length ? 1 : 0));
  }
  assert.equal(storage.getItem(EMPTY_WORKSPACE_MARKER), '1'); assert.equal(storage.getItem('theme'), 'dark');
  for (const key of ['hml-buildsync-demo-v1', 'hml-constructsync-demo-v11', 'constructsync-usage-draft-v1/person/project', 'constructsync-stock-draft-v1/person/request', 'hml-constructsync-showcase-installed-v1', 'hml-constructsync-showcase-installing-v1', SESSION_STORAGE_KEY, 'hml-constructsync-demo-session-v1']) assert.equal(storage.getItem(key), null);
});

test('fresh startup is empty and later initialization preserves newly created work without clearing again', async () => {
  const storage = memoryStorage([[USER_STORAGE_KEY, accounts]]); let clears = 0;
  const options = { storage, clearFiles: async () => { clears++; }, clearBackups: async () => { clears++; } };
  await clearOperationalStorage(options);
  assert.deepEqual(JSON.parse(storage.getItem(currentKey)), blankWorkspace());
  const result = applyCommand({ ...blankWorkspace(), role: 'Administrator' }, { type: 'addSite', documentCode: 'ACTUAL', name: 'Actual project', location: 'Manila', budget: 1000 });
  assert.equal(result.ok, true, result.message); assert.equal(result.snapshot.sites[0].localArchiveId, undefined);
  assert.deepEqual(result.snapshot.sites[0].driveFolderSetup, { status: 'pending' });
  storage.setItem(currentKey, JSON.stringify(result.snapshot)); storage.setItem(SESSION_STORAGE_KEY, 'new-session');
  await clearOperationalStorage(options);
  assert.deepEqual(JSON.parse(storage.getItem(currentKey)), JSON.parse(JSON.stringify(result.snapshot)));
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), 'new-session'); assert.equal(clears, 2);
  assert.equal(storage.getItem(USER_STORAGE_KEY), accounts);
});

test('new projects never inherit a browser archive from legacy demo metadata', () => {
  const result = applyCommand({ ...blankWorkspace(), role: 'Administrator', showcase: { installationId: 'old-demo-install', revision: 1, seededAt: '2026-10-01T00:00:00Z' } }, { type: 'addSite', documentCode: 'DRIVE', name: 'Drive project', location: 'Pasig', budget: 1000 });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.snapshot.sites[0].localArchiveId, undefined);
  assert.deepEqual(result.snapshot.sites[0].driveFolderSetup, { status: 'pending' });
});

test('failed document or backup cleanup stays incomplete and can finish on retry', async () => {
  for (const stage of ['files', 'backups', 'marker']) {
    const storage = memoryStorage([[USER_STORAGE_KEY, accounts], [currentKey, JSON.stringify(seedDemo())]]);
    let fail = true;
    const setItem = storage.setItem;
    storage.setItem = (key, value) => { if (key === EMPTY_WORKSPACE_MARKER && fail && stage === 'marker') throw new Error('marker unavailable'); setItem(key, value); };
    const options = { storage, clearFiles: async () => { if (fail && stage === 'files') throw new Error('files unavailable'); }, clearBackups: async () => { if (fail && stage === 'backups') throw new Error('backups unavailable'); } };
    await assert.rejects(clearOperationalStorage(options), /unavailable/);
    assert.equal(storage.getItem(EMPTY_WORKSPACE_MARKER), null);
    assert.equal(storage.getItem(USER_STORAGE_KEY), accounts);
    fail = false; await clearOperationalStorage(options);
    assert.equal(storage.getItem(EMPTY_WORKSPACE_MARKER), '1');
    assert.deepEqual(JSON.parse(storage.getItem(currentKey)), blankWorkspace());
  }
});

test('repository blocks reads and commands during cleanup, then retries without exposing partial state', async t => {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage };
  t.after(() => { globalThis.window = previous.window; globalThis.localStorage = previous.localStorage; });
  const storage = memoryStorage([[currentKey, JSON.stringify(seedDemo())], [USER_STORAGE_KEY, accounts]]);
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = storage;
  let fail = true, unblock;
  const repository = new LocalDemoRepository(async () => {
    await new Promise(resolve => { unblock = resolve; });
    await clearOperationalStorage({ storage, clearFiles: async () => { if (fail) throw new Error('cleanup interrupted'); }, clearBackups: async () => {} });
  });
  const loading = repository.load();
  assert.equal(repository.getSnapshot().status, 'loading'); assert.equal(repository.getSnapshot().snapshot, null);
  assert.equal((await repository.execute({ type: 'setRole', role: 'Administrator' })).ok, false);
  unblock(); assert.equal((await loading).status, 'setup-error');
  assert.equal(repository.getSnapshot().snapshot, null); assert.equal(storage.getItem(EMPTY_WORKSPACE_MARKER), null);
  fail = false; const retry = repository.retrySetup(); unblock();
  assert.equal((await retry).status, 'ready');
  assert.deepEqual(repository.getSnapshot().snapshot, blankWorkspace());
  const reopened = await new LocalDemoRepository().load(); assert.equal(reopened.status, 'ready'); assert.deepEqual(reopened.snapshot, blankWorkspace());
});

test('unreadable account storage blocks cleanup without replacing accounts or touching files', async () => {
  const storage = memoryStorage([[USER_STORAGE_KEY, '{broken'], [currentKey, 'old records']]); let cleared = false;
  await assert.rejects(clearOperationalStorage({ storage, clearFiles: async () => { cleared = true; }, clearBackups: async () => {} }));
  assert.equal(cleared, false); assert.equal(storage.getItem(USER_STORAGE_KEY), '{broken');
  assert.equal(storage.getItem(currentKey), 'old records'); assert.equal(storage.getItem(EMPTY_WORKSPACE_MARKER), null);
});

test('manual clearing repeats after initialization while retaining the Administrator session, credentials and account history', async () => {
  const directory = JSON.parse(accounts);
  directory.users.find(user => user.role === 'Site Personnel').siteIds = ['site-a'];
  directory.activity.push({ id: 'kept-history', action: 'User added' });
  const session = JSON.stringify({ email: directory.users.find(user => user.role === 'Administrator').email, role: 'Administrator' });
  const storage = memoryStorage([[EMPTY_WORKSPACE_MARKER, '1'], [USER_STORAGE_KEY, JSON.stringify(directory)], [SESSION_STORAGE_KEY, session], ['constructsync-theme', 'dark']]);
  let files = ['document'], backups = ['backup'];
  const options = { storage, force: true, preserveSession: true, role: 'Administrator', clearFiles: async () => { files = []; }, clearBackups: async () => { backups = []; } };
  for (let attempt = 0; attempt < 2; attempt++) {
    storage.setItem(currentKey, JSON.stringify(seedDemo()));
    storage.setItem('constructsync-stock-draft-v1/user/request', 'draft');
    storage.setItem('constructsync-usage-draft-v1/user/site', 'draft');
    await clearOperationalStorage(options);
    assert.deepEqual(JSON.parse(storage.getItem(currentKey)), { ...blankWorkspace(), role: 'Administrator' });
    assert.equal(storage.getItem(SESSION_STORAGE_KEY), session);
    assert.equal(storage.getItem('constructsync-theme'), 'dark');
    assert.equal(storage.getItem('constructsync-stock-draft-v1/user/request'), null);
    assert.equal(storage.getItem('constructsync-usage-draft-v1/user/site'), null);
    const saved = JSON.parse(storage.getItem(USER_STORAGE_KEY));
    assert.deepEqual(saved.activity, directory.activity);
    assert.deepEqual(saved.users.map(user => user.credential), directory.users.map(user => user.credential));
    assert.ok(saved.users.every(user => !user.siteIds?.length));
    assert.deepEqual(files, []); assert.deepEqual(backups, []);
  }
});

test('repository rejects overlapping writes and reports file-cleanup failure, then supports retry', async t => {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage, indexedDB: globalThis.indexedDB };
  t.after(() => { Object.assign(globalThis, previous); });
  const initial = { ...seedDemo(), role: 'Administrator' };
  const storage = memoryStorage([[EMPTY_WORKSPACE_MARKER, '1'], [USER_STORAGE_KEY, accounts], [currentKey, JSON.stringify(initial)]]);
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = storage;
  let failOpen;
  globalThis.indexedDB = { open() { const request = {}; failOpen = () => { request.error = new Error('Document storage unavailable'); request.onerror(); }; return request; } };
  const repository = new LocalDemoRepository(); await repository.load();
  const pending = repository.reset();
  assert.equal(repository.reset(), pending);
  assert.equal((await repository.execute({ type: 'setRole', role: 'Finance' })).ok, false);
  failOpen(); await assert.rejects(pending, /Document storage unavailable/);
  assert.deepEqual(repository.getSnapshot().snapshot, JSON.parse(JSON.stringify(initial)));
  assert.equal(storage.getItem(USER_STORAGE_KEY), accounts);
  globalThis.indexedDB = undefined;
  assert.equal((await repository.reset()).status, 'ready');
  assert.deepEqual(repository.getSnapshot().snapshot, { ...blankWorkspace(), role: 'Administrator' });
  assert.equal(storage.getItem(USER_STORAGE_KEY), accounts);
});

test('manual cleanup exposes storage-write failures and can be retried without losing accounts', async () => {
  const storage = memoryStorage([[EMPTY_WORKSPACE_MARKER, '1'], [USER_STORAGE_KEY, accounts], [currentKey, JSON.stringify(seedDemo())]]);
  const write = storage.setItem;
  storage.setItem = (key, value) => { if (key === currentKey) throw new Error('Workspace storage unavailable'); write(key, value); };
  const options = { storage, force: true, preserveSession: true, role: 'Administrator', clearFiles: async () => {}, clearBackups: async () => {} };
  await assert.rejects(clearOperationalStorage(options), /Workspace storage unavailable/);
  assert.equal(storage.getItem(USER_STORAGE_KEY), accounts);
  storage.setItem = write;
  await clearOperationalStorage(options);
  assert.deepEqual(JSON.parse(storage.getItem(currentKey)), { ...blankWorkspace(), role: 'Administrator' });
});
