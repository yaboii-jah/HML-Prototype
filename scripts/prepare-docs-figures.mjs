import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const source = 'C:/Users/Jahmell Dorias/Desktop/3 - Site Personnel Dashboard Part 1.txt';
const lines = (await readFile(source, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/);
const selected = lines.flatMap(line => {
  const match = line.match(/^\s*(\d+)\s*-\s*(.+)/);
  return match ? [{ number: Number(match[1]), title: match[2].trim() }] : [];
});
if (selected.length !== 142 || selected[0].number !== 3 || selected[1].number !== 4) throw Error('Unexpected screenshot selection');
const manifest = JSON.parse(await readFile('artifacts/manifest.json', 'utf8'));
const folder = path.resolve('.next/docs-figure-images');
await mkdir(folder, { recursive: true });
const items = [];
for (const item of selected.slice(2)) {
  const matches = manifest.filter(entry => Number.parseInt(path.basename(entry.file), 10) === item.number);
  if (matches.length !== 1) throw Error('Ambiguous or missing screenshot ' + item.number);
  const image = await loadImage(path.resolve('artifacts', matches[0].file));
  const canvas = createCanvas(1404, 879);
  canvas.getContext('2d').drawImage(image, 0, 0, 1404, 879);
  const imagePath = path.join(folder, `${item.number}.png`);
  await writeFile(imagePath, canvas.toBuffer('image/png'));
  canvas.width = 1;
  items.push({ ...item, source: matches[0].file, imagePath });
}
await writeFile('.next/docs-bulk-plan.json', JSON.stringify(items, null, 2));
console.log(JSON.stringify({ prepared: items.length, first: items[0].number, last: items.at(-1).number }));
