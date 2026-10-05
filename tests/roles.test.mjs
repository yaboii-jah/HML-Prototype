import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../src/domain/types.ts';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoSession, roleForDemoCredentials } from '../src/app-state/demo-session.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { blankWorkspace } from '../src/mock/fixtures/blank.ts';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { LocalDemoRepository } from '../src/mock/repository.ts';

const workspaceKey = 'hml-constructsync-demo-v12';
const sessionKey = 'hml-constructsync-demo-session-v1';
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
  assert.deepEqual(DEMO_ACCOUNTS.map(account => account.role), ROLES);
  for (const account of DEMO_ACCOUNTS) assert.equal(roleForDemoCredentials(account.email, DEMO_PASSWORD), account.role);
  assert.equal(roleForDemoCredentials('pm@constructsync.example', DEMO_PASSWORD), null);
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

test('retired PM sessions require sign-in without touching workspace records', async () => {
  const workspace = JSON.stringify(seedDemo());
  await withStorage([[sessionKey, 'Project Manager'], [workspaceKey, workspace]], saved => {
    assert.deepEqual(demoSession.read(), { role: null, status: 'ready' });
    assert.equal(saved.has(sessionKey), false); assert.equal(saved.get(workspaceKey), workspace);
    demoSession.select('Procurement'); assert.equal(demoSession.read().role, 'Procurement');
    demoSession.select('Project Manager'); assert.equal(demoSession.read().role, null); assert.equal(saved.has(sessionKey), false);
    assert.equal(saved.get(workspaceKey), workspace);
    demoSession.clear();
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
