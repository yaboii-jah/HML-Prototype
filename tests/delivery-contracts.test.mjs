import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseDeliveryCommand, parseDeliveriesView, requestedQuantity } from '../src/domain/deliveries/contracts.ts';
const plan = () => ({ route:'site', plannedDate:'2026-11-18', plannedTime:'', pickup:'Supplier', destination:'Site', address:'Site address', note:'', lines:[{ lineId:randomUUID(), quantity:'0.125' }] });
const command = () => ({ type:'schedule', requestId:randomUUID(), deliveryId:randomUUID(), poId:randomUUID(), expectedVersion:'0', reason:'', plan:plan() });
test('delivery quantities retain exact supplier to requested unit conversions', () => {
  assert.equal(requestedQuantity('0.125','12'),'1.5');
  assert.equal(requestedQuantity('9007199254740993','0.01'),'90071992547409.93');
});
test('load input rejects duplicate lines, numeric quantities and missing locations', () => {
  const c = command(); assert.ok(parseDeliveryCommand(c));
  assert.equal(parseDeliveryCommand({ ...c, plan:{ ...c.plan, lines:[...c.plan.lines,...c.plan.lines] } }),null);
  assert.equal(parseDeliveryCommand({ ...c, plan:{ ...c.plan, lines:[{ ...c.plan.lines[0],quantity:0.125 }] } }),null);
  assert.equal(parseDeliveryCommand({ ...c, plan:{ ...c.plan,address:'' } }),null);
});
test('reasoned changes and timezone explicit departure are mandatory', () => {
  const c = command();
  assert.equal(parseDeliveryCommand({ ...c,type:'cancel' }),null);
  assert.ok(parseDeliveryCommand({ ...c,type:'cancel',reason:'Truck unavailable' }));
  const departure = { at:'2026-11-18T10:30:00+08:00',carrier:'',driver:'',vehicle:'',reference:'',note:'' };
  assert.ok(parseDeliveryCommand({ ...c,type:'dispatch',departure }));
  assert.equal(parseDeliveryCommand({ ...c,type:'dispatch',departure:{ ...departure,at:'2026-11-18T10:30' } }),null);
});
test('delivery view rejects unexpected financial payloads', () => {
  assert.ok(parseDeliveriesView({ role:'Site Personnel',orders:[],deliveries:[] }));
  assert.equal(parseDeliveriesView({ role:'Site Personnel',orders:[],deliveries:[],budget:'500' }),null);
});
