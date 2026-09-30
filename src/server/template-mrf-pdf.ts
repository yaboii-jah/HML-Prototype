import type { MRF } from "../domain/types.ts";
import { rgb } from "pdf-lib";
import { documentDate, documentTemplate, wrapText } from "./document-template.ts";

export async function generateMrfPdf(request: MRF, projectName: string, projectLocation = "", supportingUrl?: string) {
  const template = await documentTemplate("mrf"); const { pdf, page, text, regular, geometry } = template;
  const positions = [0, 101, 202, 303, 705, 831, 1123, 1257], widths = [101, 101, 101, 402, 126, 292, 134, 158];
  const rows = request.items.flatMap((item, index) => {
    const values = [String(index + 1), String(item.quantity), item.unit, item.name, documentDate(item.neededDate), item.purpose, item.location, item.remarks].map(value => value.toUpperCase());
    const cells = values.map((value, column) => wrapText(value, regular, 13 * geometry.scale, (widths[column] - 6) * geometry.scale));
    return Array.from({ length: Math.max(...cells.map(cell => cell.length)) }, (_, n) => cells.map(cell => cell[n] || ""));
  });
  const chunks: string[][][] = [];
  for (let cursor = 0; cursor < rows.length;) {
    const chunk: string[][] = [];
    const first = rows[cursor++];
    if (cursor < rows.length && !rows[cursor][0]) {
      const next = rows[cursor++]; chunk.push(first.map((value, column) => next[column] ? `${value}\n${next[column]}` : value));
    } else chunk.push(first);
    chunk.push(...rows.slice(cursor, cursor + 15)); cursor += Math.min(15, rows.length - cursor); chunks.push(chunk);
  }
  if (!chunks.length) chunks.push([]);
  const overflow: string[][] = [], count = chunks.length;
  const draw = (index: number, chunk: string[][]) => {
    const sheet = page();
    const field = (label: string, value: unknown, x: number, y: number, width: number, maxLines = 1, bold = false) => { const formatted = label === "Request date" ? String(value ?? "") : String(value ?? "").toUpperCase(); const rest = text(sheet, formatted, x, y, width, { maxLines, bold, align: "center" }); if (index === 0 && rest.length) overflow.push(["", "", "", `${label.toUpperCase()}: ${rest.join(" ")}`, "", "", "", ""]); };
    field("Project", projectName, 101, 120.19385, 1022); field("Location", projectLocation, 101, 141.19385, 1022);
    field("MRF number", request.ref, 1257, 120.19385, 158); field("Request date", documentDate(request.requestDate, true), 1257, 141.19385, 158);
    chunk.forEach((row, n) => row.forEach((value, column) => text(sheet, value, positions[column], n === 0 ? value.includes("\n") ? 183.19385 : 190.19385 : 219.24512 + (n - 1) * 21, widths[column], { maxLines: n === 0 ? 2 : 1, lineHeight: 14.94873, align: "center" })));
    field("Instructions", request.specialInstructions || "", 303, 533.19385, 1112);
    const supporting = request.documents.find(value => value.type === "Supporting PDF");
    const attachmentOverflow = text(sheet, supporting?.name || "", 303, 554.19385, 402, { bold: true, align: "center", maxLines: 1, color: rgb(.14, .63, .9) });
    if (index === 0 && attachmentOverflow.length) overflow.push(["", "", "", `Attachment: ${supporting?.name}`, "", "", "", ""]);
    template.link(sheet, supportingUrl || request.archive?.versions.at(-1)?.supportUrl, 303, 540, 402, 24);
    [request.requestedBy, request.approvedBy, request.purchaser, request.financeOfficer].forEach((value, n) => {
      const x = [0, 303, 705, 1123][n], width = [303, 402, 418, 607][n];
      field("Signatory", value, x, n === 1 ? 630.19385 : 623.19385, width);
    });
  };
  chunks.forEach((chunk, index) => draw(index, chunk));
  const extra = overflow.flatMap(row => wrapText(row[3], regular, 13 * geometry.scale, 396 * geometry.scale).map(line => ["", "", "", line, "", "", "", ""]));
  for (let n = 0; n < extra.length; n += 16) draw(count + n / 16, extra.slice(n, n + 16));
  template.footer(); pdf.setTitle(`MRF ${request.ref}`); return pdf.save();
}
