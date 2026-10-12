// Run: node --experimental-strip-types scripts/generate-taguig-sample-pack.mjs
// Generates sample PDFs only; it does not create projects or advance app document counters.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { generateMrfPdf } from '../src/server/template-mrf-pdf.ts';
import { documentDate, documentMoney, wrapText } from '../src/server/document-template.ts';
import { quotationLineAmount, quoteFinancialBreakdown, roundMoney } from '../src/domain/pricing.ts';

const output = path.join(process.cwd(), 'sample-data/taguig-city-rehabilitation');
const project = { name: 'Taguig City Rehabilitation', location: 'Taguig City, Metro Manila', scope: 'Architectural' };
const reference = 'TCR-SAMPLE-001'; // Paper/source reference, not an issued ConstructSync number.
const requestDate = '2026-10-12', neededDate = '2026-10-26', validUntil = '2026-11-11';
const mrfFile = `MRF ${reference} - Material Request and Key Plan.pdf`;
const materials = [
  ['CONCRETE PRIMER, WATER-BASED, 16 L', 'PAIL', 12],
  ['INTERIOR LATEX PAINT, WHITE, 16 L', 'PAIL', 18],
  ['ACRYLIC WALL PUTTY, 20 kg', 'BAG', 24],
  ['PORCELAIN FLOOR TILE, 600 x 600 mm, 4 PCS/BOX', 'BOX', 40],
  ['CEMENT-BASED TILE ADHESIVE, 25 kg', 'BAG', 30],
  ['TILE GROUT, LIGHT GRAY, 2 kg', 'BAG', 18],
  ['FIBER-CEMENT BOARD, 6 mm, 1200 x 2400 mm', 'SHEET', 24],
  ['GALVANIZED METAL STUD, 50 mm x 3 m, 0.5 mm THICK', 'PCS', 60],
].map(([name, unit, quantity], index) => ({ id: `tcr-item-${index + 1}`, name, unit, quantity }));

const definitions = [
  ['Northbridge Building Materials', 'NBM-TCR-101', [1850, 2850, 680, 980, 310, 145, 580, 165], [0.13, 0.29, 0.51]],
  ['Harborline Finishes Trading', 'HFT-TCR-202', [1925, 2790, 715, 945, 325, 152, 610, 158], [0.07, 0.38, 0.36]],
  ['Pillarstone Construction Supply', 'PCS-TCR-303', [1780, 2950, 650, 1020, 298, 138, 565, 172], [0.37, 0.25, 0.48]],
  ['Crestmark Architectural Products', 'CAP-TCR-404', [1880, 2880, 690, 965, 320, 150, 595, 169], [0.57, 0.32, 0.10]],
];
const suppliers = definitions.map(([name, ref, prices, accent], index) => ({
  id: `tcr-supplier-${index + 1}`, name, ref, prices, accent,
  file: `TCR Q0${index + 1} ${name}.pdf`, email: `supplier${index + 1}@example.com`,
  contact: ['Alex Ramos', 'Nina Torres', 'Marco Reyes', 'Lea Santos'][index],
  address: 'Sample supplier office, Metro Manila',
  leadDays: [5, 7, 6, 8][index],
}));
const request = {
  id: 'sample-taguig-mrf', ref: reference, requestDate,
  siteId: 'sample-taguig-project', category: project.scope, scope: project.scope,
  requestedBy: 'MIGUEL SANTOS', approvedBy: 'ENGR. ADRIAN TORRES',
  purchaser: 'ANDREA REYES', financeOfficer: 'PAOLO MENDOZA',
  specialInstructions: 'ARCHITECTURAL REPAIR MATERIALS. DELIVER TO SITE BY 26 OCT 2026. REFER TO KP-TCR-01.',
  documents: [{ name: 'Key Plan KP-TCR-01', type: 'Supporting PDF', fileId: 'sample-tcr-support' }],
  status: 'draft', createdAt: `${requestDate}T08:00:00.000Z`, updatedAt: `${requestDate}T08:00:00.000Z`,
  items: materials.map((item, index) => ({ ...item, neededDate,
    purpose: index < 3 ? 'WALL FINISH REPAIR' : index < 6 ? 'FLOOR FINISH REPAIR' : 'CEILING REPAIR',
    location: 'GROUND FLOOR WORK AREA', remarks: '',
  })),
};

