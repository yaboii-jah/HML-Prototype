import { rgb, type PDFPage } from "pdf-lib";
import { actorName, auditTime } from "../domain/audit.ts";
import { batchStage, isReceivedBatch, isSiteBatch, legLabel } from "../domain/delivery-flow.ts";
import type { DeliveryReceiptData } from "../domain/delivery-document.ts";
import { documentDate, documentTemplate, wrapText } from "./document-template.ts";

export async function generateDeliveryReceiptPdf(data: DeliveryReceiptData) {
  const { batch, po, request, project, parentBatch } = data;
  const template = await documentTemplate("po"), { pdf, regular, bold } = template;
  const blue = rgb(0, .36, .68), edge = rgb(.75, .78, .82), pale = rgb(.94, .96, .98), left = 36, width = 540, size = 8, leading = 11;
  const received = isReceivedBatch(batch), warehouse = !isSiteBatch(batch);
  const origin = batch.origin || { name: po.document?.vendorName || "Supplier", address: po.document?.vendorAddress || "" };
  const destination = batch.destination || { name: po.document?.shipToName || project.name, address: po.document?.shipToAddress || project.location };
  const wrap = (value: unknown, cellWidth: number, strong = false) => wrapText(value, strong ? bold : regular, size, cellWidth - 10);
  let page!: PDFPage, top = 0;
  const draw = (lines: string[], x: number, y: number, strong = false, color = rgb(0, 0, 0)) => lines.forEach((line, index) => { if (line) page.drawText(line, { x, y: 792 - y - size - index * leading, size, font: strong ? bold : regular, color }); });
  const box = (x: number, y: number, cellWidth: number, height: number, fill = rgb(1, 1, 1)) => page.drawRectangle({ x, y: 792 - y - height, width: cellWidth, height, color: fill, borderColor: edge, borderWidth: .5 });
  const newPage = () => {
    page = template.page();
    // Keep the exact PO company artwork/address while replacing its title and body.
    page.drawRectangle({ x: 350, y: 642, width: 262, height: 150, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 642, color: rgb(1, 1, 1) });
    page.drawText("DELIVERY RECEIPT", { x: 368, y: 730, size: 16, font: bold, color: blue });
    draw(wrap(batch.ref, 202, true), 368, 72, true, blue);
    draw(wrap(received ? batchStage(batch) : "PENDING RECEIPT", 202, true), 368, 108, true, blue);
    top = 156;
  };
  const ensure = (height: number) => { if (top + height > 736) newPage(); };
  const field = (label: string, value: unknown) => {
    const lines = wrap(value || "Not recorded", width - 120), remaining = [...lines];
    do {
      ensure(30);
      const count = Math.max(1, Math.floor((736 - top - 10) / leading)), chunk = remaining.splice(0, count), height = Math.max(24, chunk.length * leading + 10);
      box(left, top, 120, height, pale); box(left + 120, top, width - 120, height);
      draw(wrap(label, 120, true), left + 5, top + 5, true, blue); draw(chunk, left + 125, top + 5); top += height;
    } while (remaining.length);
  };
  newPage();
  field("P.O. # / MRF #", `${po.ref} / ${request.ref}`);
  if (parentBatch) field("WAREHOUSE RECEIPT", parentBatch.ref);
  field("PROJECT / ROUTE", `${project.name} · ${legLabel(batch)}`);
  field("FROM", `${origin.name}\n${origin.address || "Address not recorded"}`);
  field("DELIVERY LOCATION", `${destination.name}\n${destination.address || "Address not recorded"}`);
  field("SCHEDULED DATE", documentDate(batch.scheduledDate));
  field("DISPATCH RECORDED", `${auditTime(batch.dispatchedAt)} · ${actorName("Logistics", batch.dispatchedByIdentity)}`);
  field("RECEIPT RECORDED", received ? `${auditTime(batch.receivedAt)} · ${actorName(warehouse ? "Procurement" : "Site Personnel", batch.receivedByIdentity)}` : "Awaiting receiving confirmation");
  field("EVIDENCE / DELAY", `${batch.evidence || "Not recorded"}${batch.delayReason ? `\n${batch.delayReason}` : ""}`);
  const columns = [24, 190, 40, 62, 62, 162], headers = ["#", "GOODS / DESCRIPTION", "UNIT", "EXPECTED", "ACCEPTED", "ISSUE / REMARKS"];
  const row = (values: string[][], height: number, heading = false) => {
    let x = left;
    values.forEach((lines, index) => { box(x, top, columns[index], height, heading ? blue : rgb(1, 1, 1)); draw(lines, x + 5, top + 5, heading, heading ? rgb(1, 1, 1) : rgb(0, 0, 0)); x += columns[index]; }); top += height;
  };
  const tableHeader = () => row(headers.map((label, index) => wrap(label, columns[index], true)), 32, true);
  ensure(70); tableHeader();
  for (const [index, line] of batch.lines.filter(value => value.expected > 0 || value.accepted > 0).entries()) {
    const item = request.items.find(value => value.id === line.itemId)!;
    const cells = [String(index + 1), item.name, item.unit, String(line.expected), received ? String(line.accepted) : "Pending", line.issue || "—"].map((value, column) => wrap(value, columns[column]));
    let offset = 0;
    const total = Math.max(...cells.map(lines => lines.length));
    while (offset < total) {
      if (top + 23 > 736) { newPage(); tableHeader(); }
      const count = Math.max(1, Math.floor((736 - top - 10) / leading)), take = Math.min(count, total - offset);
      row(cells.map(lines => lines.slice(offset, offset + take)), take * leading + 10);
      offset += take;
    }
  }
  top += 12;
  if (batch.postingReason) field("POSTING CORRECTION", batch.postingReason);
  if (batch.status === "posted") field("STOCK POSTED", `${auditTime(batch.postedAt)} · ${actorName("Site Personnel", batch.postedByIdentity)}`);
  ensure(92);
  draw(["Prepared / dispatched by"], left + 5, top, true, blue);
  draw([warehouse ? "Received at company warehouse by" : "Received at site by"], left + 295, top, true, blue);
  // Handwritten signature spaces remain separate from recorded account attribution.
  top += 25;
  page.drawLine({ start: { x: left, y: 792 - top }, end: { x: left + 245, y: 792 - top }, thickness: .6, color: edge });
  page.drawLine({ start: { x: left + 295, y: 792 - top }, end: { x: left + width, y: 792 - top }, thickness: .6, color: edge });
  draw(["Signature / date"], left, top + 5); draw(["Signature / date"], left + 295, top + 5);
  pdf.getPages().forEach((sheet, index) => sheet.drawText(`Page ${index + 1} of ${pdf.getPageCount()} · Generated ${auditTime(new Date().toISOString())}`, { x: left, y: 24, size: 7, font: regular, color: blue }));
  return pdf.save();
}
