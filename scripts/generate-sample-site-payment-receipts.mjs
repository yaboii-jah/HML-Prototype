// Run: node scripts/generate-sample-site-payment-receipts.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const directory = path.resolve('sample-data/site-payment-receipts');
const samples = [
  { supplier: 'Meridian Doors and Fittings, Inc.', short: 'Meridian', method: 'Bank transfer', amount: 58200, item: 'Tempered glass panel, 10mm clear, 900 x 2100mm', quantity: '12 PCS', representative: 'Demo Meridian Representative' },
  { supplier: 'Apex Architectural Hardware Corp.', short: 'Apex', method: 'Cleared check', amount: 83880, item: 'Frameless glass door hardware set, stainless', quantity: '12 SET', representative: 'Demo Apex Representative' },
  { supplier: 'Kestrel Glass Systems Co.', short: 'Kestrel', method: 'Bank transfer', amount: 50540, item: 'Shower partition panel, 8mm tempered, H 2000mm', quantity: '14 PCS', representative: 'Demo Kestrel Representative' },
  { supplier: 'Summit Building Supply Trading', short: 'Summit', method: 'Cash', amount: 86700, item: 'Stainless door pull handle, 1000mm, brushed', quantity: '30 PCS', representative: 'Demo Summit Representative' },
];
const ink = rgb(.10, .18, .26), muted = rgb(.38, .44, .50), accent = rgb(.08, .39, .34);
const money = value => 'PHP ' + value.toLocaleString('en-US', { minimumFractionDigits: 2 });
await mkdir(directory, { recursive: true });
let totalBytes = 0;
for (const [index, sample] of samples.entries()) {
  const sequence = String(index + 1).padStart(2, '0');
  const reference = `SAMPLE-SITE-RCPT-372-${sequence}`;
  const doc = await PDFDocument.create();
  doc.setTitle(`SAMPLE - ${sample.short} site payment receipt`);
  doc.setSubject('Fictional payment acknowledgment after site delivery; app testing only');
  doc.setAuthor('ConstructSync sample data');
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const text = (value, x, y, size = 11, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
  const line = y => page.drawLine({ start: { x: 44, y }, end: { x: 551, y }, thickness: .6, color: rgb(.83, .87, .90) });
  const field = (label, value, y) => { text(label.toUpperCase(), 44, y, 9, bold, muted); text(value, 44, y - 20, 11); };
  page.drawRectangle({ x: 0, y: 766, width: 595.28, height: 76, color: ink });
  text('SAMPLE - FOR APP TESTING ONLY', 44, 804, 12, bold, rgb(1, 1, 1));
  text('Fictional receipt / Not valid as financial or delivery evidence', 44, 783, 9, regular, rgb(.80, .86, .92));
  text('Payment receipt', 44, 727, 25, bold);
  text('Payment acknowledged after delivery to the site', 44, 702, 11, regular, muted);
  text(reference, 44, 680, 10, bold, accent);
  line(662);
  field('Supplier / received by', sample.supplier, 640);
  field('Paid by', 'ConstructSync Demo Company (fictional payer)', 592);
  field('Project / related request', 'Marina Skyline Residences - Tower B / MRF-372', 544);
  text('Site: 1045 EDSA, Brgy. 143, Pasay City, Metro Manila', 44, 507, 10, regular, muted);
  text('Receiving area: 3rd Floor Staging Area', 44, 490, 10, regular, muted);
  line(475);
  text('DELIVERY DATE', 44, 453, 9, bold, muted);
  text('October 30, 2026 / 09:30 AM', 44, 433, 11);
  text('DELIVERY REFERENCE', 315, 453, 9, bold, muted);
  text(`SAMPLE-DR-372-${sequence}`, 315, 433, 11);
  page.drawRectangle({ x: 44, y: 355, width: 507, height: 58, color: rgb(.94, .96, .98) });
  text('DELIVERED MATERIAL', 56, 395, 9, bold, muted);
  text('QTY RECEIVED', 452, 395, 9, bold, muted);
  text(sample.item, 56, 372, 10);
  text(sample.quantity, 452, 372, 10, bold);
  text('Site receiver: Demo Site Receiving Personnel', 44, 338, 10);
  text('Sample condition: Delivered quantity accepted; no shortage recorded.', 44, 320, 10, regular, muted);
  line(304);
  text('PAYMENT DATE / METHOD', 44, 283, 9, bold, muted);
  text(`October 30, 2026 / ${sample.method}`, 44, 263, 11);
  text('PAYMENT REFERENCE', 315, 283, 9, bold, muted);
  text(`SAMPLE-PAY-372-${sequence}`, 315, 263, 11);
  page.drawRectangle({ x: 44, y: 190, width: 507, height: 56, color: rgb(.92, .96, .94) });
  text('SAMPLE PAYMENT RECEIVED', 57, 225, 9, bold, muted);
  text(money(sample.amount), 57, 204, 20, bold, accent);
  text('Supplier acknowledgment: ' + sample.representative, 44, 172, 10);
  text('Acknowledges receipt of the sample payment after site delivery.', 44, 155, 10);
  text('No actual payment or delivery occurred. No authentic signature provided.', 44, 137, 9, regular, muted);
  line(119);
  text('Illustrative scenario and amount; not a statement of the quotation or PO balance.', 44, 98, 9, regular, muted);
  text('Not a tax invoice, BIR certificate, or replacement for a delivery receipt.', 44, 82, 9, regular, muted);
  text('SAMPLE - FOR APP TESTING ONLY', 44, 47, 10, bold, accent);
  const bytes = await doc.save();
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length >= 12 && bytes.length <= 20 * 1024 * 1024);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  const filename = `${sequence} ${sample.short} - Site Delivery Payment Receipt.pdf`;
  await writeFile(path.join(directory, filename), bytes);
  totalBytes += bytes.length;
  console.log(`${filename}: valid single-page PDF (${bytes.length} bytes)`);
}
assert.ok(totalBytes <= 45 * 1024 * 1024);
console.log(`All four receipts meet the app upload limits (${totalBytes} bytes total).`);
