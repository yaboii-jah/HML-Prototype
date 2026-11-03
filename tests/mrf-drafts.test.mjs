import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyMrfDraft, parseMrfDraft, parseDraftCommand, draftQuantity, validDraftDate } from '../src/domain/requests/drafts.ts';

test('MRF drafts allow missing submission data and zero materials', () => {
  assert.deepEqual(parseMrfDraft(emptyMrfDraft()), emptyMrfDraft());
  const partial = { ...emptyMrfDraft(), items: [{ id: randomUUID(), name: '  Cement  ', unit: '', quantity: null, neededDate: '', purpose: '', location: '', remarks: '' }] };
  assert.equal(parseMrfDraft(partial).items[0].name, 'Cement');
  assert.equal(parseMrfDraft(partial).items[0].quantity, null);
  assert.equal(parseMrfDraft({ ...partial, items: [...partial.items, ...partial.items] }), null);
});
test('supplied quantities remain exact positive decimals', () => {
  assert.equal(draftQuantity('00012345678901234567890.1234500'), '12345678901234567890.12345');
  for (const value of ['', '0', '0.00', '-1', 'NaN', 'Infinity', '1e3', 1, undefined]) assert.equal(draftQuantity(value), undefined);
  assert.equal(draftQuantity(null), null);
});
test('draft dates are optional, real calendar dates', () => {
  assert.equal(validDraftDate(''), true);
  assert.equal(validDraftDate('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01', null]) assert.equal(validDraftDate(value), false);
});
test('create/save commands require stable identities and edit versions', () => {
  const base = { type: 'createDraft', requestId: randomUUID(), projectId: randomUUID(), draft: emptyMrfDraft() };
  assert.deepEqual(parseDraftCommand(base), base);
  assert.equal(parseDraftCommand({ ...base, requestId: 'forged' }), null);
  assert.equal(parseDraftCommand({ ...base, type: 'saveDraft', mrfId: randomUUID() }), null);
  assert.equal(parseDraftCommand({ ...base, draft: { ...base.draft, scopeId: 'forged' } }), null);
});
