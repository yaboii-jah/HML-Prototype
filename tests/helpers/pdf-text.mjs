import { PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';

// Read the embedded Unicode maps and text operators produced by the PDF exporters.
export function pageText(document, page) {
  const fonts = page.node.Resources().lookup(PDFName.of('Font'));
  const maps = new Map();
  for (const [name, reference] of fonts.entries()) {
    const font = document.context.lookup(reference), unicode = font.get(PDFName.of('ToUnicode'));
    if (!unicode) continue;
    const cmap = Buffer.from(decodePDFRawStream(document.context.lookup(unicode)).decode()).toString();
    const map = new Map();
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const match of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
      map.set(match[1].toUpperCase(), String.fromCharCode(...match[2].match(/.{4}/g).map(value => parseInt(value, 16))));
    }
    maps.set(name.toString(), map);
  }
  const contents = page.node.Contents(), streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const result = [];
  for (const reference of streams) {
    const content = Buffer.from(decodePDFRawStream(document.context.lookup(reference)).decode()).toString();
    let font = '', x = 0, y = 0;
    for (const match of content.matchAll(/(\/[^\s]+)\s+[\d.]+\s+Tf|1\s+0\s+0\s+1\s+([\d.-]+)\s+([\d.-]+)\s+Tm|<([\da-f]+)>\s*Tj/gi)) {
      if (match[1]) font = match[1];
      else if (match[2]) { x = Number(match[2]); y = Number(match[3]); }
      else if (maps.has(font)) result.push({ text: (match[4].match(/.{4}/g) || []).map(value => maps.get(font).get(value.toUpperCase()) || '').join(''), x, y });
    }
  }
  return result;
}
