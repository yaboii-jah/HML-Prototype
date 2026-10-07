import type { Item } from "./types.ts";

export const MRF_SOURCE_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MAX_MRF_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_MRF_SOURCE_FILES = 12;
export const MAX_MRF_EXTRACTED_ITEMS = 100;
// Include locally generated warnings when validating the normalized API result again in the browser.
const MAX_MRF_WARNINGS = 50 + MAX_MRF_EXTRACTED_ITEMS * 2 + 6;
export type MrfExtractedDetails = { projectName: string; ref: string; requestDate: string; requestedBy: string; approvedBy: string; purchaser: string; financeOfficer: string; specialInstructions: string };
export type MrfExtraction = { details: MrfExtractedDetails; items: (Omit<Item, "id" | "quantity"> & { quantity: number | null })[] };
export type MrfExtractionResult = { extraction: MrfExtraction; warnings: string[] };

export function mrfSourceError(files: { type: string; size: number }[]): string {
  if (!files.length || files.length > MAX_MRF_SOURCE_FILES) return "Choose one PDF or up to 12 page photos of one MRF.";
  if (files.some(file => !MRF_SOURCE_MIMES.some(mime => mime === file.type) || file.size <= 0)) return "Use a PDF, JPG, PNG or WebP file.";
  if (files.some(file => file.type === "application/pdf") && files.length !== 1) return "Choose one PDF or page photos, without mixing them.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_MRF_SOURCE_BYTES) return "Keep the MRF source files within 4 MB total, or enter the request manually.";
  return "";
}

export function mrfSourceSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return mime === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const readText = (value: unknown): string => {
  if (value === null) return "";
  if (typeof value !== "string" || value.length > 4000) throw new Error("The AI response could not be read. Retry or enter the request manually.");
  return value.trim();
};
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function parseMrfExtraction(value: unknown): MrfExtractionResult {
  if (!isRecord(value) || !["single_mrf", "multiple_mrfs", "other"].includes(String(value.documentType))) throw new Error("The AI response could not be read. Retry or enter the request manually.");
  if (value.documentType !== "single_mrf") throw new Error(value.documentType === "multiple_mrfs" ? "These files contain more than one MRF. Upload one request at a time." : "The document does not appear to be an MRF. Choose an MRF or enter it manually.");
  if (!isRecord(value.details) || !Array.isArray(value.items) || value.items.length > MAX_MRF_EXTRACTED_ITEMS || !Array.isArray(value.warnings) || value.warnings.length > MAX_MRF_WARNINGS || value.warnings.some(warning => typeof warning !== "string" || warning.length > 1000)) throw new Error("The AI response could not be read. Retry or enter the request manually.");
  const warnings: string[] = value.warnings.filter(warning => warning.trim()).map(warning => warning.trim());
  const date = (raw: unknown, label: string) => {
    const text = readText(raw);
    if (text && validDate(text)) return text;
    warnings.push(`${label} needs manual entry.`);
    return "";
  };
  const details: MrfExtractedDetails = {
    projectName: readText(value.details.projectName), ref: readText(value.details.ref), requestDate: date(value.details.requestDate, "Request Date"),
    requestedBy: readText(value.details.requestedBy), approvedBy: readText(value.details.approvedBy), purchaser: readText(value.details.purchaser), financeOfficer: readText(value.details.financeOfficer), specialInstructions: readText(value.details.specialInstructions),
  };
  for (const [key, label] of [["ref", "M.R.F No."], ["requestedBy", "Requested by"], ["approvedBy", "Approved by"], ["purchaser", "Purchaser/Procurement Officer"], ["financeOfficer", "Finance Officer"]] as const) if (!details[key]) warnings.push(`${label} needs manual entry.`);
  const items = value.items.map((item, index) => {
    if (!isRecord(item) || (item.quantity !== null && (typeof item.quantity !== "number" || !Number.isFinite(item.quantity)))) throw new Error("The AI material quantities could not be read. Retry or enter them manually.");
    const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : null;
    const result = { name: readText(item.name), unit: readText(item.unit), quantity, neededDate: date(item.neededDate, `Material ${index + 1} date needed`), purpose: readText(item.purpose), location: readText(item.location), remarks: readText(item.remarks) };
    if (!result.name || !result.unit || !quantity || !result.location) warnings.push(`Check material ${index + 1}: missing name, unit, quantity or delivery location.`);
    return result;
  });
  if (!items.length) warnings.push("No materials were found. Add the requested materials manually.");
  return { extraction: { details, items }, warnings: [...new Set(warnings)] };
}

export function mrfImportedItems(extraction: MrfExtraction, id: () => string): Item[] {
  return (extraction.items.length ? extraction.items : [{ name: "", unit: "", quantity: null, neededDate: "", purpose: "", location: "", remarks: "" }]).map(item => ({ ...item, id: id(), quantity: item.quantity ?? 0 }));
}
