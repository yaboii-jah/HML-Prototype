import assert from 'node:assert/strict';
import test from 'node:test';
import { demandTotals } from '../src/domain/demand/quantities.ts';

test('purchasing remainder and unassigned demand retain distinct meanings', () => {
  assert.deepEqual(demandTotals('18', [
    { ownerKind: 'transfer', quantity: '6' }, { ownerKind: 'suitability', quantity: '8' },
    { ownerKind: 'award', quantity: '2' },
  ]), { requested: '18', awarded: '2', ordered: '0', suitability: '8', transfers: '6', purchase: '4', unassigned: '2' });
  const award = demandTotals('18', [{ ownerKind: 'award', quantity: '18' }]);
  const converted = demandTotals('18', [{ ownerKind: 'award', quantity: '0' }, { ownerKind: 'purchase_order', quantity: '18' }]);
  assert.equal(award.unassigned, converted.unassigned);
  assert.equal(converted.purchase, '0');
});

test('exact fractional and large quantities never round or tolerate oversourcing', () => {
  assert.equal(demandTotals('0.3', [{ ownerKind: 'award', quantity: '0.1' }, { ownerKind: 'transfer', quantity: '0.2' }]).unassigned, '0');
  const tiny = '0.' + '0'.repeat(76) + '1';
  assert.equal(demandTotals('1', [{ ownerKind: 'award', quantity: tiny }]).unassigned, '0.' + '9'.repeat(77));
  const huge = '9'.repeat(80);
  assert.equal(demandTotals(huge, [{ ownerKind: 'purchase_order', quantity: huge }]).unassigned, '0');
  assert.throws(() => demandTotals('1', [{ ownerKind: 'transfer', quantity: '1' }, { ownerKind: 'award', quantity: tiny }]), /exceed/);
  assert.equal(demandTotals('0001.000', []).requested, '1');
});

test('invalid and absent demand quantities cannot become zero', () => {
  for (const value of ['', null, 1, '-1', 'NaN', 'Infinity', '1e2', '.1', '1.', '1'.repeat(81)]) {
    assert.throws(() => demandTotals('1', [{ ownerKind: 'award', quantity: value }]));
  }
  assert.throws(() => demandTotals('0', []), /positive/);
  assert.throws(() => demandTotals('1', [{ ownerKind: 'unknown', quantity: '1' }]));
});
