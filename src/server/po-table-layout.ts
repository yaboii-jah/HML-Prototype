import { rgb, type PDFPage } from "pdf-lib";
import type { MRF, PO, Quote } from "../domain/types.ts";
import { documentDate, documentMoney, documentTemplate, wrapText } from "./document-template.ts";
import type { poFinancialBreakdown } from "../domain/pricing.ts";

export function drawPoLayout(template: Awaited<ReturnType<typeof documentTemplate>>, po: PO, request: MRF, quote: Quote, projectName: string, rows: string[][], financial: ReturnType<typeof poFinancialBreakdown>) {
  const { regular, bold, pdf, geometry } = template;
  const blue = rgb(0, .36, .68), grey = rgb(.88, .89, .94), edge = rgb(.75, .75, .75);
  const left = 36, size = 7.5, leading = 10;
  const info = po.document;
  const supplierDetails = !po.supplierId || po.supplierId === quote.supplierId ? quote.supplierDetails : undefined;
  const extra: string[][] = [];
  const lines = (value: unknown, cellWidth: number, strong = false) => wrapText(value, strong ? bold : regular, size, cellWidth - 6);
  const write = (page: PDFPage, value: string[], x: number, top: number, cellWidth: number, align: "left" | "center" | "right" = "left", strong = false, white = false) => value.forEach((text, index) => {
    if (!text) return;
    const font = strong ? bold : regular, spare = cellWidth - 6 - font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x + 3 + (align === "center" ? spare / 2 : align === "right" ? spare : 0), y: 792 - top - size - index * leading, font, size, color: white ? rgb(1, 1, 1) : rgb(0, 0, 0) });
  });
  const box = (page: PDFPage, x: number, top: number, cellWidth: number, height: number, color = rgb(1, 1, 1)) => page.drawRectangle({ x, y: 792 - top - height, width: cellWidth, height, color, borderColor: edge, borderWidth: .45 });
  let sheet!: PDFPage;
  let top = 0;
  const newPage = (first: boolean) => {
    sheet = template.page();
    // Retain the original logo, company address and title; redraw the variable form body.
    const bodyTop = geometry.top + 204 * geometry.scale;
    sheet.drawRectangle({ x: 0, y: 0, width: 612, height: 792 - bodyTop, color: rgb(1, 1, 1) });
    const headerX = 453, headerWidth = 123;
    sheet.drawRectangle({ x: headerX - 24, y: 792 - bodyTop, width: 147, height: bodyTop - 60, color: rgb(1, 1, 1) });
    let headerTop = 64;
    for (const [label, value] of [["DATE", documentDate(info?.date || po.createdAt)], ["P.O. #", po.ref], ["MRF #", request.ref], ["MRF LINK", "MATERIAL REQUEST FORM"]]) {
      const content = lines(value, headerWidth), height = Math.max(14, content.length * leading + 4);
      write(sheet, [label], headerX - 52, headerTop + 2, 51, "right", true);
      box(sheet, headerX, headerTop, headerWidth, height, label === "DATE" ? grey : undefined);
      write(sheet, content, headerX, headerTop + 2, headerWidth, "center");
      if (label === "MRF LINK") template.link(sheet, request.archive?.versions.at(-1)?.formUrl, (headerX - geometry.left) / geometry.scale, (headerTop - geometry.top) / geometry.scale, headerWidth / geometry.scale, height / geometry.scale);
      headerTop += height;
    }
    for (const [label, checked] of [["VAT", po.financial?.vatStatus === "VAT"], ["NON-VAT", po.financial?.vatStatus === "NON-VAT"]] as const) {
      box(sheet, headerX, headerTop + 3, 8, 8, checked ? rgb(0, 0, 0) : undefined);
      if (checked) {
        const base = 792 - headerTop - 11;
        sheet.drawLine({ start: { x: headerX + 1.5, y: base + 4 }, end: { x: headerX + 3.5, y: base + 2 }, thickness: 1, color: rgb(1, 1, 1) });
        sheet.drawLine({ start: { x: headerX + 3.5, y: base + 2 }, end: { x: headerX + 6.5, y: base + 6.5 }, thickness: 1, color: rgb(1, 1, 1) });
      }
      write(sheet, [label], headerX + 11, headerTop + 2, 100); headerTop += 14;
    }
    top = Math.max(bodyTop + 8, headerTop + 12);
    if (first) {
      const blocks = [
        ["VENDOR", [info?.vendorName || supplierDetails?.name || "", info?.vendorAddress || supplierDetails?.address || "", info?.vendorContact || supplierDetails?.contactName || "", info?.vendorPhone || supplierDetails?.phone || ""]],
        ["VENDOR BANK DETAILS", [info?.bankName || "", info?.bankAccountName || "", info?.bankAccountNumber || ""]],
        ["SHIP TO", [info?.shipToName || projectName, info?.shipToAddress || "", info?.shipToContact || "", info?.shipToPhone || ""]],
      ] as const;
      let blockBottom = top;
      blocks.forEach(([label, values], index) => {
        const x = left + [0, 184, 371][index], cellWidth = [156, 157, 169][index];
        box(sheet, x, top, cellWidth, 14, blue); write(sheet, [label], x, top + 3, cellWidth, "left", true, true);
        let cursor = top + 18;
        values.forEach(value => {
          const content = lines(value, cellWidth);
          // Extremely long header information continues through the main content grid.
          if (content.length > 8) extra.push(["", `${label}: ${value}`, "", "", "", ""]);
          write(sheet, content.slice(0, 8), x, cursor, cellWidth); cursor += Math.min(8, content.length) * leading + 4;
        });
        blockBottom = Math.max(blockBottom, cursor);
      });
      top = blockBottom + 10;
      const widths = [184, 157, 59, 140], labels = ["REQUISITIONER", "TERMS", "F.O.B.", "SHIPPING TERMS"];
      const content = [info?.requisitioner || request.requestedBy, [info?.terms || quote.terms, po.paymentDueDate ? `Payment due: ${po.paymentDueDate}` : ""].filter(Boolean).join(" / "), info?.fob || "", info?.shippingTerms || quote.deliveryTerms || ""].map((value, index) => {
        const wrapped = lines(value, widths[index]);
        if (wrapped.length > 8) extra.push(["", `${labels[index]}: ${value}`, "", "", "", ""]);
        return wrapped.slice(0, 8);
      });
      const height = Math.max(...content.map(value => value.length)) * leading + 6;
      let x = left;
      widths.forEach((cellWidth, index) => { box(sheet, x, top, cellWidth, 14, blue); write(sheet, [labels[index]], x, top + 3, cellWidth, "center", true, true); box(sheet, x, top + 14, cellWidth, height); write(sheet, content[index], x, top + 17, cellWidth, "center"); x += cellWidth; });
      top += 14 + height + 14;
    }
    if (!["approved", "released"].includes(po.status)) sheet.drawText("PREVIEW — NOT FOR ISSUE", { x: 135, y: 85, font: bold, size: 20, opacity: .12 });
  };
  const widths = [59, 282, 29.5, 29.5, 70, 70];
  const heading = () => {
    let x = left;
    ["ITEM #", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE", "TOTAL"].forEach((label, index) => { box(sheet, x, top, widths[index], 14, blue); write(sheet, [label], x, top + 3, widths[index], "center", true, true); x += widths[index]; }); top += 14;
  };
  newPage(true);
  if (top > 570) { newPage(false); }
  heading();
  const comments = lines(po.notes, 260);
  const longComments = comments.length > 8;
  const contentRows = [...extra, ...rows, ...(longComments ? [["", `Other Comments or Special Instructions: ${po.notes}`, "", "", "", ""]] : [])];
  const visibleComments = longComments ? ["Comments continued in the content grid above."] : comments;
  const footerHeight = Math.max(56, visibleComments.length * leading + 22);
  const bottom = Math.min(680, 746 - footerHeight - 10);
  let rendered = 0;
  for (const row of contentRows) {
    const wrapped = row.map((value, index) => lines(value, widths[index]));
    const count = Math.max(...wrapped.map(value => value.length));
    let offset = 0;
    while (offset < count) {
      let capacity = Math.floor((bottom - top - 4) / leading);
      if (capacity < 1 || (offset === 0 && count > capacity && count * leading + 4 < 250)) { newPage(false); heading(); rendered = 0; capacity = Math.floor((bottom - top - 4) / leading); }
      const take = Math.min(count - offset, capacity), height = take * leading + 4;
      let x = left;
      wrapped.forEach((value, index) => { box(sheet, x, top, widths[index], height, index === 5 ? grey : undefined); write(sheet, value.slice(offset, offset + take), x, top + 2, widths[index], index === 0 || index === 2 || index === 3 ? "center" : index >= 4 ? "right" : "left"); x += widths[index]; });
      top += height; rendered++; offset += take;
      if (offset < count) { newPage(false); heading(); rendered = 0; }
    }
  }
  // Preserve the sample's eleven-row grid when space permits without adding a page.
  while (rendered < 11 && top + 14 <= bottom) { let x = left; widths.forEach((cellWidth, index) => { box(sheet, x, top, cellWidth, 14, index === 5 ? grey : undefined); x += cellWidth; }); top += 14; rendered++; }
  box(sheet, left, top + 14, 260, 14, rgb(.85, .85, .85));
  write(sheet, ["Other Comments or Special Instructions"], left, top + 17, 260, "left", true);
  box(sheet, left, top + 28, 260, Math.max(28, visibleComments.length * leading + 6));
  write(sheet, visibleComments, left, top + 31, 260);
  for (const [label, amount] of [["SUBTOTAL", financial.gross], ["EWT (GOODS)", financial.ewtGoods], ["EWT (SERVICES)", financial.ewtServices], ["TOTAL", financial.net]] as const) {
    const total = label === "TOTAL";
    if (total) box(sheet, 436, top, 140, 14, blue);
    write(sheet, [label], 436, top + 3, 70, "left", total, total);
    box(sheet, 506, top, 70, 14, total ? blue : undefined); write(sheet, [documentMoney(amount, true)], 506, top + 3, 70, "right", total, total); top += 14;
  }
  template.footer(); return pdf;
}
