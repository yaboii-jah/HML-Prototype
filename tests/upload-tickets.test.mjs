import test from 'node:test';
import assert from 'node:assert/strict';
import { sealDriveUploadTicket, openDriveUploadTicket } from '../src/server/drive-upload-ticket.ts';
import { sealQuoteUploadTicket, openQuoteUploadTicket } from '../src/server/quote-upload-ticket.ts';
import { sealBidUploadTicket, openBidUploadTicket } from '../src/server/bid-upload-ticket.ts';
import { sealAccountingUploadTicket, openAccountingUploadTicket } from '../src/server/accounting-upload-ticket.ts';
import { sealTransferUploadTicket, openTransferUploadTicket } from '../src/server/transfer-upload-ticket.ts';

test('upload capabilities remain purpose-specific, tamper resistant, expiring and bounded', t => {
  const prior = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
  process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  const clock = Date.now;
  t.after(() => { Date.now = clock; if (prior === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY; else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = prior; });
  const common = { total: 20, sessionUri: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test' };
  const kinds = [
    [sealDriveUploadTicket, openDriveUploadTicket, { ...common, requestId: 'request', version: 1, formFileId: 'form', formUrl: 'form-url' }],
    [sealQuoteUploadTicket, openQuoteUploadTicket, { ...common, quoteId: 'quote', fileIndex: 0, mime: 'application/pdf' }],
    [sealBidUploadTicket, openBidUploadTicket, { ...common, reportId: 'report', format: 'pdf' }],
    [sealAccountingUploadTicket, openAccountingUploadTicket, { ...common, documentId: 'document', poId: 'po', mime: 'application/pdf' }],
    [sealTransferUploadTicket, openTransferUploadTicket, { ...common, documentId: 'document', transferId: 'transfer', deliveryId: 'delivery', mime: 'application/pdf' }],
  ];
  const encoded = kinds.map(([seal, , input]) => seal(input));
  kinds.forEach(([, open], index) => {
    assert.equal(open(encoded[index]).total, 20);
    for (let other = 0; other < kinds.length; other++) if (other !== index) assert.throws(() => open(encoded[other]), /invalid/);
    const damaged = Buffer.from(encoded[index], 'base64url'); damaged[28] ^= 1;
    assert.throws(() => open(damaged.toString('base64url')), /invalid/);
    assert.throws(() => open('x'.repeat(8193)), /invalid/);
  });
  Date.now = () => clock() + 61 * 60 * 1000;
  for (const [, open] of kinds) for (const value of encoded) assert.throws(() => open(value), /invalid/);
});