function quotation(supplier) {
  return { id: supplier.id, mrfId: request.id, supplierId: supplier.id, ref: supplier.ref,
    currency: 'PHP', financial: { vatStatus: 'VAT', priceBasis: 'inclusive', vatRate: 12, reviewed: true },
    adjustments: [], lines: materials.map((item, index) => ({
      ...item, description: item.name, requestItemId: item.id, unitPrice: supplier.prices[index],
      conversionFactor: 1, discountType: 'none', discountValue: 0, taxRate: 0,
      printedTotal: roundMoney(item.quantity * supplier.prices[index]), matchConfirmed: true,
    })),
  };
}
const models = suppliers.map(supplier => ({ supplier, quote: quotation(supplier) }));
for (const { supplier, quote } of models) {
  assert.equal(supplier.prices.length, materials.length);
  for (const line of quote.lines) {
    assert.ok(line.quantity > 0 && line.unitPrice > 0);
    assert.equal(quotationLineAmount(quote, line), line.printedTotal);
  }
  assert.equal(quoteFinancialBreakdown(quote).gross, roundMoney(quote.lines.reduce((sum, line) => sum + line.printedTotal, 0)));
}

const assets = path.join(process.cwd(), 'src/server/document-assets');
const regularBytes = await fs.readFile(path.join(assets, 'arial.ttf'));
const boldBytes = await fs.readFile(path.join(assets, 'arial-bold.ttf'));
const ink = rgb(.10, .16, .24), muted = rgb(.32, .38, .46), lineColor = rgb(.80, .84, .89);
const peso = amount => `PHP ${documentMoney(amount)}`;

async function createPdf() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  pdf.setAuthor('ConstructSync sample documents');
  return { pdf, regular, bold };
}
function painter(page, regular, bold) {
  const put = (value, x, y, { size = 9, strong = false, color = ink, align = 'left', width } = {}) => {
    const font = strong ? bold : regular, text = String(value);
    const textWidth = font.widthOfTextAtSize(text, size);
    if (width && textWidth > width + .1) throw new Error(`Text exceeds cell: ${text}`);
    page.drawText(text, { x: align === 'right' ? x - textWidth : x, y, size, font, color });
  };
  const paragraph = (value, x, y, width, options = {}) => {
    const size = options.size || 9, step = options.step || size + 3;
    const lines = wrapText(value, options.strong ? bold : regular, size, width);
    lines.forEach((text, index) => put(text, x, y - index * step, { ...options, width }));
    return y - lines.length * step;
  };
  return { put, paragraph };
}
function notice(pdf, regular) {
  pdf.getPages().forEach((page, index) => {
    page.drawText('FICTIONAL SAMPLE FOR CONSTRUCTSYNC TESTING ONLY', { x: 36, y: 17, size: 7, font: regular, color: rgb(.55, .15, .15) });
    page.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: page.getWidth() - 62, y: 17, size: 7, font: regular, color: muted });
  });
}

