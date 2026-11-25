import { record } from "../projects/projects.ts";
import { draftQuantity, materialFields, uuid, validDraftDate, type DraftMaterial, type MrfDraft } from "./drafts.ts";

export const MAX_EXTRACTION_BYTES = 10_000_000;
export const MAX_EXTRACTION_PAGES = 100;
export const suggestionFields = ["requestDate", "requestedBy", "approvedBy", "purchaser", "financeOfficer", "specialInstructions"] as const;
const comparisonFields = ["projectName", "sourceRef"] as const;
const proposalFields = [...comparisonFields, ...suggestionFields] as const;
export type SuggestionField = typeof suggestionFields[number];
type PrintedValue = { value: string; page: number | null };
type SuggestedMaterial = Omit<DraftMaterial, "id"> & { page: number };
export type MrfProposal = { details: Record<typeof proposalFields[number], PrintedValue>; rows: SuggestedMaterial[] };
export type AppliedExtraction = { id: string; fields: Partial<Record<SuggestionField, { before: string; filled: string }>>; rowIds: string[] };

const boundedText = (value: unknown) => typeof value === "string" && value.length <= 4000 ? value.trim() : "";
export function parseMrfProposal(value: unknown, pageCount = MAX_EXTRACTION_PAGES): MrfProposal | null {
  const source = record(value);
  const details = record(source?.details);
  if (!details || !Array.isArray(source?.rows)) return null;
  const pageNumber = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= pageCount ? value : null;
  const fields = Object.fromEntries(proposalFields.map(key => {
    const printed = record(details[key]);
    const page = pageNumber(printed?.page);
    const text = boundedText(printed?.value);
    return [key, { value: page && (key !== "requestDate" || validDraftDate(text)) ? text : "", page }];
  })) as MrfProposal["details"];
  const rows: SuggestedMaterial[] = [];
  for (const raw of source.rows) {
    const row = record(raw);
    const page = pageNumber(row?.page);
    if (!row || !page) return null;
    const values = Object.fromEntries(materialFields.map(key => [key, boundedText(row[key])])) as Record<typeof materialFields[number], string>;
    const quantity = draftQuantity(typeof row.quantity === "string" ? row.quantity.trim() : null) ?? null;
    const date = boundedText(row.neededDate);
    if (Object.values(values).some(Boolean) || quantity || date) {
      rows.push({ ...values, page, quantity, neededDate: validDraftDate(date) ? date : "" });
    }
  }
  rows.sort((left, right) => left.page - right.page);
  return { details: fields, rows };
}

const states = ["disabled", "idle", "pending", "running", "ready", "failed", "unusable", "expired", "stale"] as const;
type ExtractionState = typeof states[number];
export type ExtractionStatus = {
  state: ExtractionState; id?: string; attemptId?: string; reason?: string; proposal?: MrfProposal;
};
export function parseExtractionStatus(value: unknown): ExtractionStatus | null {
  const raw = record(value);
  const state = states.find(state => state === raw?.state);
  if (!raw || !state) return null;
  if (state === "ready") {
    const proposal = parseMrfProposal(raw.proposal);
    return uuid(raw.id) && proposal ? { state, id: raw.id, proposal } : null;
  }
  return { state, id: uuid(raw.id) ? raw.id : undefined, attemptId: uuid(raw.attemptId) ? raw.attemptId : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined };
}

const normalizedText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function materialKey(row: Omit<DraftMaterial, "id">) {
  const exact = row.quantity === null ? null : row.quantity.trim();
  return JSON.stringify([
    ...materialFields.map(key => normalizedText(row[key])),
    row.neededDate,
    draftQuantity(exact) ?? exact,
  ]);
}

export function fillMrfDraft(draft: MrfDraft, proposal: MrfProposal, id: string, newId: () => string) {
  const next = { ...draft };
  const applied: AppliedExtraction = { id, fields: {}, rowIds: [] };
  for (const field of suggestionFields) {
    const value = proposal.details[field].value;
    if (value && !draft[field].trim()) {
      applied.fields[field] = { before: draft[field], filled: value };
      next[field] = value;
    }
  }
  const known = new Set(draft.items.map(materialKey));
  next.items = [...draft.items];
  for (const { name, unit, purpose, location, remarks, neededDate, quantity } of proposal.rows) {
    const row = { name, unit, purpose, location, remarks, neededDate, quantity };
    const key = materialKey(row);
    if (known.has(key)) continue;
    known.add(key);
    const rowId = newId();
    next.items.push({ ...row, id: rowId });
    applied.rowIds.push(rowId);
  }
  return { draft: next, applied };
}

export function removeMrfProposal(draft: MrfDraft, applied: AppliedExtraction): MrfDraft {
  const added = new Set(applied.rowIds);
  const next = { ...draft, items: draft.items.filter(row => !added.has(row.id)) };
  for (const field of suggestionFields) {
    const change = applied.fields[field];
    if (change && draft[field] === change.filled) next[field] = change.before;
  }
  return next;
}
