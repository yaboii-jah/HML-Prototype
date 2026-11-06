import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { purchasingFixture } from './helpers/purchasing.mjs';
import { calculatePo, comparisonSnapshot, convertedPrice, exactQuantity, makeOrderLine } from '../src/domain/purchasing/pricing.ts';
import { decimal, divide } from '../src/domain/quotations/decimal.ts';
import { parseOrderBody, parsePurchasingCommand, parsePurchasingView } from '../src/domain/purchasing/contracts.ts';

test('partial order shares exact confirmed stages without reconciling the full original total', () => {
  const { q, order } = purchasingFixture({ fixed: '100', charges: true });
  q.body.printedTotal = q.financial.calculation.gross;
  order.lines[0] = { ...order.lines[0], fixedDiscount: '50', discountReason: 'Supplier confirmed partial discount', discountConfirmed: true };
  order.adjustments[0] = { ...order.adjustments[0], amount: '400', reason: 'Supplier confirmed smaller delivery charge', confirmed: true };
  order.adjustments[1].confirmed = true;
  const before = structuredClone(q), result = calculatePo(q, order);
  assert.deepEqual(result.issues, []);
  assert.equal(result.materials, '4430.00'); assert.equal(result.gross, '4608.50');
  assert.equal(result.vat, '493.77'); assert.equal(result.ewtGoods, '39.55'); assert.equal(result.ewtServices, '7.14'); assert.equal(result.net, '4561.81');
  assert.deepEqual(q, before, 'Frozen source remains unchanged');
});
test('partial fixed discounts start blank and review cannot hide an excessive discount', () => {
  const { q, order } = purchasingFixture({ fixed: '100' });
  assert.equal(order.lines[0].fixedDiscount, '');
  assert.match(calculatePo(q, order).issues.join(' '), /confirm the fixed line discount/);
  order.lines[0] = { ...order.lines[0], fixedDiscount: '5000', discountConfirmed: true, discountReason: 'Reviewed supplier discount' };
  assert.match(calculatePo(q, order).issues.join(' '), /cannot exceed/);
});
test('half-up money stages use source precision rather than rounded converted prices', () => {
  const { q, order } = purchasingFixture({ price: '1.005', vat: 'NON-VAT' });
  order.lines = [makeOrderLine(q, q.body.lines[0].id, '1', randomUUID())];
  assert.equal(calculatePo(q, order).gross, '1.01');
});
test('percentage adjustments cannot change their source rate or compound sequentially', () => {
  const { q, order } = purchasingFixture({ charges: true });
  order.adjustments.forEach(a => { a.confirmed = true; });
  order.adjustments[1].amount = '6'; order.adjustments[1].reason = 'Attempted manual percentage change';
  const result = calculatePo(q, order);
  assert.match(result.issues.join(' '), /percentage rates cannot be changed/);
  assert.equal(result.adjustments[1].input, '-224.00');
});
test('missing/excluded/invented charges and source rows retain visible readiness failures', () => {
  const { q, order } = purchasingFixture({ charges: true });
  order.adjustments[0].include = false;
  assert.match(calculatePo(q, order).issues.join(' '), /Explain changed or excluded/);
  order.adjustments.pop(); assert.match(calculatePo(q, order).issues.join(' '), /every quoted document adjustment/);
  q.financial.review.rows[0].role = 'reference';
  assert.match(calculatePo(q, order).issues.join(' '), /confirmed matched/);
});
test('unfinished adjustment typing stays visible without crashing the editor calculation', () => {
  const { q, order } = purchasingFixture({ charges: true });
  order.adjustments[0].amount = '.';
  assert.match(calculatePo(q, order).issues.join(' '), /exact nonnegative adjustment/);
});
test('comparison accepts exact computed money beyond the source input length bound', () => {
  const { view } = purchasingFixture({ price: '9'.repeat(70), quoted: '1000000000', factor: '1000000000' });
  const snapshot = comparisonSnapshot(view, [], 'Buyer', '2026-11-06T00:00:00.000Z');
  assert.ok(snapshot.sources[0].gross.length > 80);
  assert.equal(snapshot.items[0].offers[0].capacity, '1000000000000000000');
});
test('zero-valued selected free material is calculable without fabricating a paid amount', () => {
  const { q, order } = purchasingFixture();
  q.body.lines[0].unitPrice = '0'; q.financial.review.rows[0].free = true;
  const result = calculatePo(q, order);
  assert.deepEqual(result.issues, []); assert.equal(result.gross, '0.00'); assert.equal(result.net, '0.00');
});
test('quantity conversion rejects repeating decimals and preserves exact finite fractions', () => {
  assert.throws(() => exactQuantity(divide(decimal('1'), decimal('3'))), /requires rounding/);
  assert.equal(exactQuantity(divide(decimal('1'), decimal('8'))), '0.125');
  const { q } = purchasingFixture({ factor: '3' });
  assert.equal(makeOrderLine(q, q.body.lines[0].id, '0.5', randomUUID()).quantity, '1.5');
  assert.throws(() => makeOrderLine(q, q.body.lines[0].id, '100.0000000000000000001', randomUUID()), /capacity/);
  assert.deepEqual(convertedPrice('10', '3'), { text: '3.333333', approximate: true });
  assert.deepEqual(convertedPrice('10', '8'), { text: '1.25', approximate: false });
});
test('comparison freezes purchase basis separately from unassigned demand and excludes fees from rankings', () => {
  const { view, q, item } = purchasingFixture({ charges: true });
  view.claims = [{ claimId: randomUUID(), itemId: item, ownerKind: 'award', ownerId: randomUUID(), ownerLineId: randomUUID(), quantity: '20' }, { claimId: randomUUID(), itemId: item, ownerKind: 'purchase_order', ownerId: randomUUID(), ownerLineId: randomUUID(), quantity: '30' }];
  const snapshot = comparisonSnapshot(view, [], 'Buyer', '2026-11-06T00:00:00.000Z');
  assert.equal(snapshot.items[0].purchase, '970'); assert.equal(snapshot.items[0].unassigned, '950'); assert.equal(snapshot.items[0].offers[0].price, '112');
  const old = structuredClone(snapshot); q.body.lines[0].unitPrice = '999'; view.claims[0].quantity = '21'; assert.deepEqual(snapshot, old);
});
test('comparison supports partial coverage and requires explicit ambiguous alternatives', () => {
  const { view, q } = purchasingFixture();
  view.quotations.request.items.push({ id: randomUUID(), name: 'No supplier', unit: 'pc', quantity: '2' });
  assert.equal(comparisonSnapshot(view, [], '', '2026-11-06T00:00:00.000Z').items[1].offers.length, 0);
  q.body.lines.push({ ...q.body.lines[0], id: randomUUID() }); q.matches.push(q.body.lines[1].id); q.financial.review.rows.push({ ...q.financial.review.rows[0], id: q.body.lines[1].id });
  assert.throws(() => comparisonSnapshot(view, [], '', '2026-11-06T00:00:00.000Z'), /Choose a comparison alternative/);
});
test('checked interfaces reject client totals, duplicate rows, invalid dates and Site payloads', () => {
  const { view, order, q } = purchasingFixture();
  assert.ok(parsePurchasingView(view)); assert.equal(parsePurchasingView({ ...view, role: 'Site Personnel' }), null);
  const command = { type: 'saveAward', requestId: randomUUID(), targetId: randomUUID(), mrfId: q.mrfId, expectedVersion: '0', expectedDemand: '0', quoteId: q.id, expectedFamily: '1', body: order };
  assert.ok(parsePurchasingCommand(command)); assert.equal(parsePurchasingCommand({ ...command, totals: { gross: '0.00' } }), null);
  assert.equal(parseOrderBody({ ...order, fields: { ...order.fields, date: '2026-99-99' } }), null);
  assert.equal(parseOrderBody({ ...order, lines: [order.lines[0], order.lines[0]] }), null);
});
