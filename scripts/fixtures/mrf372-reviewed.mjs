// Reviewed manual inputs, checked against the original PDF text on every run.
// Importing this fixture reads source files; it never regenerates the sample pack.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { pageText } from '../../tests/helpers/pdf-text.mjs';

const materials = [
  ['TEMPERED GLASS PANEL 10mm CLEAR, 900 x 2100mm', 'PCS', 12],
  ['TEMPERED GLASS PANEL 10mm CLEAR, 800 x 2100mm', 'PCS', 18],
  ['FRAMELESS GLASS DOOR HARDWARE SET, TOP-HUNG, STAINLESS', 'SET', 12],
  ['STAINLESS STEEL DOOR PULL HANDLE 1000mm, 32mm TUBE, BRUSHED', 'PCS', 30],
  ['FRAMELESS SHOWER PARTITION PANEL 8mm TEMPERED, H 2000mm', 'PCS', 14],
  ['SILICONE SEALANT, NEUTRAL CURE, CLEAR, 300ml TUBE', 'CARTRIDGE', 24],
  ['GLASS CLAMP, POLISHED STAINLESS STEEL, 4-HOLE 50 x 50mm', 'PCS', 60],
  ['ANTI-BREAK SAFETY FILM 0.4mm, 1220mm WIDE ROLL', 'ROLL', 4],
];
const suppliers = [
  ['372 Q01 Meridian Doors and Fittings.pdf', 'MERIDIAN DOORS AND FITTINGS, INC.', 'MDF-Q-2411', 'MERIDIAN', [4850, 4320, 6750, 2980, 3890, 415, 385, 11200], 438680],
  ['372 Q02 Apex Architectural Hardware Corp.pdf', 'APEX ARCHITECTURAL HARDWARE CORP.', 'AAH-2026-8842', 'APEX', [5210, 4640, 6990, 2860, 4050, 452, 348, 11850], 451548],
  ['372 Q03 Summit Building Supply Trading.pdf', 'SUMMIT BUILDING SUPPLY TRADING', 'SBST-552-26', 'SUMMIT', [4720, 4210, 6580, 2890, 3750, 405, 360, 11000], 425900],
  ['372 Q04 Kestrel Glass Systems Co.pdf', 'KESTREL GLASS SYSTEMS CO.', 'KGS-Q-0917', 'KESTREL', [4590, 4095, 6420, 2760, 3610, 398, 372, 10800], 414242],
];
const compact = value => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function source(file) {
  const bytes = await readFile(file), pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages().map(page => pageText(pdf, page).map(run => run.text).join(' '));
  assert.ok(pages.every(text => text.length > 100), `Readable PDF pages: ${file}`);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, pages: pages.length, text: pages.join(' ') };
}
function includes(text, expected, context) {
  assert.ok(compact(text).includes(compact(expected)), `${context}: printed ${expected}`);
}

export async function reviewedMrf372Samples() {
  const mrf = await source('sample-data/MRF 372 - Material Request and Key Plan.pdf');
  const details = {
    projectName: 'MARINA SKYLINE RESIDENCES - TOWER B', ref: 'MRF-372', requestDate: '2026-10-02',
    requestedBy: 'ARRIANE AYA M. BAYLON', approvedBy: 'ENGR. PAOLO REYES', purchaser: 'MARIA L. SANTIAGO', financeOfficer: 'RAFAEL LIM',
    specialInstructions: 'SUPPLY PER APPROVED KEY PLAN. DELIVER IN ONE LOT. SITE PERSONNEL INSPECTS ON ARRIVAL.',
  };
  for (const value of Object.values(details).filter(value => value !== details.requestDate)) includes(mrf.text, value, mrf.file);
  includes(mrf.text, 'October 2, 2026', mrf.file);
  const items = materials.map(([name, unit, quantity], index) => {
    includes(mrf.text, `${index + 1} ${name} ${quantity} ${unit} 30 OCT 2026`, mrf.file);
    return { id: `reviewed-${index + 1}`, name, unit, quantity, neededDate: '2026-10-30', purpose: '3RD FLOOR GLASS DOOR AND PARTITION WORKS PER KEY PLAN CP-04.', location: '3RD FLOOR STAGING AREA', remarks: index === 4 ? 'CONFIRM TEMPERED CERTIFICATE ON DELIVERY.' : '' };
  });
  mrf.data = { extraction: { details, items }, warnings: [] };
  const quotations = [];
  for (const [index, [filename, supplier, reference, brand, prices, expectedTotal]] of suppliers.entries()) {
    const quote = await source(`sample-data/${filename}`);
    const terms = '30 days net from delivery date';
    for (const value of [supplier, reference, 'MRF-372', 'VAT 12%, PRICES INCLUSIVE OF VAT', terms, `TOTAL PHP ${money(expectedTotal)}`]) includes(quote.text, value, quote.file);
    const lines = materials.map(([description, unit, quantity], row) => {
      const unitPrice = prices[row], printedTotal = Math.round(quantity * unitPrice * 100) / 100;
      includes(quote.text, `${row + 1} ${quantity} ${unit} PHP ${money(unitPrice)} PHP ${money(printedTotal)} ${description}`, quote.file);
      return { description, quantity, unit, unitPrice, printedTotal, brand: `${brand} STANDARD`, specification: '', requestedMaterialId: `mrf372-item-${row + 1}`, sourcePage: 1, matchConfidence: 'high', matchRationale: 'Manually checked against the matching description, quantity and unit on the original MRF.', notes: '', leadTime: '10 calendar days from confirmed order' };
    });
    quote.verifiedGross = lines.reduce((sum, line) => sum + line.printedTotal, 0);
    assert.equal(quote.verifiedGross, expectedTotal, `${filename}: gross total`);
    quote.data = { extraction: {
      supplier, reference, supplierAddress: 'Sample supplier office, Metro Manila', supplierTin: 'SAMPLE ONLY',
      contactName: 'SAMPLE SALES REPRESENTATIVE', email: `supplier${index + 1}@example.com`, phone: 'SAMPLE CONTACT',
      currency: 'PHP', quoteDate: '2026-10-10', terms, validity: '30 days from date of quotation', available: '', leadDays: 10,
      deliveryTerms: 'DELIVERED TO SITE; DELIVERY INCLUDED IN UNIT PRICES',
      quoteNotes: 'All prices include 12% VAT. No discount, additional freight or other charges. Fictional sample quotation.',
      vatStatus: 'VAT', priceBasis: 'inclusive', vatRate: 12, lines,
    }, warnings: [] };
    quotations.push(quote);
  }
  return { passed: true, method: 'manual-pdf-review', testedAt: new Date().toISOString(), mrf, quotations, errors: [] };
}
