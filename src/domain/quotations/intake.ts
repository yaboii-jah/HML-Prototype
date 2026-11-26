import { record } from "../projects/projects.ts";
import { quoteUuid, validQuoteFile, type QuoteBody, type QuoteFile } from "./drafts.ts";

export const quotedSupplierFields = ["supplierName", "address", "tin", "contactName", "email", "phone"] as const;
export type QuotedSupplier = Pick<QuoteBody, (typeof quotedSupplierFields)[number]>;
export type IntakeFile = QuoteFile & { offset: number; uploaded: boolean };
const states = ["disabled", "idle", "stale", "open", "pending", "running", "ready", "failed", "unusable"] as const;
export type QuotationIntakeStatus = {
  state: (typeof states)[number]; id?: string; files: IntakeFile[]; verified: boolean; reason?: string; supplier?: QuotedSupplier;
};

export function parseIntakeStatus(value: unknown): QuotationIntakeStatus | null {
  const raw = record(value);
  const state = states.find(state => state === raw?.state);
  if (!raw || !state) return null;
  const files: IntakeFile[] = [];
  for (const file of Array.isArray(raw.files) ? raw.files : []) {
    if (!validQuoteFile(file) || !quoteUuid(file.id) || typeof file.offset !== "number" || typeof file.uploaded !== "boolean") return null;
    files.push({ id: file.id, name: file.name, mime: file.mime, size: file.size, sha256: file.sha256, offset: file.offset, uploaded: file.uploaded });
  }
  const supplier = record(raw.supplier);
  return { state, files, verified: raw.verified === true,
    id: quoteUuid(raw.id) ? raw.id : undefined, reason: typeof raw.reason === "string" ? raw.reason : undefined,
    supplier: supplier ? Object.fromEntries(quotedSupplierFields.map(key => [key, typeof supplier[key] === "string" ? supplier[key] : ""])) as QuotedSupplier : undefined,
  };
}
