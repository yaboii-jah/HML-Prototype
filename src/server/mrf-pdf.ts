import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { MRF } from "@/src/domain/types";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const LEFT = 48;
const RIGHT = WIDTH - LEFT;
const ink = rgb(0.11, 0.17, 0.24);
const muted = rgb(0.35, 0.42, 0.49);
const rule = rgb(0.82, 0.86, 0.89);
const clean = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function generateMrfPdf(request: MRF, projectName: string) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - 52;
  const freshPage = () => { page = pdf.addPage([WIDTH, HEIGHT]); y = HEIGHT - 52; };
  const need = (height: number) => { if (y - height < 50) freshPage(); };
  const drawLine = (text: string, font: PDFFont, size: number, color: typeof ink, indent: number) => {
    need(size + 8);
    page.drawText(text, { x: LEFT + indent, y, font, size, color });
    y -= size + 7;
  };
  const line = (text: string, font: PDFFont = regular, size = 10, color = ink, indent = 0) => {
    const width = RIGHT - LEFT - indent - 6;
    const words = clean(text).split(/\s+/);
    let current = "";
    for (const word of words) {
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
      if (current) { drawLine(current, font, size, color, indent); current = ""; }
      let remaining = word;
      while (font.widthOfTextAtSize(remaining, size) > width) {
        let cut = 1;
        while (cut < remaining.length && font.widthOfTextAtSize(remaining.slice(0, cut + 1), size) <= width) cut++;
        drawLine(remaining.slice(0, cut), font, size, color, indent);
        remaining = remaining.slice(cut);
      }
      current = remaining;
    }
    if (current) drawLine(current, font, size, color, indent);
  };
  const wrapped = (label: string, value: unknown) => line(`${label}: ${clean(value) || "-"}`);
  const section = (title: string) => {
    need(35);
    y -= 7;
    page.drawLine({ start: { x: LEFT, y: y + 7 }, end: { x: RIGHT, y: y + 7 }, thickness: 0.8, color: rule });
    line(title.toUpperCase(), bold, 10, muted);
  };

  line("MATERIAL REQUEST FORM", bold, 18);
  line(clean(projectName), bold, 12);
  y -= 5;
  section("Request information");
  wrapped("M.R.F No.", request.ref);
  wrapped("Request Date", request.requestDate);
  wrapped("PM approved at", request.archive?.approvedAt || request.updatedAt);
  wrapped("Requested by", request.requestedBy);
  wrapped("Approved by", request.approvedBy);
  wrapped("Purchaser / Procurement Officer", request.purchaser);
  wrapped("Finance Officer", request.financeOfficer);
  section("Materials");
  request.items.forEach((item, index) => {
    need(90);
    line(`${index + 1}. ${clean(item.name)}`, bold, 11);
    wrapped("Quantity", `${item.quantity} ${item.unit}`);
    wrapped("Date needed", item.neededDate);
    wrapped("Purpose", item.purpose);
    wrapped("Delivery location", item.location);
    if (item.remarks) wrapped("Remarks", item.remarks);
    y -= 7;
  });
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`Generated from approved MRF data - Page ${index + 1} of ${pages.length}`, { x: LEFT, y: 28, font: regular, size: 8, color: muted }));
  return pdf.save();
}
