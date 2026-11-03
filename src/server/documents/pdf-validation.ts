import { PDFDocument } from "pdf-lib";
import { MAX_SUPPORTING_PDF } from "../../domain/requests/documents.ts";

export class InvalidSupportingPdf extends Error {
  constructor() { super("Choose a readable, unencrypted PDF within 50 MiB."); }
}
export async function validateSupportingPdf(bytes: Uint8Array) {
  try {
    if (bytes.length < 5 || bytes.length > MAX_SUPPORTING_PDF || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
      || !/%%EOF[\x00\t\n\f\r ]*$/.test(Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString("latin1"))) throw Error("Invalid PDF envelope");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted || !pdf.getPageCount()) throw Error("Invalid PDF pages");
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw Error("Invalid PDF page geometry");
    }
  } catch { throw new InvalidSupportingPdf(); }
}
