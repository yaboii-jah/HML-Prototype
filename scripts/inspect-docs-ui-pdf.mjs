import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const input = process.argv[2];
const document = await getDocument({ data: new Uint8Array(await readFile(input)), useSystemFonts: true }).promise;
const matches = [];
for (let number = Math.max(1, document.numPages - 15); number <= document.numPages; number++) {
  const page = await document.getPage(number), content = await page.getTextContent();
  const text = content.items.map(item => item.str).join(' ');
  if (!/Sign Page|Site Personnel Dashboard Part [12]/.test(text)) continue;
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const image = input.replace(/\.pdf$/, `-page-${number}.png`);
  await writeFile(image, canvas.toBuffer('image/png'));
  const operators = await page.getOperatorList();
  matches.push({ page: number, size: page.getViewport({ scale: 1 }).viewBox, figures: content.items.filter(item => /Figure|Sign Page|Site Personnel Dashboard Part/.test(item.str)).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5] })), images: operators.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length, image });
}
console.log(JSON.stringify({ pages: document.numPages, matches }));
await document.cleanup();
