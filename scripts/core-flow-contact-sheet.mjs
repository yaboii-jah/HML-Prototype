import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const detailed = process.argv.includes('--mrf372');
const root = 'artifacts/core-business-flow' + (detailed ? '/detailed-screenshots' : '');
const entries = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
async function sheet(items, columns, width, filename) {
  const height = width * 900 / 1440 + 48;
  const canvas = createCanvas(columns * width, Math.ceil(items.length / columns) * height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#edf2f8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, entry] of items.entries()) {
    const x = index % columns * width, y = Math.floor(index / columns) * height;
    ctx.drawImage(await loadImage(`${root}/${entry.file}`), x + 5, y + 5, width - 10, (width - 10) * 900 / 1440);
    ctx.fillStyle = '#17243a'; ctx.font = 'bold 12px Arial';
    ctx.fillText(`${String(entry.number).padStart(2, '0')} · ${entry.title}`, x + 8, y + width * 900 / 1440 + 16, width - 16);
    ctx.font = '11px Arial'; ctx.fillText(`${entry.role} · ${entry.importance}`, x + 8, y + width * 900 / 1440 + 33, width - 16);
  }
  await writeFile(filename, canvas.toBuffer('image/png'));
}
await sheet(entries, 4, 400, `${root}/CONTACT_SHEET.png`);
for (let index = 0; index < entries.length; index += 12) await sheet(entries.slice(index, index + 12), 3, 480, `.next/core-flow-${detailed ? 'detailed-' : ''}review-${index / 12 + 1}.png`);
console.log(`Contact sheets generated for ${entries.length} figures`);
