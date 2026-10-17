import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const input = process.argv[2];
const core = process.argv.includes('--core');
const plan = JSON.parse(await readFile(core ? '.next/docs-core-ui-plan.json' : '.next/docs-bulk-plan.json', 'utf8'));
const titles = core ? plan.map(item => item.title) : ['Sign Page', 'Site Personnel Dashboard Part 1', 'Site Personnel Dashboard Part 2', ...plan.map(item => item.title)];
const normalize = value => value.replace(/\s+/g, ' ').trim();
const document = await getDocument({ data: new Uint8Array(await readFile(input)), useSystemFonts: true, disableFontFace: true }).promise;
const pages = [];
let start = null;
for (let number = 1; number <= document.numPages; number++) {
  const page = await document.getPage(number);
  const content = await page.getTextContent();
  const text = normalize(content.items.map(item => item.str).join(' '));
  if (start === null && text.includes(titles[0]) && text.includes(titles[1])) start = number;
  if (start === null) continue;
  const offset = (number - start) * 2;
  const expected = titles.slice(offset, offset + 2);
  const operators = await page.getOperatorList();
  const images = operators.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
  const labelCount = (text.match(/Figure\s*#/g) || []).length;
  let cursor = 0;
  const missingTitles = expected.filter(title => {
    const index = text.indexOf(normalize(title), cursor);
    if (index < 0) return true;
    cursor = index + normalize(title).length;
    return false;
  });
  pages.push({ page: number, expected, images, labelCount, missingTitles });
}
const expectedPages = Math.ceil(titles.length / 2);
const failures = pages.filter(page => page.images !== page.expected.length || page.labelCount !== page.expected.length || page.missingTitles.length);
const sampleIndexes = [...new Set([0, 1, Math.floor(pages.length / 2), pages.length - 2, pages.length - 1])];
const samples = [];
for (const index of sampleIndexes) {
  if (!pages[index]) continue;
  const number = pages[index].page;
  const page = await document.getPage(number);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const output = input.replace(/\.pdf$/, `-page-${number}.png`);
  await writeFile(output, canvas.toBuffer('image/png'));
  samples.push(output);
}
const report = { totalPages: document.numPages, uiStartPage: start, uiPages: pages.length, expectedPages, figures: titles.length, failures, pages, samples };
await writeFile(core ? '.next/docs-core-ui-page-validation.json' : '.next/docs-figure-page-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, pages: undefined }));
await document.cleanup();
if (!start || pages.length !== expectedPages || failures.length) process.exitCode = 1;
