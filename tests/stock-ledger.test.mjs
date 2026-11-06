import assert from 'node:assert/strict';
import test from 'node:test';
import { stockBalance } from '../src/domain/stock/ledger.ts';

test('dispatch converts a reservation to a debit without changing free stock', () => {
  assert.deepEqual(stockBalance(['18'], ['8']), { onHand: '18', reserved: '8', available: '10' });
  assert.deepEqual(stockBalance(['18', '-3'], ['5']), { onHand: '15', reserved: '5', available: '10' });
  assert.throws(() => stockBalance(['18', '-11'], ['8']), /below reservations/);
  assert.deepEqual(stockBalance(['18', '-10'], ['8']), { onHand: '8', reserved: '8', available: '0' });
});
test('stock decimals and large totals remain exact without tolerance', () => {
  assert.deepEqual(stockBalance(['0.1', '0.2', '-0.3'], []), { onHand: '0', reserved: '0', available: '0' });
  const tiny = '0.' + '0'.repeat(76) + '1';
  assert.equal(stockBalance(['1'], [tiny]).available, '0.' + '9'.repeat(77));
  assert.throws(() => stockBalance(['1', '-' + tiny], ['1']), /below reservations/);
  const huge = '9'.repeat(80);
  assert.equal(stockBalance([huge, huge], []).onHand, (BigInt(huge) * BigInt(2)).toString());
  assert.equal(stockBalance([huge, '-' + huge], []).onHand, '0');
  assert.deepEqual(stockBalance([], []), { onHand: '0', reserved: '0', available: '0' });
});
test('missing, non-finite and malformed quantities never become zero', () => {
  for (const value of [null, 1, '', 'NaN', 'Infinity', '1e2', '.1', '1.', '1'.repeat(81)]) {
    assert.throws(() => stockBalance([value], []));
    assert.throws(() => stockBalance([], [value]));
  }
  assert.throws(() => stockBalance(['1'], ['-1']));
  assert.throws(() => stockBalance(['-1'], []), /negative/);
});
