import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.CORE_FLOW_APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const folder = '.next/mrf372-paper';
await mkdir(folder, { recursive: true });
const mrf = 'sample-data/MRF 372 - Material Request and Key Plan.pdf';
const quotes = [
  ['sample-data/372 Q01 Meridian Doors and Fittings.pdf', 438680],
  ['sample-data/372 Q02 Apex Architectural Hardware Corp.pdf', 451548],
  ['sample-data/372 Q03 Summit Building Supply Trading.pdf', 425900],
  ['sample-data/372 Q04 Kestrel Glass Systems Co.pdf', 414242],
];
const quantities = [12, 18, 12, 30, 14, 24, 60, 4];
const post = async (route, file, materials) => {
  const bytes = await readFile(file), form = new FormData();
  form.append('files', new File([bytes], path.basename(file), { type: 'application/pdf' }));
  if (materials) form.append('materials', JSON.stringify(materials));
  const response = await fetch(base + route, { method: 'POST', headers: { Origin: base }, body: form, signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw Error(`${path.basename(file)}: ${data.error || response.status}`);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, data };
};
const result = { samplePack: 'MRF 372', testedAt: new Date().toISOString(), mrf: null, quotations: [], errors: [] };
try {
  result.mrf = await post('/api/requests/extract', mrf);
  assert.equal(result.mrf.data.extraction.items.length, 8, 'Eight MRF material rows');
  assert.deepEqual(result.mrf.data.extraction.items.map(i => i.quantity), quantities, 'Printed MRF quantities');
  await writeFile(`${folder}/extraction.json`, JSON.stringify(result, null, 2));
  console.log('MRF import: eight materials and all quantities verified.');
  const materials = result.mrf.data.extraction.items.map((i, n) => ({ id: `mrf372-item-${n + 1}`, description: i.name, quantity: i.quantity, unit: i.unit }));
  const outcomes = await Promise.allSettled(quotes.map(async ([file, expectedTotal]) => {
    const quote = await post('/api/quotes/extract', file, materials);
    const extracted = quote.data.extraction;
    assert.equal(extracted.lines.length, 8, `${file}: eight supplier lines`);
    assert.equal(extracted.vatStatus, 'VAT');
    assert.equal(extracted.priceBasis, 'inclusive');
    assert.equal(extracted.vatRate, 12);
    const amount = Math.round(extracted.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;
    assert.equal(amount, expectedTotal, `${file}: printed gross total`);
    for (const [n, line] of extracted.lines.entries()) {
      assert.equal(line.quantity, quantities[n], `${file}: material ${n + 1} quantity`);
      assert.equal(Math.round(line.quantity * line.unitPrice * 100), Math.round(line.printedTotal * 100), `${file}: material ${n + 1} amount`);
    }
    quote.expectedTotal = expectedTotal; quote.verifiedGross = amount;
    console.log(`${path.basename(file)}: eight lines, VAT-inclusive gross PHP ${amount.toFixed(2)} verified.`);
    return quote;
  }));
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') result.quotations.push(outcome.value);
    else result.errors.push(outcome.reason.message);
  }
} catch (error) { result.errors.push(error.message); }
result.passed = !!result.mrf && result.quotations.length === 4 && !result.errors.length;
await writeFile(`${folder}/extraction.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, quotesVerified: result.quotations.length, errors: result.errors }));
if (!result.passed) process.exitCode = 1;
