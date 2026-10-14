import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { createReadAccess } from '../src/domain/read-access.ts';
import { dashboardMetrics } from '../src/domain/queues.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { budgetFor } from '../src/domain/selectors.ts';

function fixture() {
  const state = seedDemo();
  state.sites.push({ ...state.sites[0], id: 'site-c', name: 'Unrelated project' });
  state.stockTransfers = [{ id: 'transfer', requestId: 'm1', sourceSiteId: 'site-b', destinationSiteId: 'site-a', lines: [], status: 'pending' }];
  state.transferDeliveries = [{ id: 'trip', transferId: 'transfer', receiptVersions: [{ id: 'receipt' }] }];
  state.stockSuitabilityReviews = [{ id: 'suitability', requestId: 'm1', sourceSiteId: 'site-b', destinationSiteId: 'site-a' }];
  return state;
}

test('Site Personnel access follows assignments and parent ownership rather than the selected project', () => {
  const state = fixture();
  state.siteFilter = 'site-b';
  const access = createReadAccess(state, 'Site Personnel', ['site-a', 'removed-project']);
  assert.deepEqual(access.projectIds, ['site-a']);
  assert.equal(access.siteFilter, 'all');
  assert.equal(access.showBudgets, false);
  for (const request of state.requests) assert.equal(access.canReadRecord(request.id), request.siteId === 'site-a');
  for (const po of state.pos) assert.equal(access.canReadRecord(po.id), state.requests.find(request => request.id === po.mrfId).siteId === 'site-a');
  for (const batch of state.batches) assert.equal(access.canReadRecord(batch.id), access.canReadRecord(batch.poId));
  for (const quote of state.quotes) assert.equal(access.canReadRecord(quote.id), access.canReadRecord(quote.mrfId));
  assert.equal(access.canReadProject('site-b'), false);
  assert.equal(access.canReadRecord('missing'), false);
  assert.equal(createReadAccess(state, 'Site Personnel', ['site-a', 'site-b']).canReadProject('site-b'), true);
});

test('operational routes and linked POs are allowed while department and comparison workspaces are blocked', () => {
  const state = fixture(), access = createReadAccess(state, 'Site Personnel', ['site-a']);
  const ownRequest = state.requests.find(request => request.siteId === 'site-a');
  const otherRequest = state.requests.find(request => request.siteId === 'site-b');
  const ownPO = state.pos.find(po => po.mrfId === ownRequest.id);
  for (const route of ['/dashboard', '/projects', '/requests', '/requests/new', '/deliveries', '/inventory', '/projects/site-a', `/requests/${ownRequest.id}`, `/requests/${ownRequest.id}/edit`, `/purchase-orders/${ownPO.id}?from=delivery`, '/inventory/site-a/material']) assert.equal(access.canOpen(route), true, route);
  for (const route of ['/suppliers', '/purchase-orders', '/finance', '/accounting', '/reports', '/admin', '/admin/maintenance', `/finance/${ownPO.id}`, `/accounting/${ownPO.id}`, `/purchase-orders/${ownPO.id}/edit`, `/requests/${ownRequest.id}/quotes`, `/requests/${ownRequest.id}/quotes?materialId=x`, `/requests/${otherRequest.id}`, '/projects/site-b', '/inventory/site-b/material', '/deliveries/new?poId=po1', '/unknown', '/projects/%ZZ', 'https://example.com/projects/site-a']) assert.equal(access.canOpen(route), false, route);
});

test('source and destination assignments grant transfer context without granting the other project records', () => {
  const state = fixture();
  for (const project of ['site-a', 'site-b']) {
    const access = createReadAccess(state, 'Site Personnel', [project]);
    assert.equal(access.canOpen('/stock-transfers/transfer'), true);
    assert.equal(access.canReadRecord('trip'), true);
    assert.equal(access.canReadTarget({ kind: 'transfer-receipt', deliveryId: 'trip', receiptId: 'receipt' }), true);
    assert.equal(access.canReadActivity({ id: 'event', entity: 'transfer', relatedProjectIds: ['site-a', 'site-b'] }), true);
    assert.equal(access.canOpen('/projects/' + (project === 'site-a' ? 'site-b' : 'site-a')), false);
  }
  const source = createReadAccess(state, 'Site Personnel', ['site-b']);
  assert.equal(source.canOpen('/requests/m1'), false);
  assert.equal(source.canReadRecord('suitability'), false);
  assert.equal(createReadAccess(state, 'Site Personnel', ['site-a']).canReadRecord('suitability'), true);
  assert.equal(createReadAccess(state, 'Site Personnel', ['site-c']).canOpen('/stock-transfers/transfer'), false);
});

