import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function syntheticPdf(lines) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]), font = await document.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, index) => page.drawText(line, { x: 45, y: 790 - index * 24, size: 12, font }));
  return document.save();
}

export const mrfLines = ['SYNTHETIC TEST DOCUMENT - NOT A COMPANY TRANSACTION', 'MATERIAL REQUEST FORM', 'Project: Synthetic Readiness Project', 'MRF number: TEST-MRF-001', 'Request date: 2026-10-27', 'Requested by: Test Engineer', 'Material: Portland cement', 'Quantity: 10', 'Unit: bag', 'Purpose: Synthetic verification only'];
export const quotationLines = ['SYNTHETIC TEST DOCUMENT - NOT A COMPANY TRANSACTION', 'SUPPLIER QUOTATION', 'Supplier: Synthetic Test Supplier', 'Quotation reference: TEST-QUOTE-001', 'Currency: PHP', 'Material: Portland cement', 'Quantity: 10 bag', 'Unit price: PHP 250.00', 'Line total: PHP 2500.00', 'NON VAT', 'Payment terms: Cash before delivery'];
