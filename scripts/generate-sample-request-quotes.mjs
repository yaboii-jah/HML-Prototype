// Generates a coherent sample pack in sample-data: one MRF hardcopy on the company form plus
// four supplier quotations from different suppliers covering the same material lines.
// Run with: node --experimental-strip-types scripts/generate-sample-request-quotes.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { generateMrfPdf } from '../src/server/template-mrf-pdf.ts';
import { documentDate, documentMoney, wrapText } from '../src/server/document-template.ts';

const outputDirectory = 'sample-data';
const assets = path.join(process.cwd(), 'src/server/document-assets');
const combinedFile = 'MRF 372 - Material Request and Key Plan.pdf';

const project = {
  name: 'MARINA SKYLINE RESIDENCES - TOWER B',
  location: '1045 EDSA, BRGY. 143, PASAY CITY, METRO MANILA',
  contact: 'ENGR. PAOLO REYES - SITE ENGINEER',
};

const requestLines = [
  { id: 'i1', name: 'TEMPERED GLASS PANEL 10mm CLEAR, 900 x 2100mm', unit: 'PCS', quantity: 12 },
  { id: 'i2', name: 'TEMPERED GLASS PANEL 10mm CLEAR, 800 x 2100mm', unit: 'PCS', quantity: 18 },
  { id: 'i3', name: 'FRAMELESS GLASS DOOR HARDWARE SET, TOP-HUNG, STAINLESS', unit: 'SET', quantity: 12 },
  { id: 'i4', name: 'STAINLESS STEEL DOOR PULL HANDLE 1000mm, 32mm TUBE, BRUSHED', unit: 'PCS', quantity: 30 },
  { id: 'i5', name: 'FRAMELESS SHOWER PARTITION PANEL 8mm TEMPERED, H 2000mm', unit: 'PCS', quantity: 14 },
  { id: 'i6', name: 'SILICONE SEALANT, NEUTRAL CURE, CLEAR, 300ml TUBE', unit: 'CARTRIDGE', quantity: 24 },
  { id: 'i7', name: 'GLASS CLAMP, POLISHED STAINLESS STEEL, 4-HOLE 50 x 50mm', unit: 'PCS', quantity: 60 },
  { id: 'i8', name: 'ANTI-BREAK SAFETY FILM 0.4mm, 1220mm WIDE ROLL', unit: 'ROLL', quantity: 4 },
];

const mrf = {
  id: 'mrf-372',
  ref: 'MRF-372',
  requestDate: '2026-10-02',
  siteId: 'marina-skyline-tower-b',
  category: 'Finishes',
  scope: '3rd Floor Architectural Finishes - Glass Doors and Partition Panels',
  requestedBy: 'ARRIANE AYA M. BAYLON',
  approvedBy: 'ENGR. PAOLO REYES',
  purchaser: 'MARIA L. SANTIAGO',
  financeOfficer: 'RAFAEL LIM',
  specialInstructions: 'SUPPLY PER APPROVED KEY PLAN. DELIVER IN ONE LOT. SITE PERSONNEL INSPECTS ON ARRIVAL.',
  documents: [{ name: combinedFile, type: 'Supporting PDF', fileId: 'sample-support' }],
  status: 'approved',
  createdAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-03T09:15:00.000Z',
  items: requestLines.map(line => ({
    ...line,
    neededDate: '2026-10-30',
    purpose: '3RD FLOOR GLASS DOOR AND PARTITION WORKS PER KEY PLAN CP-04.',
    location: '3RD FLOOR STAGING AREA',
    remarks: line.id === 'i5' ? 'CONFIRM TEMPERED CERTIFICATE ON DELIVERY.' : '',
  })),
};