async function makeQuote(supplier, quote) {
  const { pdf, regular, bold } = await createPdf();
  const page = pdf.addPage([595.28, 841.89]), accent = rgb(...supplier.accent);
  const { put, paragraph } = painter(page, regular, bold);
  page.drawRectangle({ x: 0, y: 752, width: 595.28, height: 90, color: accent });
  paragraph(supplier.name.toUpperCase(), 36, 811, 330, { size: 14, strong: true, color: rgb(1, 1, 1), step: 17 });
  put('QUOTATION', 559, 807, { size: 13, strong: true, color: rgb(1, 1, 1), align: 'right' });
  put(supplier.ref, 559, 787, { size: 9, color: rgb(1, 1, 1), align: 'right' });
  put(supplier.address, 36, 762, { size: 8.5, color: rgb(1, 1, 1) });
  put('TO: HML TECHNOLOGIES AND SERVICES INC.', 36, 729, { strong: true, size: 10 });
  put(project.name.toUpperCase(), 36, 712, { strong: true, size: 10 });
  put(`Delivery: ${project.location}`, 36, 696, { size: 9, color: muted });
  const meta = [
    ['MRF / SCOPE', `${reference} / ${project.scope}`, 'QUOTE DATE', documentDate(requestDate, true)],
    ['PAYMENT TERMS', '30 days net from delivery', 'VALID UNTIL', documentDate(validUntil, true)],
    ['LEAD TIME', `${supplier.leadDays} calendar days from confirmed PO`, 'SALES CONTACT', supplier.contact],
    ['PRICE BASIS', 'Unit prices include 12% VAT', 'CONTACT EMAIL', supplier.email],
  ];
  let y = 674;
  for (const [leftLabel, left, rightLabel, right] of meta) {
    put(leftLabel, 36, y, { size: 7.5, strong: true, color: accent });
    put(rightLabel, 315, y, { size: 7.5, strong: true, color: accent });
    paragraph(left, 36, y - 13, 260, { size: 9 });
    paragraph(right, 315, y - 13, 244, { size: 9 });
    y -= 32;
  }
  y -= 4;
  const cols = [{ x: 36, width: 24 }, { x: 60, width: 244 }, { x: 304, width: 42 }, { x: 346, width: 42 }, { x: 388, width: 80 }, { x: 468, width: 91 }];
  page.drawRectangle({ x: 36, y: y - 22, width: 523, height: 24, color: accent });
  ['#', 'MATERIAL / SPECIFICATION', 'QTY', 'UNIT', 'PRICE (PHP)', 'AMOUNT (PHP)'].forEach((text, index) => put(text, cols[index].x + 5, y - 14, { size: 7.5, strong: true, color: rgb(1, 1, 1), width: cols[index].width - 10 }));
  y -= 22;
  quote.lines.forEach((item, index) => {
    const description = wrapText(item.description, regular, 9, 232);
    const height = Math.max(32, description.length * 12 + 14);
    page.drawRectangle({ x: 36, y: y - height, width: 523, height, color: index % 2 ? rgb(.96, .97, .99) : rgb(1, 1, 1), borderColor: lineColor, borderWidth: .4 });
    put(index + 1, 41, y - 15, { size: 9 });
    description.forEach((text, n) => put(text, 66, y - 15 - n * 12, { size: 9, width: 232 }));
    put(item.quantity, 340, y - 15, { align: 'right', width: 32 });
    put(item.unit, 351, y - 15, { size: 8.5, width: 32 });
    put(documentMoney(item.unitPrice), 462, y - 15, { align: 'right', size: 9, width: 68 });
    put(documentMoney(item.printedTotal), 553, y - 15, { align: 'right', size: 9, width: 79 });
    y -= height;
  });
  const total = quoteFinancialBreakdown(quote).gross;
  y -= 24;
  put('SUBTOTAL (VAT INCLUSIVE)', 315, y, { size: 8.5 });
  put(documentMoney(total), 553, y, { align: 'right', size: 10 });
  y -= 24;
  page.drawRectangle({ x: 309, y: y - 7, width: 250, height: 25, color: accent });
  put('TOTAL QUOTATION', 317, y, { size: 9, strong: true, color: rgb(1, 1, 1) });
  put(peso(total), 551, y, { align: 'right', size: 10, strong: true, color: rgb(1, 1, 1) });
  y -= 36;
  y = paragraph('Prices and line amounts include 12% VAT. Do not add VAT again. Delivery is included. No discounts or additional charges apply.', 36, y, 523, { size: 8.5, color: muted });
  y = paragraph('All eight items match the MRF quantities and units. Printed total is before buyer withholding; Accounting reviews deductions separately.', 36, y - 5, 523, { size: 8.5, color: muted });
  assert.ok(y > 52, 'Quotation footer has enough space');
  put(`Prepared by: ${supplier.contact} / Sample sales representative`, 36, y - 17, { size: 8.5 });
  notice(pdf, regular);
  pdf.setTitle(`${supplier.ref} - ${project.name}`);
  pdf.setSubject(`Architectural materials for ${reference}; VAT-inclusive sample quotation`);
  await fs.writeFile(path.join(output, supplier.file), await pdf.save());
  return total;
}

