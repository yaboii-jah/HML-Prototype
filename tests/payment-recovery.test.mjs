import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PaymentRecovery } from '../src/domain/payments/recovery.ts';

const input = () => ({ type: 'verify', poId: randomUUID(), draftId: randomUUID(), expectedVersion: '3', evidenceReviewed: true, reason: 'Reviewed payment' });
test('lost acknowledgement recovers the identical receipt despite a newer displayed version', async () => {
  const receipts = new Map(), calls = [];
  let effects = 0;
  const recovery = new PaymentRecovery(async command => {
    calls.push(structuredClone(command));
    if (receipts.has(command.requestId)) return receipts.get(command.requestId);
    effects++;
    receipts.set(command.requestId, { ok: true, message: 'Recorded' });
    throw Error('Lost acknowledgement');
  }, randomUUID);
  const command = input();
  assert.equal((await recovery.run(command)).uncertain, true);
  command.expectedVersion = '4'; // realtime refresh and local editor changes
  command.reason = 'Different unsent reason';
  assert.equal((await recovery.run(command)).uncertain, true);
  assert.equal(calls.length, 1, 'No new action while unresolved');
  assert.equal((await recovery.recover()).ok, true);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(effects, 1);
  assert.equal(recovery.pending, null);
});
test('an unrecorded stale action requires review and a fresh identity after recovery', async () => {
  const calls = [];
  const recovery = new PaymentRecovery(async command => {
    calls.push(structuredClone(command));
    if (calls.length === 1) return { ok: false, uncertain: true, message: 'Unknown response' };
    if (calls.length === 2) return { ok: false, conflict: true, message: 'Review changed record' };
    return { ok: true, message: 'Recorded after review' };
  }, randomUUID);
  const command = input();
  await recovery.run(command);
  assert.equal((await recovery.recover()).conflict, true);
  assert.equal(recovery.pending, null);
  await recovery.run({ ...command, expectedVersion: '4' });
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.notEqual(calls[1].requestId, calls[2].requestId);
});
