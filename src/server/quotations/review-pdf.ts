import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { wrapText } from "../document-template.ts";
import {
  HEADER_FIELDS,
  LINE_FIELDS,
  ADJUSTMENT_FIELDS,
  type QuoteBody,
  type QuoteFile,
} from "../../domain/quotations/drafts.ts";
import { php } from "../../domain/quotations/decimal.ts";
import type {
  FinancialReview,
  QuotationCalculation,
} from "../../domain/quotations/financial.ts";

export type ReviewPdfInput = {
  id: string;
  number: string;
  finalizedAt: string;
  finalizedBy: string;
  mrfRef: string;
  mrfArchiveId: string;
  source: QuoteBody;
  review: FinancialReview;
  calculation: QuotationCalculation;
  files: QuoteFile[];
};

/** Pagination preserves all source text; immutable input supplies every business value. */
export async function generateQuotationReviewPdf(
  input: ReviewPdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontRoot = path.join(process.cwd(), "src/server/document-assets");
  const regular = await pdf.embedFont(
    await readFile(path.join(fontRoot, "arial.ttf")),
    { subset: true },
  );
  const bold = await pdf.embedFont(
    await readFile(path.join(fontRoot, "arial-bold.ttf")),
    { subset: true },
  );
  const frozenAt = new Date(input.finalizedAt);
  if (!Number.isFinite(frozenAt.valueOf()))
    throw Error("Invalid frozen quotation time");
  pdf.setCreationDate(frozenAt);
  pdf.setModificationDate(frozenAt);
  pdf.setTitle(
    `Internal quotation review ${input.source.ref} r${input.number}`,
  );
  pdf.setAuthor("HML Technologies and Services Inc.");
  const ink = rgb(0.1, 0.15, 0.2),
    secondary = rgb(0.28, 0.32, 0.36);
  let sheet: PDFPage,
    y = 0;
  const page = () => {
    sheet = pdf.addPage([595.28, 841.89]);
    sheet.drawText("HML Technologies and Services Inc.", {
      x: 42,
      y: 800,
      size: 11,
      font: bold,
      color: ink,
    });
    sheet.drawText(`Internal quotation review - revision ${input.number}`, {
      x: 42,
      y: 780,
      size: 10,
      font: regular,
      color: secondary,
    });
    sheet.drawLine({
      start: { x: 42, y: 769 },
      end: { x: 553, y: 769 },
      thickness: 0.5,
      color: secondary,
    });
    y = 749;
  };
  const paragraph = (value: string, heading = false) => {
    const size = heading ? 11 : 9;
    const font = heading ? bold : regular;
    const lines = wrapText(value, font, size, 511);
    if (heading && y < 100) page();
    if (heading) y -= 8;
    for (const line of lines) {
      if (y < 58) page();
      sheet.drawText(line, { x: 42, y, size, font, color: ink });
      y -= heading ? 16 : 13;
    }
    y -= 4;
  };
  page();
  paragraph("Reviewed computation and source record", true);
  paragraph(
    "This is an internal review record. Supplier originals remain the source evidence. Finalization does not approve a purchase order, execute payment or charge a budget.",
  );
  paragraph(`MRF: ${input.mrfRef} | Supplier reference: ${input.source.ref}`);
  paragraph(
    `Finalized by: ${input.finalizedBy} / Procurement | ${new Date(input.finalizedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`,
  );
  paragraph(
    `Revision ID: ${input.id} | Reviewed MRF archive: ${input.mrfArchiveId}`,
  );
  paragraph(
    `Calculation rule: ${input.calculation.ruleVersion} | Currency: PHP | Rounding: exact half-up cents at recorded stages`,
  );

  paragraph("Calculation summary", true);
  const labels = {
    materials: "Materials after line discounts",
    subtotal: "Subtotal before added VAT",
    vat:
      input.review.priceBasis === "inclusive"
        ? "VAT included (aggregate)"
        : "VAT added / component rounding",
    gross: "Gross quotation amount",
    ewtGoods: "Goods EWT",
    ewtServices: "Services EWT",
    net: "Net after EWT",
  };
  for (const key of Object.keys(labels) as (keyof typeof labels)[])
    paragraph(`${labels[key]}: ${php(input.calculation[key])}`);
  paragraph(
    `Treatment: ${input.review.vatStatus}; ${input.review.priceBasis}; reviewed VAT rate ${input.review.vatRate || "not applicable"}%.`,
  );
  paragraph(
    "Document percentages independently use the material subtotal after line discounts. Document discounts do not reduce EWT bases. Non-taxable services receive neither added VAT nor services EWT.",
  );

  paragraph("Printed-amount reconciliation", true);
  if (!input.calculation.comparisons.length)
    paragraph(
      "No printed summary or line amounts were recorded for comparison.",
    );
  for (const row of input.calculation.comparisons)
    paragraph(
      `${row.label} (${row.basis}): source ${php(row.printed)}; calculated ${php(row.calculated)}; ${row.matches ? "exact cent match" : "DIFFERENCE"}.`,
    );

  paragraph("Reviewed rows and adjustments", true);
  for (const row of [
    ...input.calculation.rows,
    ...input.calculation.adjustments,
  ]) {
    paragraph(
      `${row.label} - ${row.role}${row.excluded ? "; excluded" : row.taxable ? "; taxable" : "; non-taxable"}`,
    );
    paragraph(
      `Input ${php(row.input)} | Contribution ${php(row.contribution)}${row.reason ? ` | Reason: ${row.reason}` : ""}`,
    );
  }

  paragraph("Captured source headers", true);
  for (const key of Object.keys(
    HEADER_FIELDS,
  ) as (keyof typeof HEADER_FIELDS)[])
    paragraph(`${HEADER_FIELDS[key]}: ${input.source[key] || "Not recorded"}`);
  for (const [index, line] of input.source.lines.entries()) {
    paragraph(
      `Source line ${index + 1}: ${line.description || "Not recorded"}`,
      true,
    );
    paragraph(
      `Source row ID: ${line.id} | MRF material ID: ${line.requestItemId || "Unmatched"} | Original ID: ${line.sourceFileId || "Not recorded"}`,
    );
    for (const key of Object.keys(LINE_FIELDS) as (keyof typeof LINE_FIELDS)[])
      if (line[key]) paragraph(`${LINE_FIELDS[key]}: ${line[key]}`);
    const review = input.review.rows.find((row) => row.id === line.id);
    if (review)
      paragraph(
        `Reviewed role: ${review.role}; discount basis: ${review.discountType}; free item: ${review.free ? "confirmed" : "no"}; printed basis: ${review.printedBasis}.`,
      );
  }
  for (const [index, row] of input.source.adjustments.entries()) {
    paragraph(
      `Source adjustment ${index + 1}: ${row.label || "Not recorded"}`,
      true,
    );
    for (const key of Object.keys(
      ADJUSTMENT_FIELDS,
    ) as (keyof typeof ADJUSTMENT_FIELDS)[])
      if (row[key]) paragraph(`${ADJUSTMENT_FIELDS[key]}: ${row[key]}`);
  }
  paragraph("Retained supplier originals", true);
  for (const file of input.files) {
    paragraph(
      `${file.name} | ${file.mime} | ${file.size.toLocaleString("en-PH")} bytes`,
    );
    paragraph(`Original ID: ${file.id} | SHA-256: ${file.sha256}`);
  }
  const count = pdf.getPageCount();
  const footerReference = wrapText(input.source.ref, regular, 7, 240)[0];
  pdf
    .getPages()
    .forEach((page, index) =>
      page.drawText(
        `Internal review | ${footerReference} | r${input.number} | Page ${index + 1} of ${count}`,
        { x: 42, y: 30, size: 7, font: regular, color: secondary },
      ),
    );
  return pdf.save();
}
