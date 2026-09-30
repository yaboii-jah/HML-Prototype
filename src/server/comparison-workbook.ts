import type ExcelJS from "exceljs";
import { COMPARISON_COLORS, comparisonAmount, comparisonPages, comparisonPrice, comparisonTotal, type ComparisonPage } from "../domain/comparison-layout.ts";
import type { BidReport } from "../domain/types.ts";

export function populateComparisonSheet(sheet: ExcelJS.Worksheet, report: BidReport, page: ComparisonPage, detailRows: Map<string, number>, quoteTotals: Map<string, number>) {
  const widths = [101, 202, 101, 101, 104, ...Array(22).fill(101)];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = (width - 5) / 7; });
  const heights = [33, 33, 21, 21, 33, 66, 21, 21, 33, 20, 21, ...Array(13).fill(21), 33, 33, 33, 33, 98, 33, 33];
  heights.forEach((height, index) => { sheet.getRow(index + 1).height = height * .75; });
  for (let row = 1; row <= 31; row++) for (let col = 1; col <= 27; col++) {
    const cell = sheet.getCell(row, col);
    cell.font = { name: "Arial", size: 10, color: { argb: "000000" } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = { top: { style: "thin", color: { argb: row >= 4 ? "000000" : "D9D9D9" } }, bottom: { style: "thin", color: { argb: row >= 4 ? "000000" : "D9D9D9" } }, left: { style: "thin", color: { argb: row >= 4 ? "000000" : "D9D9D9" } }, right: { style: "thin", color: { argb: row >= 4 ? "000000" : "D9D9D9" } } };
    if (row >= 4 && col >= 6) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COMPARISON_COLORS[Math.floor((col - 6) / 2)] } };
    else if (row >= 11 && row <= 27) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "D9D9D9" } };
  }
  const value = (row: number, col: number, content: ExcelJS.CellValue, bold = false) => { const cell = sheet.getCell(row, col); cell.value = content; cell.font = { ...cell.font, bold }; return cell; };
  const merge = (row: number, start: number, end: number, content: ExcelJS.CellValue) => { sheet.mergeCells(row, start, row, end); return value(row, start, content); };
  value(1, 1, "PROJECT", true); merge(1, 2, 3, report.data.project.name);
  value(2, 1, "LOCATION", true); merge(2, 2, 3, report.data.project.location);
  value(1, 10, "DATE", true); value(1, 11, new Date(report.generatedAt)); sheet.getCell(1, 11).numFmt = "m/d/yyyy";
  value(2, 10, "MRF NO.", true); merge(2, 11, 13, report.data.request.ref);
  sheet.mergeCells(5, 1, 10, 1); value(5, 1, "Supplier\nInformation").font = { name: "Arial", size: 10, bold: true, italic: true };
  for (const [row, label] of [[5, "Business Name"], [6, "Office Location/Supply\nLocation"], [7, "Contact Person"], [8, "Contact No./email"], [9, "Link to accreditation\ndocuments"]] as const) { const cell = merge(row, 2, 5, label); cell.font = { ...cell.font, bold: true }; cell.alignment = { ...cell.alignment, horizontal: "left" }; }
  ["ITEM NO.", "DESCRIPTION", "QTY", "UNIT", "BOQ AMOUNT"].forEach((label, index) => value(11, index + 1, label, true));
  sheet.mergeCells(28, 1, 31, 1); value(28, 1, "Proposal\nTerms and\nSchedule").font = { name: "Arial", size: 10, bold: true, italic: true };
  for (const [row, label] of [[28, "Lead Time"], [29, "Payment Terms"], [30, "Delivery Schedule"], [31, "Link to Quotation"]] as const) merge(row, 2, 5, label).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  for (let n = 0; n < 11; n++) {
    const col = 6 + n * 2;
    merge(4, col, col + 1, `SUPPLIER ${String.fromCharCode(65 + n)}`).font = { name: "Arial", size: 10, bold: true };
    value(11, col, "UNIT COST", true); value(11, col + 1, "TOTAL COST", true);
    value(26, col, "GRAND\nTOTAL", true);
    for (const row of [5, 6, 7, 8, 9, 10, 28, 29, 30, 31]) merge(row, col, col + 1, "");
    const offer = page.offers[n]; if (!offer) continue;
    value(5, col, offer.supplierName); value(6, col, offer.quote.supplierDetails?.address || ""); value(7, col, offer.quote.supplierDetails?.contactName || "");
    value(8, col, [offer.quote.supplierDetails?.phone, offer.quote.supplierDetails?.email].filter(Boolean).join(" / "));
    value(28, col, `${offer.quote.leadDays} days`); value(29, col, offer.quote.terms); value(30, col, offer.quote.deliveryTerms || "");
    const source = offer.quote.archive?.files[0]; if (source) value(31, col, { text: "Quotation documents", hyperlink: source.url });
    value(26, col + 1, { formula: `'Quotation details'!R${quoteTotals.get(offer.quote.id)}`, result: comparisonTotal(report, offer) });
    page.rows.forEach((row, index) => {
      const line = row.lines[n]; if (!line) return;
      const sourceRow = detailRows.get(`${offer.quote.id}/${line.id}`)!;
      value(12 + index, col, { formula: `'Quotation details'!T${sourceRow}`, result: comparisonPrice(line) });
      value(12 + index, col + 1, { formula: `'Quotation details'!R${sourceRow}`, result: comparisonAmount(line) });
      sheet.getCell(12 + index, col).note = `${line.description}\nOffered ${line.quantity} ${line.unit}; ${line.quantity * line.conversionFactor} MRF units. See Quotation details.`;
    });
  }
  page.rows.forEach((row, index) => { if (row.first) [row.number, row.item.name, row.item.quantity, row.item.unit].forEach((content, col) => value(12 + index, col + 1, content)); });
  for (let row = 12; row <= 27; row++) for (let col = 6; col <= 27; col++) { sheet.getCell(row, col).numFmt = "#,##0.00"; sheet.getCell(row, col).alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }
  sheet.getColumn(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.views = [{ state: "frozen", xSplit: 5, ySplit: 11, showGridLines: false }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: "A1:AA31", margins: { left: 50.313 / 72, right: 50 / 72, top: 53.977 / 72, bottom: 338 / 72, header: 0, footer: 0 } };
}
export const comparisonSheetPages = comparisonPages;