async function makeMrf() {
  const { pdf, regular, bold } = await createPdf();
  const form = await PDFDocument.load(await generateMrfPdf(request, project.name, project.location));
  for (const page of await pdf.copyPages(form, form.getPageIndices())) pdf.addPage(page);
  const page = pdf.addPage([792, 612]);
  const { put, paragraph } = painter(page, regular, bold);
  put(project.name.toUpperCase(), 36, 571, { size: 18, strong: true });
  put(`KEY PLAN KP-TCR-01 / ${reference} / ${project.scope.toUpperCase()}`, 36, 545, { size: 12, strong: true });
  put('Illustrative ground-floor work zones - not to scale', 36, 526, { size: 10, color: muted });
  const zones = [
    { x: 48, y: 276, width: 206, height: 188, title: 'ZONE A', lines: ['Reception / common area', 'Wall finish repairs', 'Tile replacement'] },
    { x: 254, y: 276, width: 206, height: 188, title: 'ZONE B', lines: ['Office / service room', 'Wall and ceiling repairs', 'Tile replacement'] },
    { x: 48, y: 205, width: 412, height: 71, title: 'ZONE C', lines: ['Corridor / access route', 'Protect surfaces and maintain clear access'] },
  ];
  zones.forEach(zone => {
    page.drawRectangle({ x: zone.x, y: zone.y, width: zone.width, height: zone.height, color: rgb(.96, .97, .99), borderColor: ink, borderWidth: 1 });
    put(zone.title, zone.x + 14, zone.y + zone.height - 25, { size: 11, strong: true });
    zone.lines.forEach((text, index) => put(text, zone.x + 14, zone.y + zone.height - 46 - index * 17, { size: zone.title === 'ZONE C' ? 8.5 : 9.5 }));
  });
  let y = 457;
  put('WORK SCOPE', 492, y, { size: 11, strong: true });
  y -= 24;
  for (const text of ['Prepare and repaint existing wall surfaces.', 'Replace damaged floor finishes using the listed tiles, adhesive and grout.', 'Repair ceiling lining using fiber-cement boards and galvanized metal studs.', 'Quantities are governed by the MRF material schedule; this plan is illustrative.']) y = paragraph(text, 492, y, 260, { size: 10, step: 14 }) - 12;
  put(`Date needed: ${documentDate(neededDate, true)}`, 48, 159, { size: 11, strong: true });
  paragraph('Inspect delivered quantities, sizes and packaging before receipt. All products must match the material descriptions; coordinate any substitutions with Procurement.', 48, 137, 700, { size: 10 });
  paragraph('SAMPLE SOURCE DOCUMENT: select the existing Taguig City Rehabilitation project and the corresponding scope in ConstructSync. The app assigns its own MRF number when saved.', 48, 90, 700, { size: 9, color: muted });
  notice(pdf, regular);
  pdf.setTitle(`${reference} - ${project.name} material request and key plan`);
  await fs.writeFile(path.join(output, mrfFile), await pdf.save());
  return pdf.getPageCount();
}

await fs.mkdir(output, { recursive: true });
const pageCount = await makeMrf();
const totals = [];
for (const { supplier, quote } of models) {
  const total = await makeQuote(supplier, quote);
  const breakdown = quoteFinancialBreakdown(quote);
  totals.push({ file: supplier.file, reference: supplier.ref, total, ewtGoods: breakdown.ewtGoods, net: breakdown.net });
}
await fs.writeFile(path.join(output, 'README.md'), `# Taguig City Rehabilitation sample pack

One combined MRF (${pageCount} pages: company form plus illustrative key plan) and four correct supplier quotations. Architectural scope; eight matching materials. All names, quantities, prices, contacts and work zones are fictional samples.

- Project: **${project.name}**. Use the existing project; these files do not create or change it.
- Paper/source MRF reference: **${reference}**. ConstructSync assigns its own project-numbered reference on first save.
- Request / quotation date: **${requestDate}**. Date needed for every material: **${neededDate}**.
- Prices and printed totals include **12% VAT**. Do not add VAT again. No discounts, extra freight or service charges.
- Payment terms: **30 days net from delivery**. Accounting enters the agreed payment due date separately.
- All four quotations are correct; there are no intentional discrepancies.

| Quotation | Printed total / gross | App goods EWT | App net supplier payable |
|---|---:|---:|---:|
${totals.map(row => `| ${row.file} | ${peso(row.total)} | ${peso(row.ewtGoods)} | ${peso(row.net)} |`).join('\n')}

EWT and net values above are expected values under the app's automatic VAT-goods settings, shown for checking. They are not extra supplier charges and are not printed as the quotation total.

## Use in ConstructSync

1. On /requests/new, import the combined MRF and extract with AI (or enter manually). Select the **existing Taguig City Rehabilitation** project and its matching **Architectural** scope. Review all eight materials and the dates.
2. Attach the same combined MRF PDF as the supporting PDF in Review & submit. The AI import alone does not satisfy that attachment requirement.
3. After MRF approval/archive, open Quotations. Create four supplier groups and upload one quotation PDF into each group.
4. Review VAT-inclusive settings, line amounts, quantities and MRF matches before finalization. Each quotation offers the same eight items so they can be compared directly.

Regenerate: node --experimental-strip-types scripts/generate-taguig-sample-pack.mjs
`);
console.log(JSON.stringify({ output, mrf: mrfFile, mrfPages: pageCount, materials: materials.length, quotations: totals }, null, 2));
