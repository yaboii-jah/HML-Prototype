import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOperationalStorage, EMPTY_WORKSPACE_MARKER } from '../src/mock/workspace-initialization.ts';
import { LocalUserDirectory, USER_STORAGE_KEY } from '../src/app-state/user-directory.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
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
