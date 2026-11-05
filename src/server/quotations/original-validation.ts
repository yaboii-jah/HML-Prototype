import sharp from "sharp";
import { validateSupportingPdf } from "../documents/pdf-validation.ts";
import { QUOTE_FILE_LIMIT } from "../../domain/quotations/drafts.ts";

export class InvalidQuotationOriginal extends Error {
  constructor() {
    super(
      "Choose a readable unencrypted PDF or decodable JPEG, PNG or WebP within 20 MiB.",
    );
  }
}
export async function validateQuotationOriginal(
  bytes: Uint8Array,
  mime: string,
) {
  try {
    if (bytes.length < 5 || bytes.length > QUOTE_FILE_LIMIT)
      throw Error("Invalid size");
    if (mime === "application/pdf") return await validateSupportingPdf(bytes);
    const expected = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    }[mime];
    if (!expected) throw Error("Invalid MIME type");
    // Decode all pixels with a bounded image size; headers alone are insufficient.
    const decoder = sharp(Buffer.from(bytes), {
      failOn: "warning",
      limitInputPixels: 40000000,
    });
    const metadata = await decoder.metadata();
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1
    )
      throw Error("Invalid image");
    await decoder.raw().toBuffer();
  } catch {
    throw new InvalidQuotationOriginal();
  }
}
