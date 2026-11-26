import { record } from "../projects/projects.ts";
import {
  ADJUSTMENT_FIELDS, HEADER_FIELDS, LINE_FIELDS, emptyQuoteBody, emptyQuoteLine,
  parseQuoteBody, quoteDecimal, quoteUuid, type QuoteBody,
} from "./drafts.ts";

export const QUOTE_EXTRACTION_FILES = 12;
export const QUOTE_EXTRACTION_PAGES = 100;
export const extractionHeaders = Object.keys(HEADER_FIELDS) as (keyof typeof HEADER_FIELDS)[];
export const extractionLines = [
  "description", "code", "unit", "quantity", "unitPrice", "brand", "specification",
  "discountType", "discountValue", "taxLabel", "taxRate", "printedTotal", "leadTime", "notes",
] as const satisfies readonly (keyof typeof LINE_FIELDS)[];
export const extractionAdjustments = Object.keys(ADJUSTMENT_FIELDS) as (keyof typeof ADJUSTMENT_FIELDS)[];

type SourcePage = { file: number; page: number };
type SourceFile = { id: string; pages: number };
type Note = { sourceFileId: string; sourcePage: string; text: string };
export type QuoteExtractionProposal = { body: QuoteBody; notes: Note[] };
const decimals = new Set(["quantity", "unitPrice", "discountValue", "taxRate", "printedTotal", "vatRate", "printedSubtotal", "printedTax", "value"]);

function location(value: Record<string, unknown>, files: SourceFile[]) {
  const { file, page } = value as Partial<SourcePage>;
  if (typeof file !== "number" || !Number.isInteger(file) || file < 1 || typeof page !== "number" || !Number.isInteger(page)) return null;
  const selected = files[file - 1];
  return selected && page >= 1 && page <= selected.pages ? { sourceFileId: selected.id, sourcePage: String(page) } : null;
}

export function parseQuoteExtraction(value: unknown, files: SourceFile[]): QuoteExtractionProposal | null {
  const raw = record(value), header = record(raw?.header);
  if (!raw || !header || !Array.isArray(raw.lines) || raw.lines.length > 1000 ||
    !Array.isArray(raw.adjustments) || raw.adjustments.length > 100 || !Array.isArray(raw.notes)) return null;
  const notes: Note[] = [];
  const body = emptyQuoteBody();
  for (const key of extractionHeaders) {
    const entry = record(header[key]);
    const printed = entry && typeof entry.value === "string" ? entry.value.trim() : "";
    if (!entry || !printed) continue;
    const source = location(entry, files);
    if (!source) continue;
    const field = sourceValue(key, printed);
    if (field) body[key] = field;
    else addNote(notes, { ...source, text: `Check ${HEADER_FIELDS[key].toLowerCase()}.` });
  }
  for (const value of raw.lines) {
    const row = record(value);
    const source = row && location(row, files);
    if (!row || !source) return null;
    const line = { ...emptyQuoteLine(), ...source };
    for (const key of extractionLines) {
      line[key] = sourceValue(key, row[key]);
      if (!line[key] && row[key]) addNote(notes, { ...source, text: `Check ${LINE_FIELDS[key].toLowerCase()}.` });
    }
    if (extractionLines.some(key => line[key])) body.lines.push(line);
  }
  for (const value of raw.adjustments) {
    const row = record(value);
    const source = row && location(row, files);
    if (!row || !source) return null;
    const fields = Object.fromEntries(extractionAdjustments.map(key => [key, sourceValue(key, row[key])])) as Omit<QuoteBody["adjustments"][number], "id">;
    if (!fields.value && row.value) addNote(notes, { ...source, text: "Check the charge or adjustment amount." });
    if (fields.label || fields.value) body.adjustments.push({ ...fields, id: crypto.randomUUID() });
  }
  for (const value of raw.notes) {
    const note = record(value);
    const source = note && location(note, files);
    if (source && typeof note?.text === "string") addNote(notes, { ...source, text: note.text });
  }
  const validated = parseQuoteBody(body);
  return validated ? { body: validated, notes } : null;
}

function sourceValue(key: string, value: unknown): string {
  if (typeof value !== "string" || value.length > 4000) return "";
  const printed = value.trim();
  if (decimals.has(key)) return quoteDecimal(printed, key === "quantity" ? "quantity" : "signed") ?? "";
  if ((key === "date" || key === "validUntil") && printed) {
    const time = Date.parse(printed);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(printed) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== printed) return "";
  }
  if (key === "leadDays" && !/^\d{1,6}$/.test(printed)) return "";
  return printed;
}

