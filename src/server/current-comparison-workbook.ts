import ExcelJS from "exceljs";
import { comparisonOffers } from "../domain/comparison-report.ts";
import type { BidReport } from "../domain/types.ts";
import { buildComparisonTable } from "./comparison-table.ts";
import type { ComparisonTableRow } from "./comparison-table.ts";
import { arialMetrics } from "./arial-metrics.ts";
import { wrapText } from "./document-template.ts";

export function buildCurrentComparisonWorkbook(report: BidReport) {
  const book = new ExcelJS.Workbook();
  book.creator = "HML ConstructSync";
  book.created = new Date(report.generatedAt); book.modified = new Date(report.generatedAt);
  book.calcProperties.fullCalcOnLoad = true;
  const sheet = book.addWorksheet("Bid comparison");
  const table = buildComparisonTable(report, comparisonOffers(report.data));
  // Keep columns usable in Excel even when many suppliers require printed pages.
  table.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = Math.max(index === 0 ? 14 : index < 5 ? 7 : 16, width / 5); });
  const rows: { row: ComparisonTableRow; height: number }[] = [];
  let materialStart = 0, materialEnd = 0;
  table.rows.forEach(row => {
    if (row.section === "material" && !materialStart) materialStart = rows.length + 1;
    const wrapped = row.cells.map(value => {
      let width = 0;
      for (let n = value.column + 1; n <= value.column + value.span; n++) width += ((sheet.getColumn(n).width || 16) * 7 + 5) * .75;
      return wrapText(value.text, arialMetrics(value.bold), 10, Math.max(1, width - 8));
    });
    const count = Math.max(...wrapped.map(value => value.length));
    for (let offset = 0; offset < count; offset += 25) {
      const cells = row.cells.map((value, index) => ({ ...value, text: wrapped[index].slice(offset, offset + 25).join("\n"), number: offset ? undefined : value.number, kind: offset ? undefined : value.kind }));
      rows.push({ row: { ...row, cells }, height: Math.max(22, Math.min(25, count - offset) * 15 + 8) });
    }
    if (row.section === "material") materialEnd = rows.length;
  });
  rows.forEach(({ row, height }, index) => {
    row.cells.forEach(value => {
      const column = value.column + 1, cell = sheet.getCell(index + 1, column);
      if (value.span > 1) sheet.mergeCells(index + 1, column, index + 1, column + value.span - 1);
      cell.value = value.number ?? value.text;
      if (value.kind === "amount" && value.number !== undefined) cell.value = { formula: `ROUND(C${index + 1}*${sheet.getCell(index + 1, column - 1).address},2)`, result: value.number };
      if (value.kind === "total") cell.value = { formula: `ROUND(SUM(${sheet.getCell(materialStart, column).address}:${sheet.getCell(materialEnd, column).address}),2)`, result: value.number };
      if (value.url) { cell.value = { text: value.text || "Quotation documents", hyperlink: value.url }; }
      if (value.note) cell.note = value.note;
      cell.font = { name: "Arial", size: 10, bold: value.bold, color: { argb: value.url ? "0055AA" : "000000" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      if (value.color) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: value.color } };
      if (value.kind) cell.numFmt = value.kind === "price" ? "#,##0.00####" : value.kind === "quantity" ? "#,##0.######" : "#,##0.00";
    });
    sheet.getRow(index + 1).height = height;
  });
  sheet.views = [{ state: "normal", showGridLines: false }];
  // OOXML's Letter value is 1; ExcelJS omits it from its PaperSize enum.
  sheet.pageSetup = { orientation: "landscape", paperSize: 1 as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${materialStart - 1}:${materialStart - 1}`, printArea: `A1:${sheet.getCell(rows.length, table.widths.length).address}`, margins: { left: .4, right: .4, top: .4, bottom: .4, header: .2, footer: .2 } };
  sheet.headerFooter.oddFooter = "&L Bid comparison &R Page &P of &N";
  return book;
}