const suppliers = [
  {
    file: '372 Q01 Meridian Doors and Fittings.pdf',
    ref: 'MDF-Q-2411',
    name: 'MERIDIAN DOORS AND FITTINGS, INC.',
    address: 'Unit 12, Marina Industrial Park, Mabolo, Las Piñas City',
    tin: '000-874-221-00000',
    email: 'sales@meridiandoors.ph',
    phone: '(02) 8842-1177',
    contact: 'MS. LINA CRUZ - ACCOUNT EXECUTIVE',
    date: '2026-10-06',
    validity: '30 days from date of quotation',
    terms: '30 days net from delivery date',
    leadTime: '21 calendar days from confirmed order',
    deliveryTerms: 'DELIVERED, SITE, PASAY CITY (FREIGHT PREPAID)',
    vatStatus: 'VAT',
    priceBasis: 'exclusive',
    vatRate: 12,
    accent: [0.09, 0.3, 0.55],
    style: 'band',
    freight: { label: 'FREIGHT AND HANDLING', value: 18500 },
    discount: { label: 'TRADE DISCOUNT', value: 3 },
    notes: [
      'ALL PRICES ARE VAT EXCLUSIVE AND SUBJECT TO 12% VAT.',
      'PRICES HOLD FOR THE VALIDITY PERIOD AND ARE SUBJECT TO STOCK AVAILABILITY.',
      'GLASS PANELS ARE DELIVERED IN VERTICAL CRATES; UNLOADING IS BY THE BUYER.',
      'PROVIDES 10-YEAR WARRANTY ON FRAMELESS HARDWARE AND 5-YEAR WARRANTY ON TEMPERED PANELS.',
      'SHOWER PARTITION PANELS ARE AVAILABLE WITH 8mm THICKNESS ONLY.',
    ],
    offers: [
      { id: 'i1', price: 4850, brand: 'MERIDIAN TG-10' },
      { id: 'i2', price: 4320, brand: 'MERIDIAN TG-10' },
      { id: 'i3', price: 6750, brand: 'MERIDIAN FH-TS' },
      { id: 'i4', price: 2980, brand: 'MERIDIAN PH-1000' },
      { id: 'i5', price: 3890, brand: 'MERIDIAN TG-8' },
      { id: 'i6', price: 415, brand: 'MERIDIAN SEAL-N' },
      { id: 'i7', price: 385, brand: 'MERIDIAN GC-4H' },
      { id: 'i8', price: 11200, brand: 'MERIDIAN ABF-04' },
    ],
  },
  {
    file: '372 Q02 Apex Architectural Hardware Corp.pdf',
    ref: 'AAH-2026-8842',
    name: 'APEX ARCHITECTURAL HARDWARE CORP.',
    address: '129 Rizal Avenue Extension, Carmona, Makati City',
    tin: '006-412-908-00000',
    email: 'quotes@apexhardware.ph',
    phone: '(02) 8953-6620',
    contact: 'MR. RONNIE DELA CRUZ - SALES MANAGER',
    date: '2026-10-07',
    validity: '15 days from date of quotation',
    terms: '50% down payment, balance on delivery',
    leadTime: '35 calendar days, permanent plant order',
    deliveryTerms: 'DELIVERED, SITE, PASAY CITY',
    vatStatus: 'VAT',
    priceBasis: 'inclusive',
    vatRate: 12,
    accent: [0.36, 0.15, 0.44],
    style: 'boxed',
    freight: { label: 'DELIVERY CHARGE', value: 22000 },
    discount: null,
    notes: [
      'ALL PRICES ARE VAT INCLUSIVE AND INCLUDE STANDARD PACKAGING.',
      'DOORS AND PARTITION PANELS ARE MANUFACTURED TO ORDER; LEAD TIME IS INDICATIVE.',
      'THIS QUOTATION DOES NOT COVER SHOWER PARTITION PANELS; SEPARATE QUOTATION FOLLOWS ON REQUEST.',
      '50% DOWN PAYMENT IS REQUIRED TO RELEASE THE ORDER TO THE FACTORY.',
      'ESTIMATED DELIVERY WINDOW IS 35 CALENDAR DAYS AFTER ORDER CONFIRMATION AND DOWN PAYMENT.',
      'INSTALLED PRICING IS AVAILABLE UPON REQUEST AND IS NOT INCLUDED HERE.',
    ],
    offers: [
      { id: 'i1', price: 5210, brand: 'APEX TG-CLEAR' },
      { id: 'i2', price: 4640, brand: 'APEX TG-CLEAR' },
      { id: 'i3', price: 6990, brand: 'APEX TOPLINE TS' },
      { id: 'i4', price: 2860, brand: 'APEX BRUSH-1000' },
      { id: 'i6', price: 452, brand: 'APEX NEUTRAL SEAL' },
      { id: 'i7', price: 348, brand: 'APEX GLASSCLIP-4' },
      { id: 'i8', price: 11850, brand: 'APEX SAFEFILM-04' },
    ],
  },
  {
    file: '372 Q03 Kestrel Glass Systems Co.pdf',
    ref: 'KGS-Q-0917',
    name: 'KESTREL GLASS SYSTEMS CO.',
    address: 'Km. 22 SLEX, Canlubang, Lemery, Batangas',
    tin: '010-556-733-00000',
    email: 'bids@kestrelglass.ph',
    phone: '(049) 501-2233',
    contact: 'ENGR. NOEL SANTIAGO - PROJECT HEAD',
    date: '2026-10-05',
    validity: '45 days from date of quotation',
    terms: '20% advance, 80% against delivery and acceptance',
    leadTime: '14 calendar days for stocked items',
    deliveryTerms: 'DELIVERED, SITE, PASAY CITY (2 TRIPS)',
    vatStatus: 'VAT',
    priceBasis: 'exclusive',
    vatRate: 12,
    accent: [0.04, 0.42, 0.4],
    style: 'band',
    freight: { label: 'FREIGHT, TWO TRIPS', value: 24000 },
    discount: { label: 'EARLY PAYMENT DISCOUNT', value: 2 },
    // Printed totals on supplier quotes are transcription evidence; a transposed figure is a real review case.
    printedTotals: { 1: 54080 },
    notes: [
      'ALL PRICES ARE VAT EXCLUSIVE.',
      'QUOTED PRICES FOR TEMPERED PANELS ARE BATCH-BASED AND CONFIRMED AT ORDER ACCEPTANCE.',
      'AN ADVANCE PAYMENT OF 20% IS REQUIRED; THE BALANCE IS PAYABLE AFTER SITE ACCEPTANCE.',
      'THIS QUOTATION IS SUBJECT TO STOCK AVAILABILITY AT THE TIME OF ORDER CONFIRMATION.',
      'CERTIFIED TEMPERED GLASS WITH SAFETY LABELS PER ASTM C1048 IS SUPPLIED FOR ALL PANELS.',
      'SITE MEASUREMENT IS AVAILABLE ON REQUEST AND IS NOT INCLUDED IN THIS PRICE.',
    ],
    offers: [
      { id: 'i1', price: 4590, brand: 'KESTREL KTG10' },
      { id: 'i2', price: 4095, brand: 'KESTREL KTG10' },
      { id: 'i3', price: 6420, brand: 'KESTREL KTS-HW' },
      { id: 'i4', price: 2760, brand: 'KESTREL KPH-10' },
      { id: 'i5', price: 3610, brand: 'KESTREL KTG8' },
      { id: 'i6', price: 398, brand: 'KESTREL KSEAL-300' },
      { id: 'i7', price: 372, brand: 'KESTREL KCL-4' },
      { id: 'i8', price: 10800, brand: 'KESTREL KABF-04' },
    ],
  },
  {
    file: '372 Q04 Summit Building Supply Trading.pdf',
    ref: 'SBST-552-26',
    name: 'SUMMIT BUILDING SUPPLY TRADING',
    address: '58 Aurora Street, Caloocan City',
    tin: '009-338-470-00000',
    email: 'summit.trading@gmail.com',
    phone: '0917 442 8890',
    contact: 'MR. DANTE PEREZ - PROPRIETOR',
    date: '2026-10-08',
    validity: '20 days from date of quotation',
    terms: 'Cash on delivery against company account',
    leadTime: '7 calendar days',
    deliveryTerms: 'DELIVERED, SITE, PASAY CITY (TRUCK)',
    vatStatus: 'NON-VAT',
    priceBasis: 'exclusive',
    vatRate: 0,
    accent: [0.53, 0.28, 0.05],
    style: 'boxed',
    freight: { label: 'TRUCK DELIVERY', value: 12000 },
    discount: null,
    notes: [
      'NON-VAT REGISTERED SUPPLIER. PRICES ARE EXCLUSIVE OF VAT.',
      'OFFER COVERS DOOR PANELS AND ACCESSORIES ONLY; SEALANT AND CLAMPS ARE NOT STOCKED.',
      'PAYMENT IS BY CASH OR BANK TRANSFER AGAINST THE COMPANY ACCOUNT.',
      'STOCK IS LIMITED AND RESERVED ONLY UPON RECEIPT OF THE PURCHASE ORDER.',
      'QUOTATION IS VOID AFTER THE VALIDITY PERIOD OR WITHOUT THE SUPPLIER SIGNATURE.',
    ],
    offers: [
      { id: 'i1', price: 4720, brand: 'SUMMIT ST-10' },
      { id: 'i2', price: 4210, brand: 'SUMMIT ST-10' },
      { id: 'i3', price: 6580, brand: 'SUMMIT SH-TS' },
      { id: 'i4', price: 2890, brand: 'SUMMIT PH-1000' },
    ],
  },
];

