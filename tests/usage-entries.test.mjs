import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { materialId } from '../src/domain/ids.ts';
import { stockFor } from '../src/domain/selectors.ts';
import { auditRecords } from '../src/domain/audit.ts';
import { createReadAccess } from '../src/domain/read-access.ts';
import { parseCurrent, LocalDemoRepository } from '../src/mock/repository.ts';
import { validUsageEntries } from '../src/domain/usage-entries.ts';
import { emptyUsageDraft, usageDraftKey, restoreUsageDraft, persistUsageDraft, discardUsageDraft, clearUsageDrafts } from '../src/features/inventory/usage-draft.ts';

function setup() {
  const state = seedDemo(), siteId = state.sites[0].id;
  state.movements = [
    { id: 'open-cement', siteId, itemName: 'CEMENT', unit: 'bag', quantity: 10, kind: 'opening', reason: 'Opening balance', actor: 'Site Personnel', at: '2026-10-01T00:00:00Z' },
    { id: 'open-plywood', siteId, itemName: 'Plywood', unit: 'sheet', quantity: 3.5, kind: 'opening', reason: 'Opening balance', actor: 'Site Personnel', at: '2026-10-01T00:00:00Z' },
  ];
  delete state.usageEntries; state.stockTransfers = []; state.transferDeliveries = [];
  let n = 0;
  const actor = { name: 'Site author', email: 'site@example.com', userId: 'site-person', role: 'Site Personnel', sessionRevision: 1 };
  const ctx = { now: () => '2026-10-17T03:04:05Z', id: prefix => `${prefix}-${++n}`, actor, siteIds: [siteId] };
  const cement = materialId('cement', 'bag'), plywood = materialId('plywood', 'sheet');
  const command = { type: 'recordUsageEntry', entryId: 'usage-test', siteId, reason: 'Slab and formwork', lines: [{ materialId: cement, quantity: 2 }, { materialId: plywood, quantity: 0.5, reason: 'Column formwork' }] };
  return { state, siteId, ctx, command, cement, plywood };
}

test('usage entry atomically creates canonical signed movements, immutable attribution and one grouped audit event', () => {
  const f = setup(), before = structuredClone(f.state), result = applyCommand(f.state, f.command, f.ctx);
  assert.equal(result.ok, true); assert.deepEqual(f.state, before);
  const { snapshot: saved } = result, entry = saved.usageEntries[0];
  assert.equal(result.recordId, entry.id); assert.equal(entry.movementIds.length, 2);
  assert.equal(stockFor(saved, f.siteId, 'cement', 'bag'), 8);
  assert.equal(stockFor(saved, f.siteId, 'plywood', 'sheet'), 3);
  const moves = saved.movements.filter(m => m.usageEntryId === entry.id);
  assert.deepEqual(moves.map(m => [m.itemName, m.quantity, m.reason]), [['CEMENT', -2, 'Slab and formwork'], ['Plywood', -0.5, 'Column formwork']]);
  assert.ok(moves.every(m => m.at === f.ctx.now() && m.actorIdentity.email === f.ctx.actor.email && !m.requestItemId));
  f.ctx.actor.name = 'Renamed later'; assert.equal(entry.actorIdentity.name, 'Site author');
  assert.equal(saved.activity.length, before.activity.length + 1);
  assert.equal(saved.activity[0].eventType, 'stock.changed'); assert.equal(saved.activity[0].entityType, 'usage-entry');
  const records = auditRecords(saved);
  assert.equal(records.get(entry.id).projectId, f.siteId);
  assert.equal(records.get(moves[0].id).href, `/inventory/usage/${entry.id}`);
  assert.equal(validUsageEntries(saved), true);
  assert.equal(parseCurrent(JSON.stringify(saved)).usageEntries[0].id, entry.id);
});

test('identical retry with reordered lines and trimmed reasons consumes stock and logs only once', () => {
  const f = setup(); f.command.lines[0].quantity = 10;
  const first = applyCommand(f.state, f.command, f.ctx);
  const again = applyCommand(first.snapshot, { ...f.command, reason: '  Slab and formwork ', lines: [...f.command.lines].reverse() }, { ...f.ctx, now: () => '2026-10-18T00:00:00Z' });
  assert.equal(again.ok, true); assert.deepEqual(again.snapshot, first.snapshot);
  for (const patch of [{ reason: 'Different reason' }, { siteId: f.state.sites[1].id }, { lines: [{ materialId: f.cement, quantity: 1 }] }]) {
    assert.equal(applyCommand(first.snapshot, { ...f.command, ...patch }, { ...f.ctx, siteIds: f.state.sites.map(s => s.id) }).ok, false);
  }
  assert.equal(applyCommand(first.snapshot, f.command, { ...f.ctx, actor: { ...f.ctx.actor, userId: 'other-person' } }).ok, false);
});

