import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { requireStaging } from './helpers/supabase-target.mjs';
import { verificationSource } from './helpers/verification-evidence.mjs';
import { driveAccessToken } from '../src/server/documents/drive-auth.ts';
import { createDriveGateway } from '../src/server/documents/drive-gateway.ts';
import { validateSupportingPdf } from '../src/server/documents/pdf-validation.ts';
import { renderReceiptPdf } from '../src/server/delivery-receipt-pdf.ts';
import sharp from 'sharp';
import { validateQuotationOriginal } from '../src/server/quotations/original-validation.ts';
import { generatePurchasingComparisonPdf, generatePurchasingComparisonWorkbook, generatePurchasingPoPreview, XLSX_MIME } from '../src/server/purchasing/documents.ts';
import { purchasingFixture } from '../tests/helpers/purchasing.mjs';
import { verifySendingFiles } from '../src/server/purchasing/issuance-files.ts';
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
  const requestFolder = await drive.generateId(), supportingFolder = await drive.generateId();
  await drive.ensureFolder(requestFolder, folderId, 'SYNTHETIC-MRF-0001', tags);
  await drive.ensureFolder(supportingFolder, requestFolder, 'Supporting Documents', tags);
  const poFolder = await drive.generateId();
  await Promise.all([
    drive.ensureFolder(poFolder, requestFolder, 'Purchase Orders', tags),
    drive.ensureFolder(poFolder, requestFolder, 'Purchase Orders', tags),
  ]);
  assert.deepEqual((await drive.get(poFolder)).parents, [requestFolder]);
  result.checks.push('nested-request-folder-retry');
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic ConstructSync document gateway verification.');
  const bytes = await pdf.save(), sha256 = createHash('sha256').update(bytes).digest('hex'), id = await drive.generateId();
  const uri = await drive.begin(id, supportingFolder, 'synthetic-support.pdf', bytes.length, tags);
  assert.ok(uri); assert.equal((await drive.transfer(uri, bytes.length)).offset, 0);
  assert.equal((await drive.transfer(uri, bytes.length, bytes, 0)).complete, true);
  const verified = await drive.verifyPdf(id, supportingFolder, tags, bytes.length, sha256);
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
  const issuanceFiles = [];
  const archiveId = randomUUID(), approvalId = randomUUID();
  for (const kind of ['approved-mrf', 'approved-support', 'approved-po']) {
    const fileId = await drive.generateId();
    const fileTags = { ...tags, hmlKind: kind, ...(kind === 'approved-po'
      ? { hmlPoArchive: archiveId, hmlPoApproval: approvalId } : { hmlSnapshotId: archiveId }) };
    const parent = kind === 'approved-po' ? poFolder : supportingFolder;
    const session = await drive.begin(fileId, parent, 'synthetic-issuance-' + kind + '.pdf', approved.length, fileTags);
    assert.ok(session); assert.equal((await drive.transfer(session, approved.length, approved)).complete, true);
    issuanceFiles.push({ id: fileId, tags: fileTags, size: String(approved.length), sha256: approvedHash,
      ...(kind === 'approved-po' ? { parent } : {}) });
  }
  const issuanceProof = { approvalId, mrfArchiveId: archiveId, poArchiveId: archiveId, files: issuanceFiles };
  await verifySendingFiles(issuanceProof, drive);
  await assert.rejects(verifySendingFiles({ ...issuanceProof, files: issuanceFiles.map((f, i) => i === 2 ? { ...f, sha256: '0'.repeat(64) } : f) }, drive));
  result.checks.push('supplier-issuance-files');
  const receipt = await renderReceiptPdf({
    title:'DELIVERY RECEIPT', ref:'SYNTHETIC-DEL-0001', stage:'Receipt version 2', received:true,
    generatedAt:comparison.createdAt,
    fields:[{ label:'ARRIVAL', value:comparison.createdAt }],
    materials:[{ name:'Synthetic material', unit:'box', expected:'3', accepted:'2.5',
      issue:'Missing 0.25; rejected 0.25. Accepted in request units: 25 pcs.' }],
    footerFields:[], signatureLabels:['Dispatched by','Received by'],
  });
  const receiptVersion = randomUUID();
  for (const [kind, content] of [['generated',receipt],['signed',bytes]]) {
    const fileId = await drive.generateId();
    const receiptTags = { hmlReceiptFile:randomUUID(), hmlReceiptVersion:receiptVersion };
    const session = await drive.begin(fileId,folderId,`synthetic-receipt-${kind}.pdf`,content.length,receiptTags);
    assert.ok(session);
    assert.equal((await drive.transfer(session,content.length,content)).complete,true);
    const actual = await drive.verifyPdf(fileId,folderId,receiptTags,content.length,createHash('sha256').update(content).digest('hex'));
    assert.deepEqual(Buffer.from(actual),Buffer.from(content));
    await validateSupportingPdf(actual);
    const part = await drive.stream(fileId,{ start:0,end:4 });
    assert.equal(part.status,206);
    assert.equal(await part.text(),'%PDF-');
  }
  result.checks.push('purchased-receipt-archive');
  const transferReceipt = await renderReceiptPdf({
    title:'STOCK TRANSFER RECEIPT',ref:'SYNTHETIC-DEL-0002',stage:'Receipt version 1',received:true,
    generatedAt:comparison.createdAt,fields:[{ label:'TRANSFER / MRF',value:'SYNTHETIC-TRF / SYNTHETIC-MRF' }],
    materials:[{ name:'Synthetic transfer material',unit:'bag',expected:'4',accepted:'3.8',
      issue:'Missing 0; rejected 0.2. Accepted in request units: 3.8 bags.' }],
    footerFields:[],signatureLabels:['Dispatched by','Received by'],
  });
  const conditionPhoto = await sharp({ create:{ width:20,height:20,channels:3,background:'#bcb7a5' } }).png().toBuffer();
  const transferVersion = randomUUID();
  for (const { name,content,mime } of [
    { name:'generated.pdf',content:transferReceipt,mime:'application/pdf' },
    { name:'signed.pdf',content:bytes,mime:'application/pdf' },
    { name:'condition.png',content:conditionPhoto,mime:'image/png' },
  ]) {
    const id = await drive.generateId();
    const evidenceTags = { hmlTransferReceiptFile:randomUUID(),hmlTransferReceiptVersion:transferVersion };
    const uri = await drive.begin(id,folderId,`synthetic-transfer-${name}`,content.length,evidenceTags,mime);
    assert.ok(uri);
    assert.equal((await drive.transfer(uri,content.length,content,0,mime)).complete,true);
    const archived = await drive.verifyFile(id,folderId,evidenceTags,content.length,createHash('sha256').update(content).digest('hex'),mime);
    assert.deepEqual(Buffer.from(archived),Buffer.from(content));
    await validateQuotationOriginal(archived,mime);
    const range = await drive.stream(id,{ start:0,end:4 });
    assert.equal(range.status,206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.from(content.subarray(0,5)));
  }
  result.checks.push('transfer-receipt-archive');
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
