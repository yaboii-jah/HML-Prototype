import { supplierName } from "./selectors.ts";
import type { AccountingDocument, DemoSnapshot } from "./types.ts";
export const ACCOUNTING_KINDS = ["Payment receipt", "Invoice", "Delivery receipt", "Other"] as const;
export const ACCOUNTING_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MAX_ACCOUNTING_FILE = 20 * 1024 * 1024;
export const MAX_ACCOUNTING_BATCH = 45 * 1024 * 1024;
export function validAccountingDocument(value: Pick<AccountingDocument, "name" | "kind" | "mime" | "size" | "localFileId" | "sha256">) {
  return typeof value.name === "string" && !!value.name.trim() && ACCOUNTING_KINDS.includes(value.kind) && ACCOUNTING_MIMES.includes(value.mime) && Number.isInteger(value.size) && value.size >= 12 && value.size <= MAX_ACCOUNTING_FILE && typeof value.localFileId === "string" && !!value.localFileId.trim() && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
}
export function accountingSignature(bytes: Uint8Array, mime: string) {
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  return mime === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
export function accountingGroups(state: DemoSnapshot, search = "") {
  const query = search.trim().toLowerCase();
  return state.requests.filter(request => state.siteFilter === "all" || request.siteId === state.siteFilter).flatMap(request => {
    const all = state.pos.filter(po => po.mrfId === request.id);
    const pos = all.filter(po => `${request.ref} ${po.ref} ${supplierName(state, po)}`.toLowerCase().includes(query));
    return pos.length ? [{ request, pos, totalCount: all.length }] : [];
  });
}
