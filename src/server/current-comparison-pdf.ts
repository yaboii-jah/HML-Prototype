import { PDFDocument, PDFString, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { comparisonOffers } from "../domain/comparison-report.ts";
import type { BidReport } from "../domain/types.ts";
import { buildComparisonTable, type ComparisonTableRow } from "./comparison-table.ts";
import { allowedDocumentLink, wrapText } from "./document-template.ts";

export async function generateCurrentComparisonPdf(report: BidReport) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(path.join(process.cwd(), "src/server/document-assets/arial.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(path.join(process.cwd(), "src/server/document-assets/arial-bold.ttf")), { subset: true });
  const offers = comparisonOffers(report.data);
  for (let start = 0; start < offers.length; start += 11) {
    const table = buildComparisonTable(report, offers.slice(start, start + 11), start);
    const size = table.fontSize, lineHeight = size * 1.25, bottom = 570;
    const positions = table.widths.map((_, index) => 50 + table.widths.slice(0, index).reduce((sum, width) => sum + width, 0));
    let sheet!: PDFPage;
    let top = 54;
    const measure = (row: ComparisonTableRow) => row.cells.map(cell => wrapText(cell.text, cell.bold ? bold : regular, size, table.widths.slice(cell.column, cell.column + cell.span).reduce((sum, width) => sum + width, 0) - 6));
    const draw = (row: ComparisonTableRow, lines: string[][], offset: number, count: number) => {
      const height = count * lineHeight + 6;
      row.cells.forEach((cell, index) => {
        const width = table.widths.slice(cell.column, cell.column + cell.span).reduce((sum, value) => sum + value, 0), x = positions[cell.column];
        const color = cell.color ? rgb(parseInt(cell.color.slice(0, 2), 16) / 255, parseInt(cell.color.slice(2, 4), 16) / 255, parseInt(cell.color.slice(4, 6), 16) / 255) : rgb(1, 1, 1);
        sheet.drawRectangle({ x, y: 612 - top - height, width, height, color, borderColor: rgb(0, 0, 0), borderWidth: .35 });
        const font = cell.bold ? bold : regular;
        lines[index].slice(offset, offset + count).forEach((text, n) => {
          if (text) sheet.drawText(text, { x: x + (width - font.widthOfTextAtSize(text, size)) / 2, y: 612 - top - 3 - size - n * lineHeight, font, size, color: cell.url ? rgb(0, .3, .65) : rgb(0, 0, 0) });
        });
        if (cell.url && allowedDocumentLink(cell.url)) {
          const annotation = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, 612 - top - height, x + width, 612 - top], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(cell.url) } }));
          sheet.node.addAnnot(annotation);
        }
      });
      top += height;
    };
    const newPage = (repeat: boolean) => {
      sheet = pdf.addPage([792, 612]); top = 54;
      if (repeat) {
        const names = table.rows[2].cells.map((cell, index) => ({ ...cell, text: index ? table.rows[3].cells[index + 1]?.text || cell.text : "Continued comparison" }));
        for (const row of [table.rows[0], table.rows[1], { ...table.rows[2], cells: names }, table.rows[table.materialStart - 1]]) {
          // Long metadata was printed in full on the first page; keep repeated headers bounded.
          const lines = measure(row).map(value => value.slice(0, 2));
          draw(row, lines, 0, Math.max(...lines.map(value => value.length)));
        }
      }
    };
    newPage(false);
    for (const row of table.rows) {
      const lines = measure(row), count = Math.max(...lines.map(value => value.length));
      let offset = 0;
      while (offset < count) {
        let available = Math.floor((bottom - top - 6) / lineHeight);
        if (available < 1) { newPage(true); available = Math.floor((bottom - top - 6) / lineHeight); }
        // Keep normal rows together. Only unusually tall rows split their text across pages.
        if (offset === 0 && count > available && count * lineHeight + 6 <= 350 && top > 200) { newPage(true); available = Math.floor((bottom - top - 6) / lineHeight); }
        const take = Math.min(count - offset, available);
        draw(row, lines, offset, take); offset += take;
        if (offset < count) newPage(true);
      }
    }
  }
  pdf.getPages().forEach((page, index) => page.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: 50, y: 24, font: regular, size: 6 }));
  pdf.setTitle(`${report.data.request.ref} bid comparison v${report.version}`);
  pdf.setCreationDate(new Date(report.generatedAt)); pdf.setModificationDate(new Date(report.generatedAt));
  return Buffer.from(await pdf.save());
}
