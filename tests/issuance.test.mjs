import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseIssuanceCommand, parseSendingDetails, parsePoIssuance, sendingTimeIssue } from '../src/domain/purchasing/issuance.ts';

const details = { channel: 'email', recipient: 'Supplier contact', sentAt: '2026-11-08T15:59:59Z', notes: '', other: '' };
const command = { type: 'prepareSend', requestId: randomUUID(), mrfId: randomUUID(), targetId: randomUUID(), expectedVersion: '2', expectedDemand: '3',
  expectedPoVersion: '4', expectedProjectVersion: '5', expectedFamily: '6', expectedMrfArchive: randomUUID(), reason: '' };

test('sending requires a known channel, recipient and valid actual instant; Other requires explanation', () => {
  assert.deepEqual(parseSendingDetails(details), details);
  for (const patch of [{ channel: 'fax' }, { recipient: ' ' }, { sentAt: '2026-02-30T00:00:00Z' }, { sentAt: '2026-11-08T23:59' }, { channel: 'other', other: '' }, { notes: null }]) {
    assert.equal(parseSendingDetails({ ...details, ...patch }), null);
  }
  assert.ok(parseSendingDetails({ ...details, channel: 'other', other: 'Courier handover' }));
});

test('actual sending uses preparation bounds and Philippine Credit date, including valid late recording', () => {
  const start = '2026-11-07T00:00:00Z', later = new Date('2026-11-10T00:00:00Z');
  assert.equal(sendingTimeIssue(details, start, '2026-11-08', later), null, 'Recording after due date remains valid for timely sending');
  assert.match(sendingTimeIssue({ ...details, sentAt: '2026-11-08T16:00:00Z' }, start, '2026-11-08', later), /Credit due date/);
  assert.match(sendingTimeIssue(details, '2026-11-09T00:00:00Z', null, later), /on or after/);
  assert.match(sendingTimeIssue(details, start, null, new Date('2026-11-08T15:00:00Z')), /no later than now/);
});

test('commands reject client file authority and require bound preparations and explicit cancellation', () => {
  assert.deepEqual(parseIssuanceCommand(command), command);
  for (const key of ['proof', 'files', 'snapshot', 'actor', 'calculation', 'totals']) assert.equal(parseIssuanceCommand({ ...command, [key]: {} }), null);
  for (const key of ['expectedVersion', 'expectedPoVersion', 'expectedProjectVersion', 'expectedFamily', 'expectedDemand']) assert.equal(parseIssuanceCommand({ ...command, [key]: 1 }), null);
  const cancel = { ...command, type: 'cancelSend', preparationId: randomUUID(), notSent: true, reason: 'Never sent the documents' };
  assert.deepEqual(parseIssuanceCommand(cancel), cancel);
  assert.equal(parseIssuanceCommand({ ...cancel, notSent: 'true' }), null);
  assert.equal(parseIssuanceCommand({ ...cancel, notSent: false }), null);
  assert.equal(parseIssuanceCommand({ ...command, type: 'confirmSent', details }), null);
  assert.ok(parseIssuanceCommand({ ...command, type: 'confirmSent', preparationId: randomUUID(), details }));
});

test('issuance projections retain original/current details and omit session proof material', () => {
  const actor = { userId: randomUUID(), name: 'Procurement colleague', activeRole: 'Procurement', sessionId: randomUUID(), revision: 'private' };
  const p = { id: randomUUID(), approvalId: randomUUID(), mrfArchiveId: randomUUID(), poArchiveId: randomUUID(), formId: randomUUID(), supportingId: randomUUID(), actor, at: '2026-11-07T00:00:00Z' };
  const v = { status: 'issued', preparation: p, issuance: { id: randomUUID(), actor, at: '2026-11-09T00:00:00Z', details, originalDetails: details, blockersAtRecording: ['Supplier inactive'] }, cancellations: [], corrections: [] };
  const parsed = parsePoIssuance(v);
  assert.ok(parsed);
  assert.deepEqual(parsed.issuance.originalDetails, details);
  assert.deepEqual(parsed.issuance.blockersAtRecording, ['Supplier inactive']);
  assert.equal('sessionId' in parsed.preparation.actor, false);
  assert.equal('revision' in parsed.issuance.actor, false);
  assert.equal(parsePoIssuance({ ...v, status: 'notIssued' }), null);
  assert.equal(parsePoIssuance({ ...v, preparation: null }), null);
});
