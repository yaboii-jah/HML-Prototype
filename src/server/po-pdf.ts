import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { poLineTotal, quoteLineTotal, roundMoney, totalWithAdjustments } from "@/src/domain/pricing";
import type { MRF, PO, Quote } from "@/src/domain/types";

const clean = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
const cash = (value: number) => `PHP ${roundMoney(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generatePoPdf(po: PO, request: MRF, quote: Quote, projectName: string) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const ink = rgb(0.11, 0.17, 0.24);
  const next = () => { page = pdf.addPage([595.28, 841.89]); y = 790; };
  const line = (value: unknown, font: PDFFont = regular, size = 10) => {
    const words = clean(value).split(/\s+/);
    let current = "";
    const draw = (text: string) => { if (y < 54) next(); page.drawText(text, { x: 48, y, font, size, color: ink }); y -= size + 8; };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) < 495) { current = candidate; continue; }
      if (current) draw(current);
      current = word;
    }
    if (current) draw(current);
  };
  const heading = (value: string) => { y -= 8; line(value.toUpperCase(), bold, 10); };
  line("PURCHASE ORDER", bold, 18);
  line(`PO No.: ${po.ref}`, bold, 12);
  line(`Project: ${projectName}`);
  line(`MRF No.: ${request.ref}`);
  line(`Finance approved at: ${po.updatedAt}`);
  heading("Supplier and quotation");
  line(`Supplier: ${quote.supplierDetails?.name || "-"}`);
  line(`Quotation: ${quote.ref} (version ${quote.version || 1})`);
  if (quote.supplierDetails?.address) line(`Address: ${quote.supplierDetails.address}`);
  if (quote.supplierDetails?.tin) line(`TIN: ${quote.supplierDetails.tin}`);
  if (quote.terms) line(`Payment terms: ${quote.terms}`);
  if (quote.deliveryTerms) line(`Delivery terms: ${quote.deliveryTerms}`);
  heading("Ordered materials");
  const lines = po.lines?.length ? po.lines : request.items.map(item => ({ itemId: item.id, quoteLineId: "", quantity: item.quantity, unitPrice: quote.prices[item.id] || 0 }));
  let subtotal = 0;
  for (const [index, ordered] of lines.entries()) {
    const item = request.items.find(value => value.id === ordered.itemId);
    if (!item) continue;
    const total = poLineTotal(ordered);
    subtotal += total;
    line(`${index + 1}. ${item.name}`, bold);
    line(`${ordered.quantity} ${item.unit} x ${cash(ordered.unitPrice)} = ${cash(total)}`);
    line(`Deliver to: ${item.location}`);
  }
  if (po.adjustments?.length) for (const adjustment of po.adjustments.filter(value => value.included)) line(`${adjustment.label}: ${adjustment.kind === "discount" ? "-" : "+"}${adjustment.calculation === "percentage" ? `${adjustment.value}%` : cash(adjustment.value)}`);
  const quoteSubtotal = quote.lines?.reduce((sum, value) => sum + quoteLineTotal(value), 0) ?? subtotal;
  const total = !po.lines?.length
    ? quote.lines ? quote.adjustments ? totalWithAdjustments(quoteSubtotal, quote.adjustments) : roundMoney(quoteSubtotal + (quote.tax || 0) + (quote.freight || 0) - (quote.discount || 0)) : quoteSubtotal
    : po.adjustments ? totalWithAdjustments(subtotal, po.adjustments) : roundMoney(subtotal + (po.tax || 0) + (po.freight || 0) - (po.discount || 0));
  heading(`Total: ${cash(total)}`);
  if (po.selectionReason) line(`Supplier selection: ${po.selectionReason}`);
  if (po.notes) line(`Notes: ${po.notes}`);
  pdf.getPages().forEach((sheet, index, pages) => sheet.drawText(`Finance-approved PO - Page ${index + 1} of ${pages.length}`, { x: 48, y: 28, font: regular, size: 8, color: ink }));
  return pdf.save();
}