const round = (value) => Math.round(value * 100) / 100;
const peso = (value) => `PHP ${documentMoney(round(value))}`;

function quoteTotals(supplier) {
  const lines = supplier.offers.map(offer => {
    const line = requestLines.find(value => value.id === offer.id);
    return { ...offer, quantity: line.quantity, requested: line.quantity, amount: round(offer.price * line.quantity) };
  });
  const gross = round(lines.reduce((sum, line) => sum + line.amount, 0));
  const discount = supplier.discount ? round(gross * supplier.discount.value / 100) : 0;
  const net = round(gross - discount);
  const freight = supplier.freight.value;
  const taxableBase = round(net + freight);
  const vat = supplier.vatStatus === 'VAT' ? round(supplier.priceBasis === 'inclusive' ? 0 : taxableBase * supplier.vatRate / 100) : 0;
  const vatInclusiveGross = supplier.priceBasis === 'inclusive' ? round(gross - gross * 100 / (100 + supplier.vatRate)) : 0;
  const total = supplier.priceBasis === 'inclusive' ? round(net + freight) : round(taxableBase + vat);
  return { lines, gross, discount, net, freight, vat, vatInclusiveGross, total, uncovered: requestLines.filter(line => !supplier.offers.some(offer => offer.id === line.id)) };
}

const ink = rgb(0.13, 0.14, 0.16), faint = rgb(0.55, 0.56, 0.58), glass = rgb(0.2, 0.5, 0.62);

function drawingSheet(pdf, regular, bold) {
  const page = pdf.addPage([841.89, 595.28]);
  const put = (value, x, y, options = {}) => page.drawText(value, { x, y, size: options.size || 3, font: options.bold ? bold : regular, color: options.color || ink });
  const rule = (x1, y1, x2, y2, weight = 0.6, color = ink) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: weight, color });
  return { page, put, rule };
}