test('one invalid row rejects all quantities and identifies the row without mutating its input', () => {
  for (const quantity of [-1, 0, NaN, Infinity, 4]) {
    const f = setup(), before = structuredClone(f.state);
    f.command.lines[1].quantity = quantity;
    const result = applyCommand(f.state, f.command, f.ctx);
    assert.equal(result.ok, false); assert.ok(result.rowErrors[f.plywood]); assert.deepEqual(f.state, before);
  }
});

test('duplicates, missing materials and invalid explanations reject the whole entry', () => {
  for (const change of [
    c => { c.lines = []; },
    c => { c.lines.push({ ...c.lines[0] }); },
    c => { c.lines[0].materialId = 'mat-missing'; },
    c => { c.lines[0].materialId = '__proto__'; },
    c => { c.reason = '    '; },
    c => { c.lines[0].reason = 'bad'; },
    c => { c.entryId = '../bad-id'; },
    c => { c.entryId = 'new'; },
  ]) {
    const f = setup(), before = structuredClone(f.state); change(f.command);
    assert.equal(applyCommand(f.state, f.command, f.ctx).ok, false); assert.deepEqual(f.state, before);
  }
  const f = setup(); f.command.lines[0].reason = '   ';
  assert.equal(applyCommand(f.state, f.command, f.ctx).snapshot.movements.at(-2).reason, f.command.reason);
});

test('commit revalidates live balances and transfer reservations, including pending releases', () => {
  const f = setup(), before = structuredClone(f.state);
  f.state.stockTransfers = [{ id: 'transfer', sourceSiteId: f.siteId, status: 'pending', lines: [{ sourceMaterialId: f.cement, proposed: 9 }] }];
  assert.equal(applyCommand(f.state, f.command, f.ctx).ok, false);
  f.state.stockTransfers = [];
  f.state.movements.push({ ...before.movements[0], id: 'concurrent-use', quantity: -9, kind: 'usage' });
  assert.equal(applyCommand(f.state, f.command, f.ctx).ok, false);
  f.state.movements = before.movements;
  f.command.lines[0].quantity = 10; f.command.lines[1].quantity = 3.5;
  const result = applyCommand(f.state, f.command, f.ctx);
  assert.equal(result.ok, true); assert.equal(stockFor(result.snapshot, f.siteId, 'plywood', 'sheet'), 0);
});

test('role and current assignment checks also apply to retries', () => {
  const f = setup(), saved = applyCommand(f.state, f.command, f.ctx).snapshot;
  for (const state of [f.state, saved]) {
    assert.equal(applyCommand(state, f.command, { ...f.ctx, siteIds: [] }).ok, false);
    assert.equal(applyCommand(state, f.command, { ...f.ctx, siteIds: undefined }).ok, false);
    assert.equal(applyCommand(state, f.command, { ...f.ctx, actor: undefined }).ok, false);
    for (const role of ['Accounting / Auditing', 'Administrator', 'Project Manager']) assert.equal(applyCommand(state, f.command, { ...f.ctx, actor: { ...f.ctx.actor, role } }).ok, false);
  }
});

test('usage routes, ownership and activity respect assigned projects; material routes remain accessible', () => {
  const f = setup(), saved = applyCommand(f.state, f.command, f.ctx).snapshot;
  const assigned = createReadAccess(saved, 'Site Personnel', [f.siteId]), other = createReadAccess(saved, 'Site Personnel', [saved.sites[1].id]);
  assert.equal(assigned.canOpen('/inventory/usage/new'), true);
  assert.equal(assigned.canOpen('/inventory/usage/usage-test'), true);
  assert.equal(assigned.canReadRecord('usage-test'), true);
  assert.equal(assigned.canReadActivity(saved.activity[0]), true);
  assert.equal(other.canOpen('/inventory/usage/usage-test'), false);
  assert.equal(other.canReadActivity(saved.activity[0]), false);
  assert.equal(createReadAccess(saved, 'Site Personnel', []).canOpen('/inventory/usage/new'), false);
  assert.equal(assigned.canOpen(`/inventory/${f.siteId}/${f.cement}`), true);
  assert.equal(createReadAccess(saved, 'Accounting / Auditing').canOpen('/inventory/usage/usage-test'), true);
});

