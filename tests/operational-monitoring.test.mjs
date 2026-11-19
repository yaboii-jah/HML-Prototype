import test from 'node:test';
import assert from 'node:assert/strict';
import { consumptionCsv, parseMonitoringFilters, parseMonitoringView } from '../src/domain/monitoring/contracts.ts';

test('consumption defaults to the Philippine calendar month and rejects invalid selections', () => {
  assert.deepEqual(parseMonitoringFilters('consumption', new URLSearchParams(), '2026-11-01'),
    { from: '2026-11-01', to: '2026-11-01' });
  for (const query of ['from=2026-02-30', 'from=0000-01-01', 'from=2026-11-25&to=2026-11-24',
    'projectId=invalid', 'scopeId=invalid', 'unit=box&unit=bag']) {
    assert.equal(parseMonitoringFilters('consumption', new URLSearchParams(query), '2026-11-30'), null, query);
  }
  assert.deepEqual(parseMonitoringFilters('reports', new URLSearchParams('to=2026-11-20')), { to: '2026-11-20' });
  assert.deepEqual(parseMonitoringFilters('consumption', new URLSearchParams('search=+cement+&unit=+bag+'), '2026-11-05'),
    { search: 'cement', unit: 'bag', from: '2026-11-01', to: '2026-11-05' });
});

test('consumption export quotes dangerous text while preserving signed exact ledger values', () => {
  const csv = consumptionCsv([{
    project: '=SUM(A1:A2)', material: ' \t+Cable, "red"\nline', unit: '@box',
    opening: '999999999999999999.0123456789', openingEntries: '0', receipts: '0', usage: '0',
    dispatch: '0', corrections: '-0.0123456789', closing: '999999999999999999',
  }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes(`"'=SUM(A1:A2)","' \t+Cable, ""red""\nline","'@box"`));
  assert.ok(csv.includes('"999999999999999999.0123456789"'));
  assert.ok(csv.includes('"-0.0123456789"'));
});

test('monitoring rejects unchecked links and preserves exact strings', () => {
  assert.equal(parseMonitoringView('bell', { count: -1, actions: [] }), null);
  const action = {
    key: 'task', projectId: '44b09556-6186-43c6-b8a6-a547b192e569', ref: 'TRF-001', href: '//foreign.test',
    label: 'Approve release', blocker: null, at: '2026-11-19T01:00:00Z', flag: null,
  };
  assert.equal(parseMonitoringView('bell', { count: 1, actions: [action] }), null);
});