// Schematic 3rd floor east wing plan: walls, corridor, glazed openings and partition runs.
function buildKeyPlan(pdf, regular, bold) {
  const { page, put, rule } = drawingSheet(pdf, regular, bold);
  const originX = 52, originY = 112, scale = 0.48, wall = 1.3, thin = 0.4;
  const at = (column, row) => [originX + column * scale, originY + row * scale];
  const mx = (millimetres) => millimetres * scale;
  const columns = [0, 245, 490, 735, 980], rows = [0, 150, 200, 460];

  page.drawRectangle({ x: 22, y: 22, width: 797.89, height: 551.28, borderColor: ink, borderWidth: 1 });
  put('NUMMER ETT BUILDERS AND TRADING', 32, 556, { size: 9, bold: true });
  put('KEY PLAN - 3RD FLOOR, EAST WING - GLASS DOORS AND PARTITION PANELS', 32, 546, { size: 6.5 });
  put('PROJECT: MARINA SKYLINE RESIDENCES - TOWER B', 32, 537, { size: 5.5 });
  put('SHEET CP-04    SCALE 1:100    DATE OCTOBER 2, 2026    DRAWN ARRIANE AYA M. BAYLON', 32, 528, { size: 5.5 });
  put('PLAN', 32, 502, { size: 5.5, bold: true, color: glass });
  rule(22, 494, 819.89, 494, 0.8);

  for (let index = 0; index < columns.length - 1; index++) {
    const [x1, y1] = at(columns[index], 0), [x2, y2] = at(columns[index + 1], 460);
    rule(x1, y1, x2, y1, wall);
    rule(x2, y1, x2, y2, wall);
    rule(x1, y2, x2, y2, wall);
    rule(x1, y1, x1, y2, wall);
    // Bath strip closes the lower band off from the circulation aisle.
    rule(x1, at(columns[index], 150)[1], x2, at(columns[index + 1], 150)[1], wall);
  }
  for (const [index, column] of columns.entries()) {
    const [x, top] = at(column, 460), [, bottom] = at(column, 0);
    if (index && index < columns.length - 1) rule(x, top, x, bottom, thin, faint);
    page.drawCircle({ x, y: top + 13, size: 8, borderColor: faint, borderWidth: 0.5 });
    put(String.fromCharCode(65 + index), x - 2.4, top + 11.4, { size: 5.5, bold: true, color: faint });
  }
  for (const [index, row] of rows.entries()) {
    const [left, y] = at(0, row);
    rule(left, y, left + mx(980), y, thin, faint);
    page.drawCircle({ x: left - 13, y, size: 8, borderColor: faint, borderWidth: 0.5 });
    put(String(index + 1), left - 15.6, y - 2, { size: 5.5, bold: true, color: faint });
  }

  const units = [
    { column: 0, code: '301', door: 62, shower: true },
    { column: 245, code: '302', door: 305, shower: false },
    { column: 490, code: '303', door: 552, shower: true },
    { column: 735, code: '304', door: 795, shower: false },
  ];
  units.forEach((unit, index) => {
    const [left] = at(unit.column, 0), [right] = at(unit.column + 245, 0);
    const centre = (left + right) / 2;
    put(`UNIT ${unit.code}`, centre - 17, originY + mx(424), { size: 6, bold: true });
    put('1 BED UNIT  |  38.5 SQM', centre - 22, originY + mx(410), { size: 4.2, color: faint });

    // Entrance door in the corridor wall, swinging into the circulation aisle.
    const [hingeX, hingeY] = at(unit.door, 200);
    const [leafX, leafY] = at(unit.door, 290);
    const [openX] = at(unit.door + 90, 200);
    rule(hingeX, hingeY, leafX, leafY, 0.9);
    rule(hingeX, hingeY, openX, hingeY, 1.1, glass);
    rule(hingeX, hingeY, hingeX, hingeY + mx(35), 2.4, glass);
    for (let step = 1; step <= 14; step++) {
      const angle = (step / 14) * (Math.PI / 2), previous = angle - Math.PI / 14;
      rule(leafX + Math.sin(angle) * mx(90), leafY - Math.cos(angle) * mx(90), leafX + Math.sin(previous) * mx(90), leafY - Math.cos(previous) * mx(90), 0.4, faint);
    }
    rule(hingeX, hingeY, hingeX, hingeY - mx(35), 2.4, glass);
    rule(hingeX, hingeY, hingeX + mx(35), hingeY, 1.1, glass);
    put(index % 2 ? 'GD-02' : 'GD-01', hingeX + mx(6), hingeY + mx(10), { size: 4.2, bold: true, color: glass });
    put(index % 2 ? '800 x 2100' : '900 x 2100', hingeX + mx(6), hingeY + mx(20), { size: 3.8, color: glass });
    put('PH-01 PULL HANDLE BOTH SIDES', hingeX + mx(6), hingeY + mx(30), { size: 3.8, color: glass });

    // Bath strip below the corridor: shower partition on the requested units only.
    if (unit.shower) {
      const [panelLeft, panelBase] = at(unit.column + 45, 20);
      const [panelRight] = at(unit.column + 200, 20);
      rule(panelLeft, panelBase, panelRight, panelBase, 1.6, glass);
      rule(panelLeft, panelBase + mx(105), panelRight, panelBase + mx(105), 1.6, glass);
      rule(panelLeft, panelBase, panelLeft, panelBase + mx(105), 1.6, glass);
      rule(panelRight, panelBase, panelRight, panelBase + mx(105), 1.6, glass);
      for (let step = 1; step < 6; step++) {
        const [tickX] = at(unit.column + 45 + step * 31, 20);
        rule(tickX, panelBase, tickX, panelBase + mx(105), 0.35, glass);
      }
      const panelCentre = (panelLeft + panelRight) / 2;
      put('SP-01', panelCentre - 6, panelBase + mx(62), { size: 4.2, bold: true, color: glass });
      wrapText('SHOWER PARTITION 8mm, H 2000', regular, 3.6, mx(120)).forEach((line, n) => put(line, panelCentre - regular.widthOfTextAtSize(line, 3.6) / 2, panelBase + mx(52) - n * 5, { size: 3.6, color: glass }));
      wrapText('SF-01 SAFETY FILM TO COMMON SIDE', regular, 3.6, mx(120)).forEach((line, n) => put(line, panelCentre - regular.widthOfTextAtSize(line, 3.6) / 2, panelBase + mx(36) - n * 5, { size: 3.6, color: glass }));
    } else {
      const bathLabel = wrapText('UNIT BATH - EXISTING FITTINGS, NO NEW GLAZING', regular, 4.2, mx(200));
    bathLabel.forEach((line, n) => put(line, centre - regular.widthOfTextAtSize(line, 4.2) / 2, originY + mx(80) - n * 6, { size: 4.2, color: faint }));
    }
  });

  const [corridorX, corridorY] = at(0, 175);
  put('CIRCULATION AND SERVICE AISLE - KEEP CLEAR', corridorX + mx(980) / 2 - 78, corridorY - 2, { size: 4.6, bold: true, color: faint });

  const legend = [
    ['GD-01', 'FRAMELESS GLASS DOOR, TOP-HUNG, 900 x 2100mm, CLEAR 10mm TEMPERED'],
    ['GD-02', 'FRAMELESS GLASS DOOR, TOP-HUNG, 800 x 2100mm, CLEAR 10mm TEMPERED'],
    ['SP-01', 'FRAMELESS SHOWER PARTITION PANEL, 8mm TEMPERED, H 2000mm'],
    ['PH-01', 'STAINLESS STEEL PULL HANDLE 1000mm, 32mm TUBE, BOTH SIDES'],
    ['SF-01', 'ANTI-BREAK SAFETY FILM 0.4mm ON GLAZING ADJACENT TO COMMON AREAS'],
    ['ST-01', 'NEUTRAL-CURE SILICONE SEALANT, CLEAR, ALL GLASS EDGES'],
  ];
  put('LEGEND', 546, 466, { size: 6, bold: true });
  legend.forEach(([tag, label], index) => {
    const y = 448 - index * 17;
    rule(548, y + 2, 578, y + 2, 2.2, glass);
    put(tag, 588, y, { size: 5, bold: true, color: glass });
    wrapText(label, regular, 4.6, 200).forEach((line, n) => put(line, 622, y - n * 6, { size: 4.6, color: faint }));
  });

  page.drawCircle({ x: 790, y: 470, size: 13, borderColor: ink, borderWidth: 0.6 });
  page.drawSvgPath('M 790 483 L 790 459 M 781 467 L 790 459 L 799 467', { borderColor: ink, borderWidth: 0.9 });
  put('N', 787, 490, { size: 6, bold: true });

  put('GENERAL NOTES', 546, 330, { size: 6, bold: true });
  [
    '1. ALL DIMENSIONS ARE IN MILLIMETRES UNLESS NOTED OTHERWISE.',
    '2. DOOR AND PARTITION OPENING SIZES ARE NOMINAL; CONFIRM ON SITE BEFORE ORDER.',
    '3. ALL GLAZING SHALL BE CERTIFIED TEMPERED SAFETY GLASS TO ASTM C1048.',
    '4. TOP-HUNG HARDWARE SHALL BE FULL-HEIGHT 304 STAINLESS STEEL, 100kg RATED.',
    '5. SEAL ALL GLASS EDGES WITH NEUTRAL-CURE SILICONE AFTER INSTALLATION.',
    '6. APPLY SAFETY FILM TO ALL GLAZING ADJACENT TO COMMON AREAS.',
    '7. UNLOADING OF VERTICAL CRATES IS BY THE BUYER.',
  ].forEach((note, index) => put(note, 546, 316 - index * 10, { size: 4.6, color: index ? faint : ink }));

  put('PREPARED BY', 546, 214, { size: 4.6, color: faint });
  put('ARRIANE AYA M. BAYLON - SITE PERSONNEL', 546, 204, { size: 5.2 });
  put('VERIFIED BY', 546, 190, { size: 4.6, color: faint });
  put('ENGR. PAOLO REYES', 546, 180, { size: 5.2 });

  const blockX = 546, blockY = 96;
  page.drawRectangle({ x: blockX, y: blockY, width: 260, height: 66, borderColor: ink, borderWidth: 0.8 });
  rule(blockX, blockY + 44, blockX + 260, blockY + 44, 0.5);
  rule(blockX, blockY + 22, blockX + 260, blockY + 22, 0.5);
  rule(blockX + 178, blockY, blockX + 178, blockY + 44, 0.5);
  put('MARINA SKYLINE RESIDENCES - TOWER B', blockX + 8, blockY + 52, { size: 5.6, bold: true });
  put('3RD FLOOR, EAST WING', blockX + 8, blockY + 32, { size: 5.2 });
  put('CP-04', blockX + 8, blockY + 8, { size: 7, bold: true });
  put('REV. 01', blockX + 186, blockY + 32, { size: 5.2 });
  put('OCT 02, 2026', blockX + 186, blockY + 8, { size: 5.2 });
}

