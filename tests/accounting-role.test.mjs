import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredRoles } from '../src/app-state/stored-roles.ts';
import { ACCOUNT_FIXTURES, LocalDemoSession, SESSION_STORAGE_KEY } from '../src/app-state/demo-session.ts';
import { LocalUserDirectory, USER_STORAGE_KEY } from '../src/app-state/user-directory.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';
import { seedDemo } from './fixtures/workspace.ts';

const previousRole = 'Accounting / Auditing';
const workspaceKey = 'hml-constructsync-demo-v12';

test('stored department rename changes role fields without rewriting free text or identities', () => {
  const old = {
    role: previousRole,
    actor: previousRole,
    createdBy: previousRole,
    reviewedBy: previousRole,
    releasedBy: previousRole,
    uploadedBy: previousRole,
    aiReviewedBy: previousRole,
    actorIdentity: { name: 'Original accountant', email: 'original@example.com', userId: 'permanent-user', role: previousRole },
    note: previousRole,
    approvedBy: 'Original signatory',
    at: '2026-10-01T10:00:00Z',
  };
  const migrated = normalizeStoredRoles(JSON.stringify(old));
  const expected = { ...old, role: 'Accounting', actor: 'Accounting', createdBy: 'Accounting', reviewedBy: 'Accounting', releasedBy: 'Accounting', uploadedBy: 'Accounting', aiReviewedBy: 'Accounting', actorIdentity: { ...old.actorIdentity, role: 'Accounting' } };
  assert.deepEqual(JSON.parse(migrated), expected);
  assert.equal(normalizeStoredRoles(migrated), migrated);
  const escaped = JSON.stringify({ role: previousRole }).replace('/', '\\u002f');
  assert.equal(JSON.parse(normalizeStoredRoles(escaped)).role, 'Accounting');
  const unchanged = JSON.stringify({ role: 'Unknown role', note: previousRole }, null, 2);
  assert.equal(normalizeStoredRoles(unchanged), unchanged);
});

test('existing account, session and workspace retain access and records after the department rename', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const originalDirectory = new LocalUserDirectory(() => storage);
  await originalDirectory.load();
  const oldDirectory = JSON.parse(saved.get(USER_STORAGE_KEY));
  const account = oldDirectory.users.find(user => user.role === 'Accounting');
  account.role = previousRole;
  account.id = 'retained-person-42';
  const oldIdentity = { name: account.name, email: account.email, userId: account.id, role: previousRole };
  const event = { id: 'old-accounting-event', entity: 'po1', actor: previousRole, actorIdentity: oldIdentity, action: 'PO reviewed', at: '2026-10-01T10:00:00Z' };
  oldDirectory.activity.push(event);
  saved.set(USER_STORAGE_KEY, JSON.stringify(oldDirectory));
  saved.set(SESSION_STORAGE_KEY, JSON.stringify({ email: account.email, userId: account.id, revision: account.revision, role: previousRole }));
  const oldWorkspace = seedDemo();
  oldWorkspace.role = previousRole;
  oldWorkspace.activity.push(structuredClone(event));
  saved.set(workspaceKey, JSON.stringify(oldWorkspace));

  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = storage;
  try {
    const directory = new LocalUserDirectory(() => storage);
    await directory.load();
    assert.equal(directory.getSnapshot().status, 'ready');
    const fixture = ACCOUNT_FIXTURES.find(user => user.role === 'Accounting');
    const authenticated = await directory.authenticate(account.email, fixture.password);
    assert.equal(authenticated.id, account.id);
    assert.equal(authenticated.role, 'Accounting');
    const canonicalEvent = { ...event, actor: 'Accounting', actorIdentity: { ...oldIdentity, role: 'Accounting' } };
    const expectedDirectory = structuredClone(oldDirectory);
    expectedDirectory.users.find(user => user.id === account.id).role = 'Accounting';
    expectedDirectory.activity[0] = canonicalEvent;
    assert.deepEqual(JSON.parse(saved.get(USER_STORAGE_KEY)), expectedDirectory);

    const session = new LocalDemoSession(directory);
    assert.deepEqual(session.read(), { email: account.email, userId: account.id, revision: account.revision, role: 'Accounting', status: 'ready' });
    assert.equal(JSON.parse(saved.get(SESSION_STORAGE_KEY)).role, 'Accounting');
    for (const mismatch of [{ userId: 'another-person' }, { revision: account.revision + 1 }]) {
      saved.set(SESSION_STORAGE_KEY, JSON.stringify({ email: account.email, userId: account.id, revision: account.revision, role: previousRole, ...mismatch }));
      assert.equal(new LocalDemoSession(directory).read().role, null);
      assert.equal(saved.has(SESSION_STORAGE_KEY), false);
    }

    const repository = new LocalDemoRepository(async () => {});
    const view = await repository.load();
    const expectedWorkspace = { ...oldWorkspace, role: 'Accounting', activity: [...oldWorkspace.activity.slice(0, -1), canonicalEvent] };
    assert.equal(view.status, 'ready');
    assert.deepEqual(view.snapshot, expectedWorkspace);
    assert.deepEqual(JSON.parse(saved.get(workspaceKey)), expectedWorkspace);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
  }
});

test('blocked storage preserves the original account directory and workflow records during rename', async () => {
  const at = '2026-10-01T10:00:00Z';
  const user = { id: 'accountant-42', name: 'Original accountant', email: 'original@example.com', role: previousRole, active: true, revision: 1, createdAt: at, updatedAt: at, credential: { salt: '0'.repeat(32), hash: '1'.repeat(64) } };
  const rawDirectory = JSON.stringify({ version: 1, users: [user, { ...user, id: 'admin-42', email: 'admin@example.com', role: 'Administrator' }], activity: [] });
  const workspace = { ...seedDemo(), role: previousRole };
  const rawWorkspace = JSON.stringify(workspace);
  const saved = new Map([[USER_STORAGE_KEY, rawDirectory], [workspaceKey, rawWorkspace]]);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: () => { throw new Error('Storage unavailable'); }, removeItem: () => { throw new Error('Unexpected removal'); } };
  const directory = new LocalUserDirectory(() => storage);
  await directory.load();
  assert.equal(directory.getSnapshot().status, 'volatile');
  assert.equal(directory.getSnapshot().users[0].role, 'Accounting');
  assert.equal(saved.get(USER_STORAGE_KEY), rawDirectory);

  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = storage;
  try {
    const repository = new LocalDemoRepository(async () => {});
    const view = await repository.load();
    assert.equal(view.status, 'volatile');
    assert.deepEqual(view.snapshot, { ...workspace, role: 'Accounting' });
    assert.equal(saved.get(workspaceKey), rawWorkspace);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
  }
});
