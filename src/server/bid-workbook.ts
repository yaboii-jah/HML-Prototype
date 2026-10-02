import { populateComparisonSheet, comparisonSheetPages } from "./comparison-workbook.ts";
import { buildCurrentComparisonWorkbook } from "./current-comparison-workbook.ts";
import { comparisonOverflow } from "./comparison-overflow.ts";
import { poFinancialBreakdown } from "../domain/pricing.ts";
import ExcelJS from "exceljs";
import { bidLines, bidPoLines, bidPoTotal, bidQuoteTotal, validBidReport } from "../domain/bid-reports.ts";
import { poLineTotal, quoteLineTotal, roundMoney } from "../domain/pricing.ts";
import type { BidReport, POAdjustment, QuoteAdjustment } from "../domain/types.ts";

const MONEY = '"₱" #,##0.00;[Red]("₱" #,##0.00)';
const QUANTITY = '#,##0.####';
const NAVY = "17334F";
const GREY = "EDF1F5";

function header(sheet: ExcelJS.Worksheet, report: BidReport, columns: number, title: string) {
  sheet.mergeCells(1, 1, 1, columns);
  sheet.getCell(1, 1).value = `HML ConstructSync · ${title}`;
  sheet.getCell(1, 1).font = { bold: true, size: 19, color: { argb: NAVY } };
  sheet.getRow(1).height = 30;
  for (const [index, text] of [
    `Project: ${report.data.project.name} · Location: ${report.data.project.location}`,
    `MRF: ${report.data.request.ref} · Request date: ${report.data.request.requestDate}`,
    `Procurement: ${report.data.request.purchaser || "Not recorded"}`,
    `Report v${report.version} · Generated: ${report.generatedAt} · PHP · Fixed snapshot of recorded bids and awards`,
  ].entries()) { sheet.mergeCells(index + 2, 1, index + 2, columns); sheet.getCell(index + 2, 1).value = text; }
  sheet.views = [{ state: "frozen", xSplit: sheet.name === "Bid comparison" ? 5 : 0, ySplit: 8 }];
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:8" };
  sheet.headerFooter.oddFooter = "&L HML ConstructSync &R Page &P of &N";
}

function headings(sheet: ExcelJS.Worksheet, row: number, labels: string[]) {
  const result = sheet.getRow(row);
  labels.forEach((label, index) => { result.getCell(index + 1).value = label; });
  result.height = 38;
  result.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; cell.font = { bold: true, color: { argb: "FFFFFF" } }; cell.alignment = { wrapText: true, vertical: "middle" }; });
}

function formula(cell: ExcelJS.Cell, expression: string, result: number, money = true) {
  if (!Number.isFinite(result)) throw new Error("A report calculation is not finite. Review the quotation and PO amounts.");
  cell.value = { formula: expression, result };
  cell.numFmt = money ? MONEY : QUANTITY;
}

function linePricing(sheet: ExcelJS.Worksheet, row: number, start: number, quantity: number, price: number, kind: string, discount: number, tax: number, total: number) {
  // Six inputs followed by base, discount, after-discount, tax amount, and line total.
  [quantity, price, kind, discount, tax].forEach((value, i) => { sheet.getCell(row, start + i).value = value; });
  const at = (offset: number) => sheet.getCell(row, start + offset).address;
  const base = roundMoney(quantity * price);
  const discountAmount = kind === "percentage" ? roundMoney(base * discount / 100) : kind === "fixed" ? discount : 0;
  const after = Math.max(0, roundMoney(base - discountAmount));
  formula(sheet.getCell(row, start + 5), `ROUND(${at(0)}*${at(1)},2)`, base);
  formula(sheet.getCell(row, start + 6), `IF(${at(2)}="percentage",ROUND(${at(5)}*${at(3)}/100,2),IF(${at(2)}="fixed",${at(3)},0))`, discountAmount);
  formula(sheet.getCell(row, start + 7), `MAX(0,ROUND(${at(5)}-${at(6)},2))`, after);
  formula(sheet.getCell(row, start + 8), `ROUND(${at(7)}*${at(4)}/100,2)`, roundMoney(after * tax / 100));
  formula(sheet.getCell(row, start + 9), `ROUND(${at(7)}+${at(8)},2)`, total);
  sheet.getCell(row, start).numFmt = QUANTITY;
  sheet.getCell(row, start + 1).numFmt = MONEY;
}

