import { comparisonCoverage, quotedComparisonPrice, requiredComparisonAmount, selectedComparisonLine } from "../domain/comparison-report.ts";
import { COMPARISON_COLORS } from "../domain/comparison-layout.ts";
import type { BidOffer, BidReport } from "../domain/types.ts";
import { documentDate, documentMoney } from "./document-template.ts";

export type ComparisonCell = { column: number; span: number; text: string; number?: number; kind?: "quantity" | "price" | "amount" | "total"; color?: string; bold?: boolean; url?: string; note?: string };
export type ComparisonTableRow = { cells: ComparisonCell[]; section: "metadata" | "supplier" | "heading" | "material" | "total" | "terms" };
export type ComparisonTable = { widths: number[]; rows: ComparisonTableRow[]; materialStart: number; materialEnd: number; totalRow: number; fontSize: number };
const supplierLabel = (index: number) => {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return `SUPPLIER ${label}`;
};

export function buildComparisonTable(report: BidReport, offers: BidOffer[], supplierOffset = 0): ComparisonTable {
  const supplierWidth = (692 - 285) / Math.max(1, offers.length);
  const widths = [50, 120, 35, 35, 45, ...offers.flatMap(() => [supplierWidth / 2, supplierWidth / 2])];
  const rows: ComparisonTableRow[] = [];
  const fontSize = Math.min(8, Math.max(3.3, supplierWidth / 15));
  const supplierCells = (values: string[], bold = false): ComparisonCell[] => offers.map((_, index) => ({ column: 5 + index * 2, span: 2, text: values[index] || "", color: COMPARISON_COLORS[(supplierOffset + index) % COMPARISON_COLORS.length], bold }));
  const add = (section: ComparisonTableRow["section"], cells: ComparisonCell[]) => { rows.push({ section, cells }); };
  const info = (section: "supplier" | "terms", group: string, label: string, values: string[]) => {
    add(section, [{ column: 0, span: 1, text: group, bold: true }, { column: 1, span: 4, text: label, bold: true }, ...supplierCells(values)]);
  };
  add("metadata", [{ column: 0, span: 1, text: "PROJECT", bold: true }, { column: 1, span: 4, text: report.data.project.name }, { column: 5, span: 2 * offers.length, text: `DATE: ${documentDate(report.generatedAt)}`, bold: true }]);
  add("metadata", [{ column: 0, span: 1, text: "LOCATION", bold: true }, { column: 1, span: 4, text: report.data.project.location }, { column: 5, span: 2 * offers.length, text: `MRF NO.: ${report.data.request.ref}`, bold: true }]);
  add("supplier", [{ column: 0, span: 5, text: "" }, ...supplierCells(offers.map((_, index) => supplierLabel(supplierOffset + index)), true)]);
  info("supplier", "Supplier\nInformation", "Business Name", offers.map(offer => offer.supplierName));
  info("supplier", "", "Office Location / Supply Location", offers.map(offer => offer.quote.supplierDetails?.address || ""));
  info("supplier", "", "Contact Person", offers.map(offer => offer.quote.supplierDetails?.contactName || ""));
  info("supplier", "", "Contact No. / email", offers.map(offer => [offer.quote.supplierDetails?.phone, offer.quote.supplierDetails?.email].filter(Boolean).join(" / ")));
  info("supplier", "", "Link to accreditation documents", offers.map(() => ""));
  add("heading", ["ITEM NO.", "DESCRIPTION", "QTY", "UNIT", "BOQ AMOUNT", ...offers.flatMap(() => ["UNIT COST", "TOTAL COST"])].map((text, column) => ({ column, span: 1, text, bold: true, color: column < 5 ? "D9D9D9" : COMPARISON_COLORS[(supplierOffset + Math.floor((column - 5) / 2)) % COMPARISON_COLORS.length] })));
  const materialStart = rows.length;
  report.data.request.items.forEach((item, index) => {
    const cells: ComparisonCell[] = [String(index + 1), item.name, String(item.quantity), item.unit, ""].map((text, column) => ({ column, span: 1, text, number: column === 2 ? item.quantity : undefined, kind: column === 2 ? "quantity" : undefined, color: "D9D9D9" }));
    offers.forEach((offer, n) => {
      const line = selectedComparisonLine(report, offer, item);
      const color = COMPARISON_COLORS[(supplierOffset + n) % COMPARISON_COLORS.length];
      const price = line ? quotedComparisonPrice(line) : undefined;
      const amount = line ? requiredComparisonAmount(item, line) : undefined;
      const note = line ? `${line.description}\nOffered ${line.quantity} ${line.unit}; ${line.quantity * line.conversionFactor} ${item.unit}.` : "Not quoted";
      cells.push({ column: 5 + n * 2, span: 1, text: price === undefined ? "" : price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 6 }), number: price, kind: "price", color, note });
      cells.push({ column: 6 + n * 2, span: 1, text: amount === undefined ? "" : documentMoney(amount), number: amount, kind: "amount", color });
    });
    add("material", cells);
  });
  const materialEnd = rows.length;
  const totalRow = rows.length;
  add("total", [{ column: 0, span: 5, text: "Required MRF quantity × quoted unit cost. Excludes tax, discounts and freight.", color: "D9D9D9" }, ...offers.flatMap((offer, n) => {
    const coverage = comparisonCoverage(report, offer), color = COMPARISON_COLORS[(supplierOffset + n) % COMPARISON_COLORS.length];
    return [{ column: 5 + n * 2, span: 1, text: coverage.complete ? "GRAND TOTAL" : "INCOMPLETE TOTAL", bold: true, color }, { column: 6 + n * 2, span: 1, text: documentMoney(coverage.total), number: coverage.total, kind: "total" as const, color, bold: true }];
  })]);
  info("terms", "Proposal\nTerms and\nSchedule", "Lead Time", offers.map(offer => `${offer.quote.leadDays} days`));
  info("terms", "", "Payment Terms", offers.map(offer => offer.quote.terms));
  info("terms", "", "Delivery Schedule", offers.map(offer => offer.quote.deliveryTerms || ""));
  info("terms", "", "Quotation Coverage", offers.map(offer => comparisonCoverage(report, offer).gaps.join("\n") || "Full required quantity quoted"));
  for (let n = 0; n < Math.max(1, ...offers.map(offer => offer.quote.archive?.files.length || 0)); n++) {
    const links = supplierCells(offers.map(offer => offer.quote.archive?.files[n]?.name || ""));
    links.forEach((cell, index) => { cell.url = offers[index].quote.archive?.files[n]?.url; });
    add("terms", [{ column: 0, span: 1, text: "" }, { column: 1, span: 4, text: n ? "Additional Quotation Document" : "Link to Quotation", bold: true }, ...links]);
  }
  return { widths, rows, materialStart, materialEnd, totalRow, fontSize };
}
