import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseSupplierCommand, parseSupplierView, supplierNameKey } from '../src/domain/suppliers/suppliers.ts';
import { foundationViewQuery, parseFoundationView } from '../src/domain/realtime/foundation.ts';

const profile = { name: ' Sample supplier ', address: '', tin: '', contactName: '', email: '', phone: '', accreditationNote: '' };
const create = () => ({ type: 'createSupplier', requestId: randomUUID(), profile });
test('supplier capture permits incomplete contacts without interpreting TIN or phone', () => {
  const command = parseSupplierCommand({ ...create(), profile: { ...profile, tin: '001-000', phone: '+63 (2) 123 ext 4' } });
  assert.equal(command.profile.name, 'Sample supplier');
  assert.equal(command.profile.tin, '001-000');
  for (const bad of [{ ...profile, name: '  ' }, { ...profile, email: 'bad' }, { ...profile, phone: 123 }, { ...profile, address: 'x'.repeat(1001) }]) {
    assert.equal(parseSupplierCommand({ ...create(), profile: bad }), null);
  }
  assert.equal(supplierNameKey('  Acme\t MATERIALS  '), supplierNameKey('acme materials'));
  assert.notEqual(supplierNameKey('Acme, Inc.'), supplierNameKey('Acme Inc'));
});
test('supplier updates require exact opaque versions and bounded reasons', () => {
  const base = { type: 'setSupplierStatus', requestId: randomUUID(), supplierId: randomUUID(), expectedVersion: '9007199254740993', active: false, reason: 'No longer used' };
  assert.equal(parseSupplierCommand(base).expectedVersion, base.expectedVersion);
  for (const bad of [{ expectedVersion: 1 }, { expectedVersion: '0' }, { supplierId: 'no' }, { active: 'false' }, { reason: ' x ' }, { reason: 'x'.repeat(2001) }, { type: 'deleteSupplier' }]) {
    assert.equal(parseSupplierCommand({ ...base, ...bad }), null);
  }
});
test('supplier view parser rejects Site projections and malformed history', () => {
  const supplier = { ...profile, id: randomUUID(), version: '1', active: true };
  const data = { role: 'Accounting', suppliers: [supplier], history: [] };
  assert.ok(parseSupplierView(data));
  assert.equal(parseSupplierView({ ...data, role: 'Site Personnel' }), null);
  assert.equal(parseSupplierView({ ...data, history: [{}] }), null);
  assert.equal(parseSupplierView({ ...data, suppliers: [{ ...supplier, version: 1 }] }), null);
  assert.equal(foundationViewQuery(`/suppliers/${supplier.id}`), `view=suppliers&supplierId=${supplier.id}`);
  assert.equal(foundationViewQuery('/suppliers'), 'view=suppliers');
  assert.equal(foundationViewQuery('/suppliers/invalid'), null);
  assert.equal(parseFoundationView({ kind: 'suppliers', data }).kind, 'suppliers');
  assert.equal(parseFoundationView({ kind: 'suppliers', data: { ...data, role: 'Site Personnel' } }), null);
});