function totals(sheet: ExcelJS.Worksheet, amountColumn: number, labelColumn: number, subtotalRow: number, subtotal: number, adjustments: (QuoteAdjustment | POAdjustment)[], total: number, rounded: boolean) {
  sheet.getCell(subtotalRow, labelColumn).value = "Line subtotal";
  const subtotalCell = sheet.getCell(subtotalRow, amountColumn).address;
  let row = subtotalRow;
  for (const adjustment of adjustments) {
    row++;
    sheet.getCell(row, labelColumn).value = `${adjustment.label} · ${adjustment.kind}${"included" in adjustment && !adjustment.included ? " (excluded)" : ""}`;
    sheet.getCell(row, amountColumn - 1).value = adjustment.value;
    const input = sheet.getCell(row, amountColumn - 1).address;
    const included = !("included" in adjustment) || adjustment.included;
    const value = !included ? 0 : adjustment.calculation === "percentage" ? roundMoney(subtotal * adjustment.value / 100) : adjustment.value;
    const expression = !included ? "0" : `${adjustment.kind === "discount" ? "-" : ""}${adjustment.calculation === "percentage" ? `ROUND(${subtotalCell}*${input}/100,2)` : input}`;
    formula(sheet.getCell(row, amountColumn), expression, adjustment.kind === "discount" ? -value : value);
    sheet.getCell(row, labelColumn + 1).value = adjustment.calculation;
  }
  const expression = row === subtotalRow ? subtotalCell : `${subtotalCell}+SUM(${sheet.getCell(subtotalRow + 1, amountColumn).address}:${sheet.getCell(row, amountColumn).address})`;
  row++;
  sheet.getCell(row, labelColumn).value = "Total (PHP)";
  formula(sheet.getCell(row, amountColumn), rounded ? `ROUND(${expression},2)` : expression, total);
  sheet.getRow(row).font = { bold: true };
  return row;
}

const legacyCharges = (value: { tax?: number; freight?: number; discount?: number }): QuoteAdjustment[] => [
  { id: "tax", label: "Tax", kind: "tax", calculation: "fixed", value: value.tax || 0 },
  { id: "freight", label: "Freight", kind: "shipping", calculation: "fixed", value: value.freight || 0 },
  { id: "discount", label: "Discount", kind: "discount", calculation: "fixed", value: value.discount || 0 },
];

