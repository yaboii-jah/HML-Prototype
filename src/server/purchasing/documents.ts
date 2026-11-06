import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import ExcelJS from "exceljs";
import {
  wrapText,
  documentTemplate,
  documentDate,
} from "../document-template.ts";
import { drawPoTextLayout } from "../po-table-layout.ts";
import type { ComparisonSnapshot } from "../../domain/purchasing/pricing.ts";
import {
  calculatePo,
  convertedPrice,
} from "../../domain/purchasing/pricing.ts";
import type {
  PurchasingRecord,
  PurchasingView,
} from "../../domain/purchasing/contracts.ts";
import { php } from "../../domain/quotations/decimal.ts";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const moneyText = (value: string) => `PHP ${value}`;

/** The same frozen cells feed PDF and XLSX. No spreadsheet financial formulas. */
export function comparisonCells(
  snapshot: ComparisonSnapshot,
  sources = snapshot.sources,
): string[][] {
  const rows = [
    ["HML Technologies and Services Inc."],
    ["Bid comparison", snapshot.ref],
    ["Prepared", snapshot.createdAt, snapshot.createdBy],
    [
      "Material prices include line discounts and applicable VAT. Fixed line discounts are spread across the full quoted quantity. Comparison amounts use remaining purchasing demand; limited capacity is marked. Document adjustments and EWT are separate. Awards are explicit.",
    ],
    [
      "Material",
      "Unit",
      "Requested",
      "Remaining to purchase",
      "Unassigned",
      ...sources.map((s) => `${s.supplierName}\n${s.ref}`),
    ],
  ];
  for (const item of snapshot.items) {
    rows.push([
      item.name,
      item.unit,
      item.requested,
      item.purchase,
      item.unassigned,
      ...sources.map((source) => {
        const offer = item.offers.find((o) => o.quoteId === source.quoteId);
        return offer
          ? `Unit: PHP ${offer.price}${offer.lowest ? " (lowest material price)" : ""}\nComparison amount: PHP ${offer.amount}\nQuoted capacity: ${offer.capacity} ${item.unit}${offer.sufficient ? "" : " (insufficient for remaining demand)"}`
          : "No selected offer";
      }),
    ]);
    rows.push([
      `Sourcing: ordered ${item.ordered}; saved awards ${item.awarded}; suitability ${item.suitability}; transfers ${item.transfers}`,
      "",
      "",
      "",
      "",
      ...sources.map(() => ""),
    ]);
  }
  for (const [label, field] of [
    ["Full quotation gross", "gross"],
    ["Full quotation EWT", "ewt"],
    ["Full quotation net", "net"],
  ] as const)
    rows.push([
      label,
      "",
      "",
      "",
      "",
      ...sources.map((s) => moneyText(s[field])),
    ]);
  rows.push([
    "Quoted adjustments (full source)",
    "",
    "",
    "",
    "",
    ...sources.map((s) => s.adjustments.join("\n") || "None"),
  ]);
  rows.push([
    "These source totals do not price a partial order. Review the actual PO discounts and charges separately.",
  ]);
  rows.push([
    "Protected source records",
    "",
    "",
    "",
    "",
    ...sources.map((s) => `/requests/${snapshot.mrfId}/quotes/${s.quoteId}`),
  ]);
  return rows;
}

