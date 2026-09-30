import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFString, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export const TEMPLATE_GEOMETRY = {
  po: { width: 612, height: 792, scale: .57877815, left: 36, top: 32.4 },
  mrf: { width: 792, height: 612, scale: .3995375625, left: 50.4, top: 54 },
  comparison: { width: 792, height: 612, scale: .2442402646, left: 50.3134923, top: 53.9770946 },
};
export type TemplateKind = keyof typeof TEMPLATE_GEOMETRY;
const assets = new Map<string, Promise<Buffer>>();
const asset = (name: string) => {
  if (!assets.has(name)) assets.set(name, readFile(path.join(process.cwd(), "src/server/document-assets", name)));
  return assets.get(name)!;
};
export function wrapText(value: unknown, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of String(value ?? "").replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { result.push(line); line = ""; }
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        if (line) { result.push(line); line = ""; }
        let end = 1;
        while (end < rest.length && font.widthOfTextAtSize(rest.slice(0, end + 1), size) <= width) end++;
        result.push(rest.slice(0, end)); rest = rest.slice(end);
      }
      line = line ? `${line} ${rest}` : rest;
    }
    result.push(line);
  }
  return result;
}
export async function documentTemplate(kind: TemplateKind) {
  const geometry = TEMPLATE_GEOMETRY[kind], pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [background] = await pdf.embedPdf(await asset(`${kind}.pdf`));
  const regular = await pdf.embedFont(await asset("arial.ttf"), { subset: true });
  const bold = await pdf.embedFont(await asset("arial-bold.ttf"), { subset: true });
  const page = () => { const result = pdf.addPage([geometry.width, geometry.height]); result.drawPage(background, { x: 0, y: 0, width: geometry.width, height: geometry.height }); return result; };
  const point = (x: number, y: number) => ({ x: geometry.left + x * geometry.scale, y: geometry.height - geometry.top - y * geometry.scale });
  const text = (sheet: PDFPage, value: unknown, x: number, baseline: number, width: number, options: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb>; maxLines?: number; lineHeight?: number } = {}) => {
    const font = options.bold ? bold : regular, size = (options.size || 13) * geometry.scale;
    const lines = wrapText(value, font, size, Math.max(geometry.scale, (width - 6) * geometry.scale));
    const visible = lines.slice(0, options.maxLines ?? lines.length);
    visible.forEach((line, index) => {
      const p = point(x + 3, baseline + index * (options.lineHeight || 15));
      const remaining = (width - 6) * geometry.scale - font.widthOfTextAtSize(line, size);
      if (options.align === "right") p.x += remaining;
      if (options.align === "center") p.x += remaining / 2;
      if (line) sheet.drawText(line, { ...p, size, font, color: options.color || rgb(0, 0, 0) });
    });
    return lines.slice(visible.length);
  };
  const link = (sheet: PDFPage, url: string | undefined, x: number, y: number, width: number, height: number) => {
    if (!url || !/^https:\/\//.test(url)) return;
    const p = point(x, y + height);
    const annotation = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [p.x, p.y, p.x + width * geometry.scale, p.y + height * geometry.scale], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } }));
    sheet.node.addAnnot(annotation);
  };
  const footer = () => { if (pdf.getPageCount() > 1) pdf.getPages().forEach((sheet, index) => sheet.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: geometry.left, y: 24, size: 6, font: regular })); };
  const checkbox = (sheet: PDFPage, x: number, y: number, checked: boolean) => {
    const p = point(x, y + 14);
    sheet.drawRectangle({ x: p.x, y: p.y, width: 14 * geometry.scale, height: 14 * geometry.scale, color: checked ? rgb(0, 0, 0) : rgb(1, 1, 1), borderWidth: 1, borderColor: rgb(0, 0, 0) });
    if (checked) { sheet.drawLine({ start: { x: p.x + 2 * geometry.scale, y: p.y + 7 * geometry.scale }, end: { x: p.x + 6 * geometry.scale, y: p.y + 3 * geometry.scale }, thickness: 1, color: rgb(1, 1, 1) }); sheet.drawLine({ start: { x: p.x + 6 * geometry.scale, y: p.y + 3 * geometry.scale }, end: { x: p.x + 12 * geometry.scale, y: p.y + 11 * geometry.scale }, thickness: 1, color: rgb(1, 1, 1) }); }
  };
  return { pdf, page, point, text, link, footer, checkbox, regular, bold, geometry };
}
export const documentMoney = (value: number, peso = false) => `${peso ? "₱" : ""}${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const documentDate = (value: string, long = false) => value && !Number.isNaN(Date.parse(value)) ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", long ? { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" } : { timeZone: "UTC" }) : "";
