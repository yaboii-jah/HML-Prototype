import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type ExcelJS from "exceljs";
import { wrapText } from "./document-template.ts";

let arial: ReturnType<typeof fontkit.create> | undefined;
const metrics = { widthOfTextAtSize(value: string, size: number) {
  arial ||= fontkit.create(readFileSync(path.join(process.cwd(), "src/server/document-assets/arial.ttf")));
  return arial.layout(value).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * size / arial.unitsPerEm;
} };
function address(value: string) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(value)!;
  return { row: Number(row), col: [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) };
}

export function comparisonOverflow(sheets: ExcelJS.Worksheet[]) {
  const notes: string[] = [];
  for (const sheet of sheets) {
    const merges = sheet.model.merges.map(range => range.split(":").map(address));
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.master.address !== cell.address || typeof cell.value !== "string" || !cell.value) return;
      const start = address(cell.address);
      const range = merges.find(([first]) => first.row === start.row && first.col === start.col);
      const end = range?.[1] || start;
      let width = 0, height = 0;
      for (let col = start.col; col <= end.col; col++) width += ((sheet.getColumn(col).width || 0) * 7 + 5) * .75;
      for (let index = start.row; index <= end.row; index++) height += sheet.getRow(index).height || 15;
      const size = cell.font.size || 10;
      if (wrapText(cell.value, metrics, size, Math.max(1, width - 4.5)).length * size * 1.15 > height) notes.push(`${sheet.name} ${cell.address}: ${cell.value}`);
    }));
  }
  return notes.flatMap(note => wrapText(note, metrics, 10, 195 * .75));
}