export async function generatePurchasingComparisonPdf(
  snapshot: ComparisonSnapshot,
  reportVersion: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = path.join(process.cwd(), "src/server/document-assets");
  const regular = await pdf.embedFont(
    await readFile(path.join(root, "arial.ttf")),
    { subset: true },
  );
  const bold = await pdf.embedFont(
    await readFile(path.join(root, "arial-bold.ttf")),
    { subset: true },
  );
  const frozenAt = new Date(snapshot.createdAt);
  pdf.setCreationDate(frozenAt);
  pdf.setModificationDate(frozenAt);
  pdf.setTitle(`${snapshot.ref} bid comparison v${reportVersion}`);
  pdf.setAuthor("HML Technologies and Services Inc.");
  for (let start = 0; start < snapshot.sources.length; start += 11) {
    const selected = snapshot.sources.slice(start, start + 11),
      rows = comparisonCells(snapshot, selected);
    const widths = [
      150,
      34,
      45,
      62,
      53,
      ...selected.map(() => 384 / selected.length),
    ];
    const fontSize = selected.length > 5 ? 6 : 7,
      leading = fontSize * 1.3;
    let sheet: PDFPage,
      y = 0;
    const newPage = () => {
      sheet = pdf.addPage([792, 612]);
      y = 568;
      sheet.drawText(`${snapshot.ref} | Bid comparison v${reportVersion}`, {
        x: 32,
        y: 589,
        size: 9,
        font: bold,
      });
      sheet.drawText("Material prices with VAT; other costs shown separately", {
        x: 32,
        y: 575,
        size: 7,
        font: regular,
      });
    };
    newPage();
    const draw = (row: string[], header = false) => {
      const cells = row.length === 1 ? [row[0]] : row;
      const columnWidths = row.length === 1 ? [728] : widths;
      const wrapped = cells.map((cell, i) =>
        wrapText(cell, header ? bold : regular, fontSize, columnWidths[i] - 8),
      );
      const count = Math.max(...wrapped.map((lines) => lines.length));
      for (let offset = 0; offset < count; ) {
        if (y < 60) {
          newPage();
          if (!header) draw(rows[4], true);
        }
        const take = Math.min(
            count - offset,
            Math.max(1, Math.floor((y - 44) / leading) - 1),
          ),
          height = take * leading + 8;
        let x = 32;
        wrapped.forEach((lines, i) => {
          sheet.drawRectangle({
            x,
            y: y - height,
            width: columnWidths[i],
            height,
            color: header ? rgb(0.9, 0.94, 0.95) : rgb(1, 1, 1),
            borderColor: rgb(0.72, 0.75, 0.76),
            borderWidth: 0.35,
          });
          lines.slice(offset, offset + take).forEach((line, n) => {
            if (line)
              sheet.drawText(line, {
                x: x + 4,
                y: y - fontSize - 4 - n * leading,
                size: fontSize,
                font: header ? bold : regular,
              });
          });
          x += columnWidths[i];
        });
        y -= height;
        offset += take;
      }
    };
    rows.forEach((row, index) => draw(row, index === 4));
  }
  pdf.getPages().forEach((page, index) =>
    page.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, {
      x: 32,
      y: 23,
      size: 6,
      font: regular,
    }),
  );
  return pdf.save();
}

/** JSZip timestamps otherwise change on retries; normalize only DOS metadata. */
export function stableWorkbookZip(input: Uint8Array): Uint8Array {
  const bytes = Buffer.from(input);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    bytes.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50)
    throw Error("Invalid workbook archive.");
  let cursor = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw Error("Invalid workbook central directory.");
    const local = bytes.readUInt32LE(cursor + 42);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      throw Error("Invalid workbook entry.");
    bytes.writeUInt16LE(0, cursor + 12);
    bytes.writeUInt16LE(33, cursor + 14);
    bytes.writeUInt16LE(0, local + 10);
    bytes.writeUInt16LE(33, local + 12);
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  return bytes;
}
export async function generatePurchasingComparisonWorkbook(
  snapshot: ComparisonSnapshot,
  reportVersion: string,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = snapshot.createdBy;
  workbook.lastModifiedBy = snapshot.createdBy;
  workbook.created = new Date(snapshot.createdAt);
  workbook.modified = new Date(snapshot.createdAt);
  workbook.title = `${snapshot.ref} bid comparison v${reportVersion}`;
  const sheet = workbook.addWorksheet("Bid comparison", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 5 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:5",
    },
  });
  // Exact decimal strings remain text, including values beyond Excel's precision.
  for (const row of comparisonCells(snapshot)) sheet.addRow(row);
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 48 : index < 5 ? 19 : 34;
  });
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Arial", size: 10, bold: index === 1 || index === 5 };
    const maxLines = Math.max(
      1,
      ...row.values
        .toString()
        .split(",")
        .map((v) => v.split("\n").length),
    );
    row.height = Math.min(409, 18 * maxLines + (index > 5 ? 18 : 0));
    if (index === 5)
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5F0F2" },
      };
  });
  return stableWorkbookZip(new Uint8Array(await workbook.xlsx.writeBuffer()));
}