test('document jobs, evidence and history follow record ownership, including removed records and transfers', () => {
  const state = fixture();
  const ownPO = state.pos.find(po => state.requests.find(request => request.id === po.mrfId)?.siteId === 'site-a');
  const otherPO = state.pos.find(po => state.requests.find(request => request.id === po.mrfId)?.siteId === 'site-b');
  ownPO.paymentProofs = [{ id: 'own-proof' }];
  state.accounting.push({ poId: ownPO.id, documents: [{ id: 'own-evidence' }] });
  const access = createReadAccess(state, 'Site Personnel', ['site-a']);
  assert.equal(access.canReadRecord('own-proof'), true);
  assert.equal(access.canReadRecord('own-evidence'), true);
  assert.equal(access.canReadTarget({ kind: 'payment-proof', poId: ownPO.id, documentId: 'own-proof' }), true);
  assert.equal(access.canReadTarget({ kind: 'evidence', poId: otherPO.id, documentId: 'other' }), false);
  assert.equal(access.canReadTarget({ kind: 'report', id: state.bidReports[0]?.id || 'comparison' }), false);
  assert.equal(access.canReadTarget(), false);
  assert.equal(access.canReadActivity({ entity: 'deleted-scope', projectId: 'site-a' }), true);
  assert.equal(access.canReadActivity({ entity: 'deleted-scope', projectId: 'site-b' }), false);
  assert.equal(access.canReadActivity({ entity: 'unknown', action: 'site-a budget' }), false);
});

test('empty assignments fail closed and other roles retain existing visibility', () => {
  const state = fixture(), access = createReadAccess(state, 'Site Personnel');
  assert.deepEqual(access.projectIds, []);
  assert.equal(access.siteFilter, 'all');
  assert.equal(access.canOpen('/requests/new'), false);
  assert.equal(access.canOpen('/requests'), true);
  assert.equal(access.canOpen('/requests/m1'), false);
  assert.equal(access.canReadProject('site-a'), false);
  for (const role of ['Administrator', 'Project Manager', 'Procurement', 'Finance', 'Logistics', 'Accounting / Auditing']) {
    const other = createReadAccess(state, role);
    assert.equal(other.showBudgets, true);
    assert.equal(other.canOpen('/accounting/po1'), true);
    assert.equal(other.canReadProject('site-b'), true);
  }
  assert.equal(createReadAccess(state, null).canOpen('/dashboard'), false);
});

test('dashboard counts use readable projects without changing financial calculations or saved data', () => {
  const state = seedDemo();
  const before = structuredClone(state), budgets = state.sites.map(site => budgetFor(state, site.id));
  const access = createReadAccess(state, 'Site Personnel', ['site-a']);
  const counts = dashboardMetrics(state, access.canReadProject);
  const expectedRequests = state.requests.filter(request => request.siteId === 'site-a');
  assert.equal(counts.procurementReviews, expectedRequests.filter(request => request.status === 'submitted' || request.correction?.status === 'submitted').length);
  const empty = dashboardMetrics(state, createReadAccess(state, 'Site Personnel', []).canReadProject);
  assert.ok(Object.values(empty).every(value => value === 0));
  assert.deepEqual(state.sites.map(site => budgetFor(state, site.id)), budgets);
  assert.deepEqual(state, before);
});

test('hiding budgets preserves funded-scope submission enforcement and actionable amount-free errors', () => {
  const state = seedDemo(), request = state.requests[0];
  request.status = 'draft';
  state.scopes.find(scope => scope.id === request.scopeId).budget = 0;
  const result = applyCommand(state, { type: 'saveRequest', ...request, intent: 'submit' }, { now: () => '2026-10-14T00:00:00Z', id: prefix => prefix + '-read-test', actor: { role: 'Site Personnel', name: 'Assigned user', email: 'site@example.com' }, siteIds: [request.siteId] });
  assert.equal(result.ok, false);
  assert.match(result.message, /budget|funds/i);
  assert.doesNotMatch(result.message, /PHP|\d/);
});