function addNote(notes: Note[], value: Note) {
  const text = value.text.replace(/\s+/g, " ").trim().slice(0, 240);
  if (text && notes.length < 24 && !notes.some(note => note.sourceFileId === value.sourceFileId && note.sourcePage === value.sourcePage && note.text === text)) {
    notes.push({ ...value, text });
  }
}

export const normalizedQuoteText = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function signature<T extends string>(row: Record<T, string>, fields: readonly T[]) {
  return JSON.stringify(fields.map(key => {
    let value = normalizedQuoteText(row[key]);
    if (decimals.has(key) && value) {
      value = value.replace(/^(-?)0+(?=\d)/, "$1").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      if (value === "-0") value = "0";
    }
    return value;
  }));
}

function appendMissing<T extends string, Row extends Record<T, string>>(existing: Row[], saved: Row[], proposed: Row[], fields: readonly T[]) {
  const seen = new Set([...saved, ...existing].map(row => signature(row, fields)));
  return [...existing, ...proposed.filter(row => {
    const key = signature(row, fields);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

export function fillQuotation(current: QuoteBody, saved: QuoteBody, proposed: QuoteBody, editedHeaders: ReadonlySet<string>): QuoteBody {
  const body = { ...current };
  for (const key of extractionHeaders) {
    if (!current[key].trim() && !saved[key].trim() && !editedHeaders.has(key)) body[key] = proposed[key] || current[key];
  }
  body.lines = appendMissing(current.lines, saved.lines, proposed.lines, extractionLines);
  body.adjustments = appendMissing(current.adjustments, saved.adjustments, proposed.adjustments, extractionAdjustments);
  return body;
}

type Fill = { before: QuoteBody; after: QuoteBody };
function undoRows<Row extends { id: string }>(current: Row[], before: Row[], after: Row[], blank: Partial<Row>) {
  const oldIds = new Set(before.map(row => row.id));
  const added = new Map(after.filter(row => !oldIds.has(row.id)).map(row => [row.id, row]));
  return current.flatMap(row => {
    const filled = added.get(row.id);
    if (!filled) return [row];
    const keys = (Object.keys(filled) as (keyof Row)[]).filter(key => key !== "id");
    if (keys.every(key => row[key] === filled[key])) return [];
    return [{ ...row, ...Object.fromEntries(keys.filter(key => key in blank && row[key] === filled[key]).map(key => [key, blank[key]])) }];
  });
}

export function undoQuotationFill(current: QuoteBody, { before, after }: Fill): QuoteBody {
  const body = { ...current };
  for (const key of extractionHeaders) if (current[key] === after[key] && before[key] !== after[key]) body[key] = before[key];
  body.lines = undoRows(current.lines, before.lines, after.lines, emptyQuoteLine());
  body.adjustments = undoRows(current.adjustments, before.adjustments, after.adjustments, Object.fromEntries(extractionAdjustments.map(key => [key, ""])));
  return body;
}

export type QuoteExtractionStatus = {
  state: "disabled" | "idle" | "pending" | "running" | "ready" | "failed" | "unusable" | "expired" | "stale";
  id?: string;
  attemptId?: string;
  reason?: string;
  proposal?: QuoteExtractionProposal;
};

export function parseQuoteExtractionStatus(value: unknown): QuoteExtractionStatus | null {
  const raw = record(value);
  if (!raw || !["disabled", "idle", "pending", "running", "ready", "failed", "unusable", "expired", "stale"].some(state => state === raw.state)) return null;
  const rawProposal = record(raw.proposal);
  const body = rawProposal && parseQuoteBody(rawProposal.body);
  const notes = rawProposal && Array.isArray(rawProposal.notes) ? rawProposal.notes.flatMap((value: unknown) => {
    const note = record(value);
    return note && quoteUuid(note.sourceFileId) && typeof note.sourcePage === "string" && /^[1-9]\d{0,2}$/.test(note.sourcePage) && typeof note.text === "string"
      ? [{ sourceFileId: note.sourceFileId, sourcePage: note.sourcePage, text: note.text }] : [];
  }) : [];
  return {
    state: raw.state as QuoteExtractionStatus["state"],
    id: quoteUuid(raw.id) ? raw.id : undefined,
    attemptId: quoteUuid(raw.attemptId) ? raw.attemptId : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    proposal: body ? { body, notes } : undefined,
  };
}
