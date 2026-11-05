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
