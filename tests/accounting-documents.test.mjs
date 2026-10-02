import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/mock/fixtures/seed.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { accountingGroups, accountingSignature, MAX_ACCOUNTING_FILE } from '../src/domain/accounting-documents.ts';
import { openAccountingUploadTicket, sealAccountingUploadTicket } from '../src/server/accounting-upload-ticket.ts';

const document = { name: 'Receipt.pdf', kind: 'Payment receipt', mime: 'application/pdf', size: 1024, localFileId: 'receipt-file', sha256: 'a'.repeat(64) };
function fixture() {
  const state = seedDemo(); state.role = 'Site Personnel';
  const batch = state.batches.find(value => value.status !== 'expected');
  assert.ok(batch); state.pos.find(value => value.id === batch.poId).status = 'served';
  return { state, batch, command: { type: 'attachAccountingDocuments', poId: batch.poId, batchId: batch.id, documents: [document] } };
}
test('received evidence belongs to its batch/PO and reopens a completed review without recording payment', () => {
  const { state, batch, command } = fixture();
  let account = state.accounting.find(value => value.poId === batch.poId);
  if (!account) { account = { poId: batch.poId, invoiceRef: 'INV', receiptRef: 'REC', note: 'Reviewed', review: 'Complete' }; state.accounting.push(account); }
  account.review = 'Complete';
  const result = applyCommand(state, command); assert.equal(result.ok, true, result.message);
  const record = result.snapshot.accounting.find(value => value.poId === batch.poId);
  assert.equal(record.review, 'Under Review');
  assert.equal(record.documents[0].batchId, batch.id);
  assert.equal(record.documents[0].uploadedBy, 'Site Personnel');
  assert.equal(record.documents[0].archive.status, 'pending');
  assert.deepEqual(result.snapshot.payments, state.payments);
  assert.deepEqual(result.snapshot.movements, state.movements);
});
test('upload commands reject wrong roles, unreceived batches, cross-PO evidence and invalid file limits', () => {
  const { state, command } = fixture();
  for (const role of ['Procurement','Finance','Accounting / Auditing','Administrator']) assert.equal(applyCommand({ ...state, role }, command).ok, false);
  const expected = structuredClone(state); expected.batches.find(value => value.id === command.batchId).status = 'expected';
  assert.equal(applyCommand(expected, command).ok, false);
  assert.equal(applyCommand(state, { ...command, poId: 'another-po' }).ok, false);
  for (const changed of [{ mime: 'text/html' }, { size: MAX_ACCOUNTING_FILE + 1 }, { sha256: 'invalid' }]) assert.equal(applyCommand(state, { ...command, documents: [{ ...document, ...changed }] }).ok, false);
  assert.equal(applyCommand(state, { ...command, documents: Array.from({ length: 13 }, (_, i) => ({ ...document, localFileId: `file-${i}` })) }).ok, false);
  assert.equal(applyCommand(state, { ...command, documents: [0,1,2].map(i => ({ ...document, localFileId: `large-${i}`, size: 16 * 1024 * 1024 })) }).ok, false);
});
test('archive retries preserve evidence and an acknowledged archive cannot become failed', () => {
  const { state, command } = fixture(); let result = applyCommand(state, command); assert.equal(result.ok,true);
  const attachment = result.snapshot.accounting.find(value => value.poId === command.poId).documents[0];
  result = applyCommand(result.snapshot, { type: 'failAccountingArchive', poId: command.poId, documentId: attachment.id, error: 'Offline' });
  assert.equal(result.snapshot.accounting.find(value => value.poId === command.poId).documents[0].localFileId, document.localFileId);
  result = applyCommand({ ...result.snapshot, role: 'Accounting / Auditing' }, { type: 'completeAccountingArchive', poId: command.poId, documentId: attachment.id, fileId: 'drive-receipt', url: 'https://drive.google.com/file/d/drive-receipt/view' });
  assert.equal(result.ok,true,result.message);
  result = applyCommand(result.snapshot, { type: 'failAccountingArchive', poId: command.poId, documentId: attachment.id, error: 'Late failure' });
  const archived = result.snapshot.accounting.find(value => value.poId === command.poId).documents[0];
  assert.equal(archived.archive.status,'complete'); assert.equal(archived.archive.error,undefined);
  assert.equal(applyCommand(result.snapshot, command).ok,false);
});
test('Accounting groups include drafts and rejected POs and support MRF, supplier and project filtering', () => {
  const state = seedDemo(); state.siteFilter = 'all';
  const request = state.requests.find(value => value.id === state.pos[0].mrfId);
  state.pos.push({ ...structuredClone(state.pos[0]), id: 'draft-split', ref: 'SPLIT-DRAFT', status: 'draft' }, { ...structuredClone(state.pos[0]), id: 'rejected-split', ref: 'SPLIT-REJECTED', status: 'rejected' });
  const grouped = accountingGroups(state, request.ref);
  assert.ok(grouped[0].pos.some(value => value.id === 'draft-split'));
  assert.ok(grouped[0].pos.some(value => value.id === 'rejected-split'));
  assert.equal(accountingGroups(state, 'SPLIT-DRAFT')[0].pos.length,1);
  state.siteFilter = state.sites.find(value => value.id !== request.siteId).id;
  assert.equal(accountingGroups(state, request.ref).length,0);
  assert.equal(state.accounting.some(value => value.documents),false,'Legacy records remain readable without document metadata');
});
test('document signatures reject disguised files and upload tickets are bounded and tamper resistant', () => {
  assert.equal(accountingSignature(new TextEncoder().encode('%PDF-1.4\nfile'), 'application/pdf'),true);
  assert.equal(accountingSignature(new TextEncoder().encode('<html>fake'), 'application/pdf'),false);
  assert.equal(accountingSignature(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'),true);
  assert.equal(accountingSignature(new Uint8Array([137]),'image/png'),false);
  const previous = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = Buffer.alloc(32,7).toString('base64');
  try {
    const input = { documentId:'document-1',poId:'po-1',batchId:'batch-1',total:1024,mime:'application/pdf',sessionUri:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=evidence' };
    const ticket = sealAccountingUploadTicket(input); assert.equal(openAccountingUploadTicket(ticket).documentId,input.documentId);
    assert.throws(() => openAccountingUploadTicket(`${ticket[0]==='A'?'B':'A'}${ticket.slice(1)}`),/invalid/);
    assert.throws(() => sealAccountingUploadTicket({ ...input,total:MAX_ACCOUNTING_FILE+1 }),/invalid/);
    assert.throws(() => sealAccountingUploadTicket({ ...input,sessionUri:'https://evil.test/upload' }),/invalid/);
  } finally { if (previous === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = previous; }
});