async function buildQuotation(supplier, pdf, regular, bold) {
  const pageWidth = 595.28, pageHeight = 841.89, margin = 36;
  const accent = rgb(...supplier.accent);
  const { lines, gross, discount, freight, vat, vatInclusiveGross, total, uncovered } = quoteTotals(supplier);
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const write = (value, x, y, options = {}) => {
    const font = options.bold ? bold : regular, size = options.size || 9;
    page.drawText(value, { x, y, size, font, color: options.color || rgb(0, 0, 0), opacity: options.opacity });
  };
  const rows = [];
  for (let line = 0; line < lines.length; line++) {
    const offer = lines[line];
    const source = requestLines.find(value => value.id === offer.id);
    const description = wrapText(source.name, regular, 8, 168);
    const printed = supplier.printedTotals?.[line + 1];
    rows.push({
      no: String(line + 1),
      description,
      brand: wrapText(offer.brand, regular, 8, 80),
      quantity: String(offer.quantity),
      unit: source.unit,
      price: peso(offer.price),
      amount: peso(printed ?? offer.amount),
      computed: peso(offer.amount),
      printed: printed !== undefined,
    });
  }

  const header = () => {
    if (supplier.style === 'band') {
      page.drawRectangle({ x: 0, y: pageHeight - 108, width: pageWidth, height: 108, color: accent });
      write(supplier.name, margin, pageHeight - 46, { size: 15.5, bold: true, color: rgb(1, 1, 1) });
      write(supplier.address, margin, pageHeight - 62, { size: 8.5, color: rgb(1, 1, 1), opacity: 0.92 });
      write(`TIN ${supplier.tin}  |  ${supplier.phone}  |  ${supplier.email}`, margin, pageHeight - 75, { size: 8.5, color: rgb(1, 1, 1), opacity: 0.92 });
      write('QUOTATION', pageWidth - margin - 118, pageHeight - 46, { size: 15.5, bold: true, color: rgb(1, 1, 1) });
      write(`NO. ${supplier.ref}`, pageWidth - margin - 118, pageHeight - 62, { size: 8.5, color: rgb(1, 1, 1), opacity: 0.92 });
      write(`DATE ${documentDate(supplier.date)}`, pageWidth - margin - 118, pageHeight - 75, { size: 8.5, color: rgb(1, 1, 1), opacity: 0.92 });
    } else {
      page.drawRectangle({ x: margin - 10, y: pageHeight - 114, width: pageWidth - 2 * margin + 20, height: 96, borderColor: accent, borderWidth: 1.4 });
      page.drawRectangle({ x: margin - 10, y: pageHeight - 114, width: 5, height: 96, color: accent });
      write(supplier.name, margin + 6, pageHeight - 40, { size: 14, bold: true, color: accent });
      write(supplier.address, margin + 6, pageHeight - 55, { size: 8.5 });
      write(`TIN ${supplier.tin}  |  ${supplier.phone}  |  ${supplier.email}`, margin + 6, pageHeight - 68, { size: 8.5 });
      write('QUOTATION', pageWidth - margin - 150, pageHeight - 40, { size: 14.5, bold: true, color: accent });
      write(`NO. ${supplier.ref}`, pageWidth - margin - 150, pageHeight - 55, { size: 8.5 });
      write(`DATE ${documentDate(supplier.date)}`, pageWidth - margin - 150, pageHeight - 68, { size: 8.5 });
    }
    y = pageHeight - 134;
  };

  header();

  const metaPairs = [
    ['PROJECT', project.name],
    ['MRF REFERENCE', `${mrf.ref} - ${project.contact}`],
    ['DELIVERY ADDRESS', project.location],
    ['VALIDITY', supplier.validity.toUpperCase()],
    ['PAYMENT TERMS', supplier.terms.toUpperCase()],
    ['LEAD TIME', supplier.leadTime.toUpperCase()],
    ['DELIVERY TERMS', supplier.deliveryTerms],
    ['PRICE BASIS', `${supplier.vatStatus}${supplier.vatRate ? ` ${supplier.vatRate}%` : ''}, PRICES ${supplier.priceBasis === 'inclusive' ? 'INCLUSIVE' : 'EXCLUSIVE'} OF VAT, IN PHILIPPINE PESO`],
  ];
  const columnWidth = (pageWidth - 2 * margin) / 2;
  for (let index = 0; index < metaPairs.length; index++) {
    const column = index % 2, row = Math.floor(index / 2);
    const x = margin + column * columnWidth;
    const rowY = y - row * 26;
    write(metaPairs[index][0], x, rowY - 9, { size: 6.5, bold: true, color: accent });
    wrapText(metaPairs[index][1], regular, 8, columnWidth - 12).forEach((line, n) => write(line, x, rowY - 19 - n * 9.5, { size: 8 }));
  }
  y -= Math.ceil(metaPairs.length / 2) * 26 + 6;

  const columns = [
    { label: 'ITEM NO', x: margin, width: 34, align: 'left' },
    { label: 'DESCRIPTION AND SPECIFICATION', x: margin + 34, width: 175, align: 'left' },
    { label: 'BRAND / MODEL', x: margin + 209, width: 85, align: 'left' },
    { label: 'QTY', x: margin + 294, width: 38, align: 'right' },
    { label: 'UNIT', x: margin + 332, width: 48, align: 'left' },
    { label: 'UNIT PRICE', x: margin + 380, width: 68, align: 'right' },
    { label: 'AMOUNT', x: margin + 448, width: 75.28, align: 'right' },
  ];
  const tableHeader = () => {
    page.drawRectangle({ x: margin, y: y - 15, width: pageWidth - 2 * margin, height: 18, color: accent });
    for (const column of columns) {
      const text = column.label;
      const textWidth = (column.bold ? bold : regular).widthOfTextAtSize(text, 7);
      const x = column.align === 'right' ? column.x + column.width - 4 - textWidth : column.x + 4;
      write(text, x, y - 10, { size: 7, bold: true, color: rgb(1, 1, 1) });
    }
    y -= 18;
  };
  tableHeader();

  for (const row of rows) {
    const cells = [row.description, row.brand];
    const height = Math.max(...cells.map(cell => cell.length)) * 9.5 + 10;
    if (y - height < 190) {
      page = pdf.addPage([pageWidth, pageHeight]);
      header();
      tableHeader();
    }
    page.drawRectangle({ x: margin, y: y - height, width: pageWidth - 2 * margin, height, borderColor: rgb(0.78, 0.78, 0.78), borderWidth: 0.5 });
    const values = [row.no, null, null, row.quantity, row.unit, row.price, row.amount];
    values.forEach((value, index) => {
      if (value === null) return;
      const column = columns[index];
      const textWidth = regular.widthOfTextAtSize(value, 8);
      write(value, column.align === 'right' ? column.x + column.width - 4 - textWidth : column.x + 4, y - 11, { size: 8 });
    });
    row.description.forEach((line, n) => write(line, columns[1].x + 4, y - 11 - n * 10, { size: 8 }));
    row.brand.forEach((line, n) => write(line, columns[2].x + 4, y - 11 - n * 10, { size: 8 }));
    y -= height;
  }

  y -= 12;
  const totals = [
    ['SUBTOTAL', peso(gross)],
    ...(discount ? [[supplier.discount.label, `- ${peso(discount)}`]] : []),
    [supplier.freight.label, peso(freight)],
    ...(supplier.priceBasis === 'inclusive' ? [['VAT INCLUDED IN PRICES (12%)', peso(vatInclusiveGross)]] : []),
    ...(vat ? [['VAT 12%', peso(vat)]] : []),
    ['TOTAL', peso(total)],
  ];
  for (const [label, value] of totals) {
    const isTotal = label === 'TOTAL';
    if (isTotal) page.drawRectangle({ x: margin + 300, y: y - 4, width: pageWidth - margin - 300, height: 18, color: accent, opacity: 0.12 });
    write(label, margin + 310, y, { size: isTotal ? 9 : 8.5, bold: isTotal, color: isTotal ? accent : rgb(0.2, 0.2, 0.2) });
    const text = value.replace('- ', '');
    const textWidth = (isTotal ? bold : regular).widthOfTextAtSize(text, isTotal ? 9 : 8.5);
    write(text, pageWidth - margin - 4 - textWidth, y, { size: isTotal ? 9 : 8.5, bold: isTotal, color: isTotal ? accent : rgb(0.1, 0.1, 0.1) });
    y -= isTotal ? 20 : 14;
  }
  if (supplier.vatStatus === 'NON-VAT') {
    write('NON-VAT REGISTERED SUPPLIER - NO VAT CHARGED, WITHHOLDING TAX NOT APPLICABLE ON THIS QUOTATION.', margin, y - 2, { size: 7, color: rgb(0.35, 0.35, 0.35) });
    y -= 12;
  }
  if (uncovered.length) {
    write('NOT QUOTED FOR THIS QUOTATION:', margin, y - 2, { size: 7.5, bold: true, color: rgb(0.55, 0.12, 0.12) });
    y -= 11;
    uncovered.forEach((line, n) => {
      const wrapped = wrapText(`${n + 1}. ${line.name} (${line.quantity} ${line.unit})`, regular, 7.5, pageWidth - 2 * margin - 12);
      wrapped.forEach(value => write(value, margin + 10, y - 2, { size: 7.5, color: rgb(0.55, 0.12, 0.12) }));
      y -= wrapped.length * 9.5;
    });
  }

  const termsLines = supplier.notes.map(note => wrapText(note, regular, 7.5, pageWidth - 2 * margin - 12));
  const termsHeight = 27 + termsLines.reduce((sum, lines) => sum + lines.length * 9.5 + 1.5, 0);
  if (y - termsHeight < 150) { page = pdf.addPage([pageWidth, pageHeight]); header(); }

  y -= 14;
  write('TERMS AND CONDITIONS', margin, y, { size: 8.5, bold: true, color: accent });
  y -= 13;
  for (const lines of termsLines) {
    lines.forEach(line => { write(line, margin + 10, y, { size: 7.5, color: rgb(0.25, 0.25, 0.25) }); y -= 9.5; });
    y -= 1.5;
  }

  y = Math.max(y - 24, 120);
  const signWidth = 230;
  const signatureBlock = (x, heading, lines) => {
    wrapText(heading, bold, 8.5, signWidth).forEach((line, n) => write(line, x, y - n * 10, { size: 8.5, bold: true }));
    page.drawLine({ start: { x, y: y - 46 }, end: { x: x + signWidth, y: y - 46 }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
    lines.forEach((line, n) => write(line, x, y - 58 - n * 11, { size: 7.5, color: rgb(0.35, 0.35, 0.35) }));
  };
  signatureBlock(margin, `FOR ${supplier.name}`, ['AUTHORIZED SIGNATURE', supplier.contact]);
  signatureBlock(pageWidth - margin - signWidth, `ACCEPTED FOR ${project.name}`, ['AUTHORIZED SIGNATURE', 'NAME AND DATE']);

  const count = pdf.getPageCount();
  pdf.getPages().forEach((sheet, index) => sheet.drawText(`${supplier.ref}  |  ${project.name}  |  Page ${index + 1} of ${count}`, { x: margin, y: 24, size: 7, font: regular, color: rgb(0.4, 0.4, 0.4) }));
}

function buildWorkScope(pdf, regular, bold) {
  const page = pdf.addPage([595.28, 841.89]);
const put = (value, x, y, options = {}) => page.drawText(value, { x, y, size: options.size || 9, font: options.bold ? bold : regular, color: options.color || ink });
  const rule = (y, weight = 0.6) => page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: weight, color: ink });
  let y = 800;
  put('NUMMER ETT BUILDERS AND TRADING', 40, y, { size: 13, bold: true });
  put('GENERAL BUILDING CONSTRUCTION RENTAL, SERVICE AND TRADING', 40, y - 12, { size: 7.5, color: faint });
  put('93 LIBTAL ST. GREENHILLS SUBO PULO PINAMAMAQUE CITY', 40, y - 22, { size: 7.5, color: faint });
  y -= 44;
  page.drawRectangle({ x: 40, y: y - 30, width: 515, height: 30, color: rgb(0.11, 0.29, 0.55) });
  put('SCOPE OF WORK AND MATERIAL SPECIFICATION', 52, y - 19, { size: 10.5, bold: true, color: rgb(1, 1, 1) });
  put('CP-04 / MS-03', 490, y - 19, { size: 8, color: rgb(1, 1, 1) });
  y -= 48;

  const sections = [
    ['1. PROJECT', `${project.name}, ${project.location}. This scope covers the 3rd floor east wing only, comprising units 301 to 304 as shown on key plan CP-04.`],
    ['2. WORKSCOPE', 'Supply and install frameless glass doors, glass door hardware, stainless steel pull handles and frameless shower partitions at the 3rd floor east wing, including silicone sealing of all glass edges and application of anti-break safety film to glazing adjacent to common areas.'],
    ['3. SPECIFICATIONS', 'All glass panels shall be 10mm thick clear tempered safety glass conforming to ASTM C1048, with safety certification labels on every panel. Shower partitions shall be 8mm thick clear tempered glass at 2000mm height. Doors shall be top-hung on full stainless steel hardware sets rated for 100kg. Pull handles shall be 1000mm brushed stainless steel with 32mm tube. All stainless fittings shall be 304 grade.'],
    ['4. INSTALLATION', 'Installation shall be by an approved frameless glass door installer. Confirm all opening sizes on site before releasing the order to the supplier. Unloading of vertical crates is by the buyer. Site Personnel shall inspect and accept all materials on delivery against this material request.'],
    ['5. DELIVERY', 'Deliver in one lot to the 3rd floor staging area. Required on site by October 30, 2026. Supplier shall provide certified tempered glass documentation with the delivery.'],
    ['6. EXCLUSIONS', 'This scope excludes framing and rough opening preparation, electrical and lighting work, signage, and any work outside the 3rd floor east wing.'],
  ];
  for (const [heading, body] of sections) {
    put(heading, 40, y, { size: 9, bold: true, color: rgb(0.11, 0.29, 0.55) });
    y -= 12;
    for (const line of wrapText(body, regular, 8.5, 515)) { put(line, 40, y, { size: 8.5 }); y -= 11; }
    y -= 8;
  }

  y -= 4;
  put('7. MATERIAL SCHEDULE', 40, y, { size: 9, bold: true, color: rgb(0.11, 0.29, 0.55) });
  y -= 14;
  const sheet = { item: 40, description: 72, quantity: 336, unit: 386, required: 460 };
  const widths = { description: 256, quantity: 40 };
  page.drawRectangle({ x: 40, y: y - 12, width: 515, height: 15, color: rgb(0.11, 0.29, 0.55) });
  for (const label of ['ITEM', 'DESCRIPTION', 'QTY', 'UNIT', 'REQUIRED ON SITE']) {
    const x = label === 'ITEM' ? sheet.item : label === 'DESCRIPTION' ? sheet.description : label === 'QTY' ? sheet.quantity : label === 'UNIT' ? sheet.unit : sheet.required;
    put(label, x + 3, y - 7, { size: 7.5, bold: true, color: rgb(1, 1, 1) });
  }
  y -= 20;
  requestLines.forEach((line, index) => {
    const description = wrapText(line.name, regular, 8, widths.description);
    const height = Math.max(description.length, 1) * 10 + 4;
    if (index % 2) page.drawRectangle({ x: 40, y: y - height + 12, width: 515, height, color: rgb(0.96, 0.96, 0.97) });
    page.drawLine({ start: { x: 40, y: y - 4 }, end: { x: 555, y: y - 4 }, thickness: 0.4, color: rgb(0.85, 0.86, 0.88) });
    put(String(index + 1), sheet.item + 3, y, { size: 8 });
    description.forEach((value, n) => put(value, sheet.description + 3, y - n * 10, { size: 8 }));
    const quantity = String(line.quantity);
    put(quantity, sheet.quantity + widths.quantity - regular.widthOfTextAtSize(quantity, 8), y, { size: 8 });
    put(line.unit, sheet.unit + 3, y, { size: 8 });
    put('30 OCT 2026', sheet.required + 3, y, { size: 8 });
    y -= height;
  });
  rule(y + 12, 0.6);

  y -= 24;
  put('8. REFERENCES', 40, y, { size: 9, bold: true, color: rgb(0.11, 0.29, 0.55) });
  y -= 12;
  for (const reference of [`Material Request Form ${mrf.ref} dated ${documentDate(mrf.requestDate, true)}.`, 'Key plan CP-04, 3rd floor east wing, revision 01.', 'This specification and the approved key plan together define the requested materials. Any material not listed here is outside this request.']) {
    for (const line of wrapText(reference, regular, 8.5, 515)) { put(line, 40, y, { size: 8.5, color: faint }); y -= 11; }
  }

  y -= 30;
  page.drawLine({ start: { x: 40, y }, end: { x: 280, y }, thickness: 0.6, color: ink });
  page.drawLine({ start: { x: 320, y }, end: { x: 555, y }, thickness: 0.6, color: ink });
  put('ARRIANE AYA M. BAYLON - SITE PERSONNEL', 40, y - 11, { size: 7.5, color: faint });
  put('ENGR. PAOLO REYES - APPROVING ENGINEER', 320, y - 11, { size: 7.5, color: faint });
  page.drawText(`SCOPE OF WORK CP-04  |  ${project.name}  |  Page 3 of 3`, { x: 40, y: 34, size: 7, font: regular, color: faint });
}