test('existing snapshots need no usage collection; malformed or orphaned groups are rejected on reload', () => {
  const f = setup();
  assert.equal(validUsageEntries(f.state), true);
  assert.equal(parseCurrent(JSON.stringify(f.state)).usageEntries, undefined);
  const saved = applyCommand(f.state, f.command, f.ctx).snapshot;
  for (const damage of [
    s => { s.usageEntries = {}; },
    s => { s.usageEntries.push(structuredClone(s.usageEntries[0])); },
    s => { s.usageEntries[0].movementIds.push('missing'); },
    s => { s.usageEntries[0].actorIdentity = null; },
    s => { s.movements.at(-1).usageEntryId = 'missing'; },
    s => { s.movements.at(-1).quantity = 1; },
    s => { delete s.usageEntries; },
  ]) { const bad = structuredClone(saved); damage(bad); assert.equal(parseCurrent(JSON.stringify(bad)), null); }
});

function storageFixture() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] || null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('private draft restores strings and stable IDs; project, account and workspace drafts are independent', () => {
  const storage = storageFixture(), key = usageDraftKey('person', 'workspace', 'site');
  const draft = emptyUsageDraft(); draft.reason = 'Concrete work'; draft.lines = [{ materialId: 'mat-cement', name: 'Cement', unit: 'bag', quantity: '0.50', reason: '' }];
  assert.equal(persistUsageDraft(storage, key, draft), ''); assert.deepEqual(restoreUsageDraft(storage, key).draft, draft);
  for (const args of [['other-person', 'workspace', 'site'], ['person', 'workspace', 'other-site'], ['person', 'other-workspace', 'site']]) assert.equal(restoreUsageDraft(storage, usageDraftKey(...args)).draft.lines.length, 0);
  storage.setItem('unrelated', 'retain'); clearUsageDrafts(storage); assert.equal(storage.values.size, 1); assert.equal(storage.getItem('unrelated'), 'retain');
});

test('draft storage failures are reported and malformed data is preserved until discard', () => {
  const storage = storageFixture(), key = usageDraftKey('a', 'w', 'p'); storage.setItem(key, JSON.stringify({ entryId: 'usage-bad', reason: '', lines: [null] }));
  assert.equal(restoreUsageDraft(storage, key).blocked, true); assert.ok(storage.getItem(key));
  storage.setItem(key, '{broken JSON'); assert.equal(restoreUsageDraft(storage, key).blocked, true); assert.equal(storage.getItem(key), '{broken JSON');
  const failure = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.ok(restoreUsageDraft(failure, key).error); assert.ok(persistUsageDraft(failure, key, emptyUsageDraft())); assert.ok(discardUsageDraft(failure, key));
  assert.equal(discardUsageDraft(storage, key), ''); assert.equal(storage.getItem(key), null);
});

test('repository reports durable versus volatile saves and a retry never deducts stock twice', async () => {
  const f = setup(), storage = storageFixture(), priorStorage = globalThis.localStorage, priorWindow = globalThis.window;
  storage.setItem('hml-constructsync-demo-v12', JSON.stringify(f.state));
  globalThis.window = { addEventListener() {} }; globalThis.localStorage = storage;
  try {
    const repo = new LocalDemoRepository(); repo.getSnapshot();
    const setItem = storage.setItem; storage.setItem = () => { throw new Error('quota'); };
    const first = await repo.execute(f.command, f.ctx.actor, [f.siteId]);
    assert.equal(first.ok, true); assert.equal(first.persisted, false); assert.equal(repo.getSnapshot().status, 'volatile');
    storage.setItem = setItem;
    const again = await repo.execute(f.command, f.ctx.actor, [f.siteId]);
    assert.equal(again.ok, true); assert.equal(again.persisted, true); assert.equal(again.snapshot.usageEntries.length, 1);
    assert.equal(stockFor(again.snapshot, f.siteId, 'cement', 'bag'), 8);
    assert.equal(new LocalDemoRepository().getSnapshot().snapshot.usageEntries.length, 1);
  } finally { globalThis.localStorage = priorStorage; globalThis.window = priorWindow; }
});
