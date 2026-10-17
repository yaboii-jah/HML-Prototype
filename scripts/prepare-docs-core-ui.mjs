import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const selectedList = process.argv.includes('--selection');
const selectionFileIndex = process.argv.indexOf('--selection-file');
const selectionFile = selectionFileIndex >= 0 ? process.argv[selectionFileIndex + 1] : null;
const root = selectedList ? 'artifacts' : 'artifacts/core-business-flow/detailed-screenshots';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const selection = selectedList || selectionFile
  ? (await readFile(selectionFile || 'C:/Users/Jahmell Dorias/Desktop/3 - Site Personnel Dashboard Part 1.txt', 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)(?:\s*[-.]\s*|\s+)(.+)/);
    if (!match) return [];
    const number = Number(match[1]);
    const matches = manifest.filter(entry => (selectedList ? Number.parseInt(path.basename(entry.file), 10) : entry.number) === number);
    if (matches.length !== 1) throw Error(`Missing or ambiguous screenshot ${number}`);
    return [{ ...matches[0], number, title: match[2].trim() }];
  })
  : manifest;
if (!selection.length) throw Error('No screenshots selected');
const folder = path.resolve('.next/docs-core-ui-images');
await mkdir(folder, { recursive: true });
const items = [];
for (const entry of selection) {
  const input = await loadImage(path.resolve(root, entry.file));
  const canvas = createCanvas(1404, 879);
  const context = canvas.getContext('2d');
  context.drawImage(input, 0, 0, 1404, 879);
  context.font = '11px Arial';
  const imagePath = path.join(folder, `${entry.number}.png`);
  await writeFile(imagePath, canvas.toBuffer('image/png'));
  items.push({ number: entry.number, title: entry.title, source: path.resolve(root, entry.file), imagePath, captionWidth: context.measureText(entry.title).width });
  canvas.width = 1;
}
await writeFile('.next/docs-core-ui-plan.json', JSON.stringify(items, null, 2));
console.log(JSON.stringify({ prepared: items.length, wrappedTitles: items.filter(item => item.captionWidth > 468).map(item => item.title) }));