fs.mkdirSync(outputDirectory, { recursive: true });
{
  const combined = await PDFDocument.create();
  combined.registerFontkit((await import('@pdf-lib/fontkit')).default);
  const [form] = await combined.copyPages(await PDFDocument.load(await generateMrfPdf(mrf, project.name, project.location)), [0]);
  combined.addPage(form);
  const regular = await combined.embedFont(fs.readFileSync(path.join(assets, 'arial.ttf')), { subset: true });
  const bold = await combined.embedFont(fs.readFileSync(path.join(assets, 'arial-bold.ttf')), { subset: true });
  buildKeyPlan(combined, regular, bold);
  buildWorkScope(combined, regular, bold);
  combined.setTitle(`${mrf.ref} material request, key plan and scope of work`);
  combined.setSubject(`${project.name} - 3rd floor east wing glass doors and partition panels`);
  fs.writeFileSync(path.join(outputDirectory, combinedFile), await combined.save());
  console.log(`${combinedFile}: MRF hardcopy, key plan CP-04 and scope of work (${requestLines.length} material lines)`);
}

for (const supplier of suppliers) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit((await import('@pdf-lib/fontkit')).default);
  const regular = await pdf.embedFont(fs.readFileSync(path.join(assets, 'arial.ttf')), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(path.join(assets, 'arial-bold.ttf')), { subset: true });
  await buildQuotation(supplier, pdf, regular, bold);
  pdf.setTitle(`${supplier.ref} quotation for ${mrf.ref}`);
  pdf.setSubject(`${supplier.vatStatus} ${supplier.priceBasis} quotation for ${project.name}`);
  fs.writeFileSync(path.join(outputDirectory, supplier.file), await pdf.save());
  const { total, lines, uncovered } = quoteTotals(supplier);
  console.log(`${supplier.ref} ${supplier.name}: ${lines.length} lines, ${uncovered.length} unquoted, total ${peso(total)}`);
}