export function buildBidWorkbook(report: BidReport) {
  if (!validBidReport(report)) throw new Error("The frozen bid report is invalid.");
  if ((report.comparisonRevision === 2 || report.comparisonRevision === 3)) return buildCurrentComparisonWorkbook(report);
  const book = new ExcelJS.Workbook();
  book.creator = "HML ConstructSync";
  book.created = new Date(report.generatedAt); book.modified = new Date(report.generatedAt);
  book.calcProperties.fullCalcOnLoad = true;
  const comparisonPages = comparisonSheetPages(report);
  const comparisonSheets = comparisonPages.map((page,index) => book.addWorksheet(index === 0 ? "Bid comparison" : `Comparison ${index + 1}`));
  const details = book.addWorksheet("Quotation details");
  const awards = book.addWorksheet("Awards");
  const { data } = report;

  header(details, report, 23, "Quotation details");
  header(awards, report, 18, "Awards");
  headings(details, 8, ["Supplier", "Quotation", "Revision", "Revision use", "MRF material", "Offered material", "Unit", "Conversion to MRF unit", "Quoted quantity", "Original unit price", "Discount type", "Discount value", "Tax %", "Base", "Discount", "After discount", "Tax amount", "Quoted amount", "MRF quantity", "Effective price / MRF unit", "Brand / specification", "Difference / notes", "Supplier item code"]);
  const detailRows = new Map<string, number>();
  const quoteTotals = new Map<string, number>();
  for (const offer of data.offers) {
    const { quote } = offer;
    let subtotal = 0;
    const first = details.rowCount + 1;
    for (const line of bidLines(data, quote)) {
      const item = data.request.items.find(value => value.id === line.requestItemId);
      const total = quoteLineTotal(line);
      subtotal += total;
      const row = details.addRow([offer.supplierName, quote.ref, quote.version || 1, offer.source, item?.name || "Unmatched", line.description, line.unit, item ? line.conversionFactor : null]);
      detailRows.set(`${quote.id}/${line.id}`, row.number);
      linePricing(details, row.number, 9, line.quantity, line.unitPrice, line.discountType || "none", line.discountValue || 0, line.taxRate || 0, total);
      if (item) {
        formula(row.getCell(19), `I${row.number}*H${row.number}`, line.quantity * line.conversionFactor, false);
        formula(row.getCell(20), `R${row.number}/S${row.number}`, total / (line.quantity * line.conversionFactor));
      }
      row.getCell(21).value = [line.brand, line.specification].filter(Boolean).join(" · ");
      row.getCell(22).value = [line.varianceReason, line.notes, quote.extraction === "legacy" || !quote.lines ? "Legacy quantities inferred from MRF" : ""].filter(Boolean).join(" · ");
      row.getCell(23).value = line.supplierItemCode || "";
    }
    const subtotalRow = details.rowCount + 1;
    formula(details.getCell(subtotalRow, 18), subtotalRow > first ? `SUM(R${first}:R${subtotalRow - 1})` : "0", subtotal);
    const totalRow = totals(details, 18, 1, subtotalRow, subtotal, quote.lines ? quote.adjustments || legacyCharges(quote) : [], bidQuoteTotal(data, quote), !!quote.adjustments);
    quoteTotals.set(quote.id, totalRow);
    details.addRow(["Commercial terms", quote.terms, "Availability", quote.available, "Lead days", quote.leadDays, "Validity", quote.validity || "", "Quote date", quote.quoteDate || "", "Delivery terms", quote.deliveryTerms || ""]);
    details.addRow(["Supplier contact", quote.supplierDetails?.contactName || "", quote.supplierDetails?.phone || "", quote.supplierDetails?.email || "", quote.supplierDetails?.address || "", "TIN", quote.supplierDetails?.tin || "", "Notes", quote.quoteNotes || ""]);
    details.addRow([]);
  }

  headings(awards, 8, ["PO", "Supplier", "Source quotation", "Revision", "PO state", "Material / charge", "Unit", "Award quantity", "Unit price", "Discount type", "Discount value", "Tax %", "Base", "Discount", "After discount", "Tax amount", "Amount", "Selection reason / notes"]);
  const awardRows = new Map<string, number[]>();
  for (const po of data.pos) {
    const offer = data.offers.find(value => value.quote.id === po.quoteId)!;
    const financial = po.financial ? poFinancialBreakdown(po) : undefined;
    const vatRate = po.financial?.vatStatus === "VAT" && po.financial.priceBasis === "exclusive" ? po.financial.vatRate : 0;
    const first = awards.rowCount + 1;
    let subtotal = 0;
    for (const [index, line] of bidPoLines(data, po).entries()) {
      const item = data.request.items.find(value => value.id === line.itemId);
      const row = awards.addRow([po.ref, offer.supplierName, offer.quote.ref, offer.quote.version || 1, po.status, item?.name || line.itemId, item?.unit || ""]);
      const total = financial ? financial.lines[index].amount : poLineTotal(line); subtotal += total;
      linePricing(awards, row.number, 8, line.quantity, line.unitPrice, line.discountType || "none", line.discountValue || 0, financial ? vatRate : line.taxRate || 0, total);
      row.getCell(18).value = [po.selectionReason, po.notes, po.supersededReason, !po.lines ? "Legacy award quantities inferred from MRF" : ""].filter(Boolean).join(" · ");
      awardRows.set(line.itemId, [...awardRows.get(line.itemId) || [], row.number]);
    }
    const row = awards.rowCount + 1;
    formula(awards.getCell(row, 17), row > first ? `SUM(Q${first}:Q${row - 1})` : "0", subtotal);
    if (po.financial && financial) {
      awards.getCell(row, 6).value = `Line subtotal · ${po.financial.vatStatus} · ${po.financial.priceBasis} · VAT ${po.financial.vatRate}%`;
      const inputSubtotal = first < row ? `SUM(O${first}:O${row - 1})` : "0";
      for (const entry of financial.adjustments) {
        const adjustmentRow = awards.addRow([po.ref, offer.supplierName, "", "", "", `${entry.adjustment.label} · ${entry.adjustment.taxable === false ? "VAT exempt" : "VAT taxable"}`]);
        adjustmentRow.getCell(16).value = entry.adjustment.value;
        const input = `P${adjustmentRow.number}`;
        const base = entry.adjustment.calculation === "percentage" ? `ROUND(${inputSubtotal}*${input}/100,2)` : input;
        const multiplier = entry.adjustment.taxable === false ? 1 : 1 + vatRate / 100;
        formula(adjustmentRow.getCell(17), `${entry.adjustment.kind === "discount" ? "-" : ""}ROUND((${base})*${multiplier},2)`, entry.amount);
      }
      const grossRow = awards.addRow([po.ref, offer.supplierName, "", "", "", "Gross purchase value"]).number;
      formula(awards.getCell(grossRow, 17), `ROUND(SUM(Q${row}:Q${grossRow - 1}),2)`, financial.gross);
      for (const [label, amount] of [["EWT (goods)", financial.ewtGoods], ["EWT (services)", financial.ewtServices]] as const) {
        const deduction = awards.addRow([po.ref, offer.supplierName, "", "", "", label]);
        deduction.getCell(16).value = amount;
        formula(deduction.getCell(17), `-P${deduction.number}`, -amount);
      }
      const net = awards.addRow([po.ref, offer.supplierName, "", "", "", "Net supplier payable"]);
      formula(net.getCell(17), `ROUND(SUM(Q${grossRow}:Q${net.number - 1}),2)`, financial.net);
      net.font = { bold: true };
    } else if (!po.lines) {
      awards.getCell(row + 1, 6).value = "Legacy PO total from source quotation";
      formula(awards.getCell(row + 1, 17), `'Quotation details'!R${quoteTotals.get(po.quoteId)}`, bidPoTotal(data, po));
    } else totals(awards, 17, 6, row, subtotal, po.adjustments || legacyCharges(po), bidPoTotal(data, po), !!po.adjustments);
    awards.addRow([]);
  }
  awards.addRow(["MRF award coverage"]);
  const coverage = awards.addRow(["Material", "Unit", "Requested", "Awarded", "Remaining"]);
  coverage.font = { bold: true };
  for (const item of data.request.items) {
    const rows = awardRows.get(item.id) || [];
    const quantity = data.pos.reduce((sum, po) => sum + bidPoLines(data, po).filter(line => line.itemId === item.id).reduce((n, line) => n + line.quantity, 0), 0);
    const row = awards.addRow([item.name, item.unit, item.quantity]);
    formula(row.getCell(4), rows.length ? `SUM(${rows.map(n => `H${n}`).join(",")})` : "0", quantity, false);
    formula(row.getCell(5), `MAX(0,C${row.number}-D${row.number})`, Math.max(0, item.quantity - quantity), false);
  }
  for (const sheet of [details, awards]) {
    sheet.columns.forEach((column, i) => { column.width = i === 0 ? 30 : 20; });
    sheet.eachRow((row, index) => { if (index <= 8) return; row.eachCell(cell => { cell.alignment = { wrapText: true, vertical: "top" }; cell.border = { bottom: { style: "hair", color: { argb: "D5DEE6" } } }; if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; }); });
  }
  comparisonSheets.forEach((sheet,index) => populateComparisonSheet(sheet, report, comparisonPages[index], detailRows, quoteTotals));
  const overflow = comparisonOverflow(comparisonSheets);
  for (let start = 0; start < overflow.length; start += 13) {
    const sheet = book.addWorksheet(`Continued text ${start / 13 + 1}`);
    populateComparisonSheet(sheet, report, { offers: [], rows: [], supplierOffset: 0, rowOffset: 0 }, detailRows, quoteTotals);
    sheet.getCell("B1").value = "Continued cell contents";
    overflow.slice(start, start + 13).forEach((line, index) => { sheet.getCell(index + 12, 2).value = line; });
  }
  // Lowest-price annotations stay off the company comparison layout.
  for (const item of data.request.items) {
    const candidates = data.offers.filter(offer => offer.source !== "PO source").flatMap(offer => bidLines(data, offer.quote).filter(line => line.requestItemId === item.id).map(line => ({ row: detailRows.get(`${offer.quote.id}/${line.id}`)!, price: quoteLineTotal(line)/(line.quantity*line.conversionFactor) })));
    const lowest = Math.min(...candidates.map(value => value.price));
    candidates.filter(value => value.price === lowest).forEach(value => { details.getCell(value.row,20).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "C7E9DA" } }; details.getCell(value.row,20).note = "Lowest effective price for this MRF material; supplier selection remains manual."; });
  }
  return book;
}

export async function generateBidWorkbook(report: BidReport) {
  return Buffer.from(await buildBidWorkbook(report).xlsx.writeBuffer());
}
