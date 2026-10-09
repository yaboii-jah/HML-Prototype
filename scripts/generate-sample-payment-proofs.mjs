// Run: node scripts/generate-sample-payment-proofs.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const directory = path.resolve('sample-data/payment-proofs');
const samples = [
  { file: '01 Meridian - Bank Transfer Confirmation.pdf', title: 'Bank transfer confirmation', supplier: 'Meridian Doors and Fittings, Inc.', method: 'Bank transfer', reference: 'SAMPLE-TRF-372-001', amount: 125000, detail: 'Transfer channel: Example Bank online transfer', receipt: 'Beneficiary account: TEST ACCOUNT / ending 0001' },
  { file: '02 Apex - Check Payment Acknowledgment.pdf', title: 'Check payment acknowledgment', supplier: 'Apex Architectural Hardware Corp.', method: 'Check', reference: 'SAMPLE-CHK-372-002', amount: 98000, detail: 'Check number: TEST-000002 / Example Bank', receipt: 'Sample status: Check cleared; receipt acknowledged' },
  { file: '03 Kestrel - Bank Deposit Acknowledgment.pdf', title: 'Bank deposit acknowledgment', supplier: 'Kestrel Glass Systems Co.', method: 'Bank', reference: 'SAMPLE-DEP-372-003', amount: 146500, detail: 'Deposit channel: Example Bank counter deposit', receipt: 'Beneficiary account: TEST ACCOUNT / ending 0003' },
  { file: '04 Summit - Cash Payment Receipt.pdf', title: 'Cash payment receipt', supplier: 'Summit Building Supply Trading', method: 'Cash', reference: 'SAMPLE-CASH-372-004', amount: 42500, detail: 'Receipt number: SAMPLE-RCPT-000004', receipt: 'Sample status: Cash received and acknowledged' },
];
const ink = rgb(.10, .18, .26), muted = rgb(.38, .44, .50), blue = rgb(.15, .32, .51);
const money = amount => 'PHP ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2 });
await mkdir(directory, { recursive: true });
let totalBytes = 0;
for (const sample of samples) {
  const doc = await PDFDocument.create();
  doc.setTitle('SAMPLE - ' + sample.title);
  doc.setSubject('Fictional payment proof for ConstructSync app testing only');
  doc.setAuthor('ConstructSync sample data');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const text = (value, x, y, size = 11, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
  const line = y => page.drawLine({ start: { x: 44, y }, end: { x: 551, y }, thickness: .6, color: rgb(.83, .87, .90) });
  page.drawRectangle({ x: 0, y: 757, width: 595.28, height: 85, color: ink });
  text('SAMPLE - FOR APP TESTING ONLY', 44, 804, 12, bold, rgb(1, 1, 1));
  text('Fictional transaction / Not valid as financial evidence', 44, 782, 10, regular, rgb(.80, .86, .92));
  text(sample.title, 44, 710, 23, bold);
  text('Payment reference: ' + sample.reference, 44, 684, 10, regular, muted);
  line(659);
  const field = (label, value, y) => {
    text(label.toUpperCase(), 44, y, 9, bold, muted);
    text(value, 44, y - 21, 12);
  };
  field('Paid by', 'ConstructSync Demo Company (fictional payer)', 630);
  field('Paid to', sample.supplier, 573);
  field('Project', 'Marina Skyline Residences - Tower B', 516);
  text('Related material request: MRF-372', 44, 474, 11, regular, muted);
  line(455);
  text('PAYMENT DATE', 44, 431, 9, bold, muted);
  text('October 9, 2026', 44, 410, 12);
  text('PAYMENT METHOD', 315, 431, 9, bold, muted);
  text(sample.method, 315, 410, 12);
  page.drawRectangle({ x: 44, y: 299, width: 507, height: 82, color: rgb(.94, .96, .98) });
  text('SAMPLE AMOUNT PAID TO SUPPLIER', 61, 355, 9, bold, muted);
  text(money(sample.amount), 61, 323, 26, bold, blue);
  text(sample.detail, 44, 271, 10);
  text(sample.receipt, 44, 251, 10);
  line(229);
  text('Acknowledgment', 44, 205, 13, bold);
  text('Fictional receipt of the sample payment shown above.', 44, 182, 11);
  text('Acknowledged by: Demo Accounts Representative', 44, 161, 11);
  text('No actual transfer, deposit, check or cash payment occurred.', 44, 140, 10, regular, muted);
  line(112);
  text('Illustrative amount; reconcile actual payment proof to the approved PO.', 44, 89, 9, regular, muted);
  text('Not a bank-issued document, official receipt or BIR withholding certificate.', 44, 74, 9, regular, muted);
  text('SAMPLE - FOR APP TESTING ONLY', 44, 45, 10, bold, blue);
  const bytes = await doc.save();
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length >= 12 && bytes.length <= 20 * 1024 * 1024);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await writeFile(path.join(directory, sample.file), bytes);
  totalBytes += bytes.length;
  console.log(`${sample.file}: ${bytes.length} bytes, valid single-page PDF`);
}
assert.ok(totalBytes <= 45 * 1024 * 1024);
console.log(`All four proofs fit the app upload limits (${totalBytes} bytes total).`);