export async function generatePurchasingPoPreview(
  view: PurchasingView,
  po: PurchasingRecord,
): Promise<Uint8Array> {
  const quote = view.quotations.quotes.find((q) => q.id === po.quoteId),
    request = view.quotations.request;
  if (!quote || !request) throw Error("PO source unavailable.");
  const calculation = calculatePo(quote, po.body),
    fields = po.body.fields,
    template = await documentTemplate("po");
  const rows: string[][] = [];
  for (const [index, line] of po.body.lines.entries()) {
    const source = quote.body.lines.find((l) => l.id === line.sourceLineId),
      item = request.items.find((i) => i.id === line.itemId);
    if (!source || !item) throw Error("PO material unavailable.");
    const price = convertedPrice(source.unitPrice, source.conversionFactor),
      amount = calculation.rows.find((r) => r.id === source.id),
      config = quote.financial?.review?.rows.find((r) => r.id === source.id);
    const discount =
      config?.discountType === "fixed"
        ? `Fixed discount: ${line.fixedDiscount || "review pending"}${line.discountReason ? `; ${line.discountReason}` : ""}`
        : config?.discountType === "percentage"
          ? `Line discount: ${source.discountValue}%`
          : "No line discount";
    rows.push([
      String(index + 1),
      `${item.name}\nSource: ${line.offeredQuantity} ${source.unit} × PHP ${source.unitPrice}; 1 ${source.unit} = ${source.conversionFactor} ${item.unit}.\n${discount}. Quoted prices are VAT ${quote.financial?.review?.priceBasis}; amounts include applicable VAT after discounts.`,
      line.quantity,
      item.unit,
      `${price.approximate ? "≈ " : ""}${price.text}`,
      amount ? php(amount.contribution) : "Review pending",
    ]);
  }
  for (const adjustment of [
    ...calculation.rows.filter((r) => r.role !== "material"),
    ...calculation.adjustments,
  ])
    rows.push([
      "",
      adjustment.label,
      "1",
      "LOT",
      php(adjustment.contribution),
      php(adjustment.contribution),
    ]);
  const complete = !calculation.issues.length;
  drawPoTextLayout(
    template,
    {
      date: documentDate(fields.date),
      ref: po.ref || "Assigned on save",
      mrfRef: request.ref,
      vatStatus: quote.financial?.review?.vatStatus || "",
      vendorName: fields.vendorName,
      vendorAddress: fields.vendorAddress,
      vendorContact: fields.vendorContact,
      vendorPhone: fields.vendorPhone,
      bankName: fields.bankName,
      bankAccountName: fields.accountName,
      bankAccountNumber: fields.accountNumber,
      shipToName: fields.shipTo,
      shipToAddress: fields.shipAddress,
      shipToContact: fields.shipContact,
      shipToPhone: fields.shipPhone,
      requisitioner: fields.requisitioner,
      terms: fields.paymentTerms,
      fob: fields.fob,
      shippingTerms: fields.shippingTerms,
      notes: [
        `Linked supplier: ${quote.body.supplierName}; quotation ${quote.body.ref} revision ${quote.revision?.number}.`,
        po.body.reason,
        fields.notes,
        ...calculation.issues,
        ...po.blockers,
      ]
        .filter(Boolean)
        .join("\n"),
      preview: true,
      grossLabel: "GROSS",
      gross: complete ? php(calculation.gross) : "Incomplete",
      ewtGoods: complete ? php(calculation.ewtGoods) : "Incomplete",
      ewtServices: complete ? php(calculation.ewtServices) : "Incomplete",
      net: complete ? php(calculation.net) : "Incomplete",
    },
    rows,
  );
  template.pdf.setCreationDate(new Date(po.updatedAt));
  template.pdf.setModificationDate(new Date(po.updatedAt));
  return template.pdf.save();
}
