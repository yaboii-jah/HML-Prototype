import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseMrfWorkflow, mrfEditable, mrfUnderReview, mrfStatusLabel } from '../src/domain/requests/workflow.ts';
import { parseDocumentsView } from '../src/domain/requests/documents.ts';

const draft = () => ({ status: 'draft', correctionKind: null, correctionState: null, submissionId: null, submitted: null, procurementReady: false, submitterIds: [], history: [] });
test('workflow projections retain immutable submitting identities and reject malformed history', () => {
  const submitter = randomUUID();
  const value = { ...draft(), status: 'submitted', submissionId: randomUUID(), submitted: { projectName: 'Frozen project', projectLocation: 'Frozen location' }, submitterIds: [submitter],
    history: [{ id: randomUUID(), action: 'submitted', reason: '', actorId: submitter, actorName: 'Historical name', actorRole: 'Site Personnel', createdAt: '2026-11-03T00:00:00Z' }] };
  assert.deepEqual(parseMrfWorkflow(value), value);
  assert.equal(parseMrfWorkflow({ ...value, submitterIds: ['printed name'] }), null);
  assert.equal(parseMrfWorkflow({ ...value, history: [{ ...value.history[0], actorId: '' }] }), null);
  assert.equal(parseMrfWorkflow({ ...value, correctionKind: 'documents' }), null);
});
test('initial and correction states distinguish editable work from exact submissions', () => {
  assert.equal(mrfEditable(draft()), true);
  assert.equal(mrfEditable({ ...draft(), status: 'returned' }), true);
  for (const status of ['submitted', 'approved', 'rejected']) assert.equal(mrfEditable({ ...draft(), status }), false);
  for (const correctionKind of ['full', 'documents']) {
    const correction = { ...draft(), status: 'approved', correctionKind, correctionState: 'editing' };
    assert.equal(mrfEditable(correction), true);
    assert.equal(mrfUnderReview(correction), false);
    assert.equal(mrfEditable({ ...correction, correctionState: 'submitted' }), false);
    assert.equal(mrfUnderReview({ ...correction, correctionState: 'submitted' }), true);
    assert.match(mrfStatusLabel(correction), /correction/);
  }
});
test('approved archive projections expose opaque files and preserve distinct versions', () => {
  const archive = { id: randomUUID(), version: '2', approvedBy: 'Verified approver', approvedAt: '2026-11-03T00:00:00Z', complete: true,
    files: [{ id: randomUUID(), kind: 'form' }, { id: randomUUID(), kind: 'supporting' }] };
  const view = { revision: '3', current: null, folder: null, uploads: [], jobs: [], editable: false, archives: [archive] };
  assert.deepEqual(parseDocumentsView(view)?.archives, [archive]);
  assert.equal(parseDocumentsView({ ...view, archives: [{ ...archive, files: [{ id: 'provider-file-id', kind: 'form' }] }] }), null);
  assert.equal(parseDocumentsView({ ...view, archives: [{ ...archive, files: [{ id: randomUUID(), kind: 'arbitrary' }] }] }), null);
});
