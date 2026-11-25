import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyMrfDraft, parseDraftCommand } from '../src/domain/requests/drafts.ts';
import { fillMrfDraft, parseMrfProposal, removeMrfProposal } from '../src/domain/requests/extraction.ts';

const proposalId = '36c37714-bcf5-4fc7-b565-fbaa6decf87f';

test('MRF suggestions keep exact decimal precision and require valid PDF pages', () => {
  const result = parseMrfProposal({
    details: { requestDate: { value: '2026-02-30', page: 1 }, sourceRef: { value: 'PRINTED-123', page: 4 } },
    rows: [{ page: 2, name: 'Mesh', quantity: '9007199254740993.000090' },
      { page: 1, name: 'Cement', quantity: 1.25, neededDate: 'unclear' }],
  }, 2);
  assert.equal(result.details.requestDate.value, '');
  assert.equal(result.details.sourceRef.value, '');
  assert.deepEqual(result.rows.map(row => [row.name, row.quantity, row.neededDate]), [
    ['Cement', null, ''], ['Mesh', '9007199254740993.00009', ''],
  ]);
  assert.equal(parseMrfProposal({ details: {}, rows: [{ page: 3, name: 'Outside PDF' }] }, 2), null);
});

test('autofill fills blanks, preserves entered values and skips equivalent rows', () => {
  const material = { id: 'existing', name: '  STEEL mesh ', quantity: '02.1250', unit: ' sheets ', neededDate: '', purpose: 'Test   work', location: 'Site', remarks: '' };
  const draft = { ...emptyMrfDraft(), items: [material], requestedBy: 'Manual name', sourceRef: 'Original reference' };
  const proposal = parseMrfProposal({
    details: { requestedBy: { value: 'Printed name', page: 1 }, sourceRef: { value: 'Printed reference', page: 1 },
      financeOfficer: { value: 'Printed finance', page: 1 }, requestDate: { value: '2026-11-24', page: 1 } },
    rows: [
      { page: 1, name: 'Steel Mesh', unit: 'sheets', quantity: '2.125', purpose: 'test work', location: 'site' },
      { page: 2, name: 'Steel mesh', unit: 'sheets', quantity: '2.126', purpose: 'test work', location: 'site' },
      { page: 2, name: 'Steel mesh', unit: 'sheets', quantity: '2.1260', purpose: 'test work', location: 'site' },
    ],
  });
  const result = fillMrfDraft(draft, proposal, proposalId, () => proposalId);
  assert.equal(result.draft.requestedBy, draft.requestedBy);
  assert.equal(result.draft.sourceRef, draft.sourceRef);
  assert.equal(result.draft.requestDate, '2026-11-24');
  assert.equal(result.draft.financeOfficer, 'Printed finance');
  assert.deepEqual(result.draft.items.map(row => row.quantity), ['02.1250', '2.126']);
  assert.equal(fillMrfDraft(result.draft, proposal, proposalId, () => assert.fail('Repeated autofill should append nothing')).applied.rowIds.length, 0);
  assert.deepEqual(removeMrfProposal({ ...result.draft, financeOfficer: 'Corrected name', specialInstructions: 'Manual edit' }, result.applied),
    { ...draft, financeOfficer: 'Corrected name', specialInstructions: 'Manual edit' });
});

test('guarded draft saves preserve the extraction proposal identity', () => {
  const command = { type: 'saveDraft', draft: emptyMrfDraft(), requestId: proposalId, mrfId: proposalId, expectedVersion: '1' };
  assert.deepEqual(parseDraftCommand(command), command);
  assert.deepEqual(parseDraftCommand({ ...command, extractionProposalId: proposalId }), { ...command, extractionProposalId: proposalId });
  assert.equal(parseDraftCommand({ ...command, extractionProposalId: 'invalid' }), null);
});
