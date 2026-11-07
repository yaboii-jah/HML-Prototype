import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { requireStaging } from './helpers/supabase-target.mjs';
import { verificationSource } from './helpers/verification-evidence.mjs';
import { driveAccessToken } from '../src/server/documents/drive-auth.ts';
import { createDriveGateway } from '../src/server/documents/drive-gateway.ts';
import { validateSupportingPdf } from '../src/server/documents/pdf-validation.ts';
import sharp from 'sharp';
import { validateQuotationOriginal } from '../src/server/quotations/original-validation.ts';
import { generatePurchasingComparisonPdf, generatePurchasingComparisonWorkbook, generatePurchasingPoPreview, XLSX_MIME } from '../src/server/purchasing/documents.ts';
import { purchasingFixture } from '../tests/helpers/purchasing.mjs';
import { comparisonSnapshot, calculatePo } from '../src/domain/purchasing/pricing.ts';

requireStaging(process.env);
if (process.argv.length !== 2 || process.env.GOOGLE_DRIVE_ENABLED !== 'true' || process.env.DOCUMENT_DRIVE_TEST_ORIGIN) throw Error('Use explicitly configured staging Drive without test overrides.');
const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
if (!root || !/^[\w-]{10,}$/.test(root)) throw Error('Configure the test Drive root.');
await mkdir('.verification', { recursive: true });
const source = await verificationSource(), drive = createDriveGateway('https://www.googleapis.com', driveAccessToken);
const run = randomUUID(), tags = { hmlSmokeRun: run, hmlKind: 'disposable-document-smoke' };
const result = { ...source, passed: false, complete: false, cleaned: false, checks: [] };
let folderId;
try {
  const parent = await drive.get(root); assert.equal(parent.mimeType, 'application/vnd.google-apps.folder'); assert.equal(parent.writable, true); assert.equal(parent.trashed, false);
  folderId = await drive.generateId();
  await writeFile('.verification/document-drive-smoke-owner.json', JSON.stringify({ folderId, tags, run }));
  await drive.ensureFolder(folderId, root, 'ConstructSync disposable document smoke ' + run, tags);
  await drive.validateFolder(folderId, root);
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic ConstructSync document gateway verification.');
  const bytes = await pdf.save(), sha256 = createHash('sha256').update(bytes).digest('hex'), id = await drive.generateId();
  const uri = await drive.begin(id, folderId, 'synthetic-support.pdf', bytes.length, tags);
  assert.ok(uri); assert.equal((await drive.transfer(uri, bytes.length)).offset, 0);
  assert.equal((await drive.transfer(uri, bytes.length, bytes, 0)).complete, true);
  const verified = await drive.verifyPdf(id, folderId, tags, bytes.length, sha256);
  await validateSupportingPdf(verified);
  const range = await drive.stream(id, { start: 0, end: 4 }); assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-');
  assert.equal((await drive.ensureFolder(folderId, root, 'same owned folder', tags)).id, folderId);
  result.checks.push('folder-create-retry', 'resumable-offset', 'upload-byte-hash', 'readable-pdf', 'stream-range');
  for (const [format, mime] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#165c43' } }).toFormat(format).toBuffer();
    const fileId = await drive.generateId(), hash = createHash('sha256').update(image).digest('hex');
    const session = await drive.begin(fileId, folderId, 'synthetic-quotation.' + format, image.length, tags, mime);
    assert.ok(session);
    assert.equal((await drive.transfer(session, image.length, image, 0, mime)).complete, true);
    await validateQuotationOriginal(await drive.verifyFile(fileId, folderId, tags, image.length, hash, mime), mime);
    const part = await drive.stream(fileId, { start: 0, end: 4 });
    assert.equal(part.status, 206);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), image.subarray(0, 5));
  }
  result.checks.push('quotation-mixed-originals');
  const fixture = purchasingFixture();
  const comparison = comparisonSnapshot(fixture.view, [], 'Synthetic gateway smoke', new Date().toISOString());
  for (const [format, mime, content] of [
    ['pdf', 'application/pdf', await generatePurchasingComparisonPdf(comparison, '1')],
    ['xlsx', XLSX_MIME, await generatePurchasingComparisonWorkbook(comparison, '1')],
  ]) {
    const artifactId = await drive.generateId(), hash = createHash('sha256').update(content).digest('hex');
    const session = await drive.begin(artifactId, folderId, 'synthetic-comparison.' + format, content.length, tags, mime);
    assert.ok(session); assert.equal((await drive.transfer(session, content.length, content, 0, mime)).complete, true);
    const actual = await drive.verifyFile(artifactId, folderId, tags, content.length, hash, mime);
    assert.deepEqual(Buffer.from(actual), Buffer.from(content));
    if (format === 'pdf') await validateSupportingPdf(actual);
    const part = await drive.stream(artifactId, { start: 0, end: 4 });
    assert.equal(part.status, 206); assert.deepEqual(Buffer.from(await part.arrayBuffer()), Buffer.from(content).subarray(0, 5));
  }
  result.checks.push('purchasing-comparison-artifacts');
  fixture.order.payment = { mode: 'upfront', dueDate: '', relation: 'differs', reason: 'Synthetic supplier agreed upfront payment' };
  const po = { id: randomUUID(), kind: 'po', ref: 'SYNTHETIC-PO-0001', version: '1', quoteId: fixture.q.id,
    mrfId: fixture.q.mrfId, body: fixture.order, updatedAt: comparison.createdAt, blockers: [], calculation: calculatePo(fixture.q, fixture.order) };
  const approved = await generatePurchasingPoPreview(fixture.view, po, { name: 'Synthetic Accounting reviewer', at: comparison.createdAt, version: '1' });
  const approvedId = await drive.generateId(), approvedHash = createHash('sha256').update(approved).digest('hex');
  const approvedSession = await drive.begin(approvedId, folderId, 'synthetic-approved-po.pdf', approved.length, tags, 'application/pdf');
  assert.ok(approvedSession);
  assert.equal((await drive.transfer(approvedSession, approved.length, approved, 0, 'application/pdf')).complete, true);
  const verifiedApproved = await drive.verifyPdf(approvedId, folderId, tags, approved.length, approvedHash);
  await validateSupportingPdf(verifiedApproved);
  assert.deepEqual(Buffer.from(verifiedApproved), Buffer.from(approved));
  const approvedRange = await drive.stream(approvedId, { start: 0, end: 4 });
  assert.equal(approvedRange.status, 206); assert.equal(await approvedRange.text(), '%PDF-');
  result.checks.push('approved-po-pdf');
  result.passed = true;
} finally {
  if (folderId) {
    try { await drive.trash(folderId, tags); result.cleaned = true; }
    catch { result.passed = false; console.error('Owned smoke folder cleanup failed. Follow up using .verification/document-drive-smoke-owner.json.'); }
  }
  result.complete = result.passed && result.cleaned;
  await writeFile('.verification/document-drive-live.json', JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2));
  if (!result.complete) process.exitCode = 1;
}
if (result.complete) console.log('Real Drive gateway folder/upload/hash/Range checks passed; owned smoke folder trashed and verified. No retained MRF references were created.');
