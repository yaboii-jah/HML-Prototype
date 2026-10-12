import { rgb } from "pdf-lib";
import { generateCurrentComparisonPdf } from "./current-comparison-pdf.ts";
import { comparisonPages, comparisonAmount, comparisonPrice, comparisonTotal } from "../domain/comparison-layout.ts";
import { validBidReport } from "../domain/bid-reports.ts";
import type { BidReport } from "../domain/types.ts";
import { documentDate, documentMoney, documentTemplate, wrapText } from "./document-template.ts";

export async function generateBidPdf(report: BidReport) {
  if (!validBidReport(report)) throw new Error("The frozen bid report is invalid.");
  if (report.comparisonRevision === 2 || report.comparisonRevision === 3 || report.comparisonRevision === 4 || report.comparisonRevision === 5) return generateCurrentComparisonPdf(report);
  const template = await documentTemplate("comparison"), { pdf, text, regular, geometry } = template;
  const notes: string[] = [];
  const pages = comparisonPages(report);
  for (const [pageIndex, data] of pages.entries()) {
    const sheet = template.page();
    const field = (label: string, value: unknown, x: number, y: number, width: number, maxLines = 1, align: "left" | "center" | "right" = "center") => {
      const remaining = text(sheet, value, x, y, width, { size: 13.33, lineHeight: 16, maxLines, align });
      if (remaining.length) notes.push(`Page ${pageIndex + 1} — ${label}: ${String(value)}`);
    };
    field("Project", report.data.project.name, 101, 13, 202, 2, "left");
    field("Location", report.data.project.location, 101, 46, 202, 2, "left");
    field("Date", documentDate(report.generatedAt), 1113, 29, 101);
    field("MRF number", report.data.request.ref, 1113, 62, 202);
    data.offers.forEach((offer, index) => {
      const x = 609 + index * 202, supplier = offer.quote.supplierDetails;
      field("Supplier", offer.supplierName, x, 121, 202, 2);
      field(`${offer.supplierName} address`, supplier?.address || "", x, 154, 202, 4);
      field(`${offer.supplierName} contact`, supplier?.contactName || "", x, 223, 202);
      field(`${offer.supplierName} phone/email`, [supplier?.phone, supplier?.email].filter(Boolean).join(" / "), x, 244, 202);
      field(`${offer.supplierName} lead time`, `${offer.quote.leadDays} days`, x, 715, 202, 2);
      field(`${offer.supplierName} payment terms`, offer.quote.terms, x, 748, 202, 5);
      field(`${offer.supplierName} delivery`, offer.quote.deliveryTerms || "", x, 846, 202, 2);
      const url = offer.quote.archive?.files[0]?.url;
      if (url) { text(sheet, "Quotation documents", x, 879, 202, { size: 13.33, align: "center", color: rgb(0, .3, .8) }); template.link(sheet, url, x, 859, 202, 33); }
      field("Grand total", documentMoney(comparisonTotal(report, offer)), x + 101, 658, 101, 1, "right");
    });
    data.rows.forEach((row, index) => {
      const y = 340 + index * 21;
      if (row.first) { field("Item number", row.number, 0, y, 101); field(`Item ${row.number}`, row.item.name, 101, y, 202, 1, "left"); field("Quantity", row.item.quantity, 303, y, 101); field("Unit", row.item.unit, 404, y, 101); }
      row.lines.forEach((line, n) => { if (line) { field("Unit cost", documentMoney(comparisonPrice(line)), 609 + n * 202, y, 101, 1, "right"); field("Total cost", documentMoney(comparisonAmount(line)), 710 + n * 202, y, 101, 1, "right"); } });
    });
  }
  // Overflow text uses the same original grid, with references back to its first-page cell.
  const continuation = notes.flatMap(note => wrapText(note, regular, 13.33 * geometry.scale, 195 * geometry.scale));
  for (let start = 0; start < continuation.length; start += 13) {
    const sheet = template.page();
    text(sheet, "Continued cell contents", 101, 29, 303, { size: 13.33 });
    continuation.slice(start, start + 13).forEach((line, n) => text(sheet, line, 101, 340 + n * 21, 202, { size: 13.33, maxLines: 1 }));
  }
  template.footer(); pdf.setTitle(`${report.data.request.ref} bid comparison v${report.version}`); return Buffer.from(await pdf.save());
}
