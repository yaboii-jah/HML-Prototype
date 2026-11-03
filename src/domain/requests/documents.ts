import { record } from "../projects/projects.ts";
import { uuid } from "./drafts.ts";

export const MAX_SUPPORTING_PDF = 50 * 1024 * 1024;
export const DOCUMENT_CHUNK_SIZE = 3 * 1024 * 1024;
export type SupportingDocument = { id: string; name: string; size: number; sha256: string; uploaderName: string; createdAt: string };
export type UploadView = { id: string; name: string; size: number; sha256: string; offset: number; state: string; expiresAt: string; uploaderName: string };
export type DocumentJob = { id: string; kind: "folder" | "validate" | "cleanup" | "archive"; state: string; message: string | null; attempts: number };
export type DocumentsView = { revision: string; current: SupportingDocument | null; uploads: UploadView[]; folder: { id: string; name: string } | null; jobs: DocumentJob[] };
export const pdfFingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validPdfSelection(name: unknown, size: unknown, sha256: unknown) {
  return typeof name === "string" && name.length >= 5 && name.length <= 240 && /\.pdf$/i.test(name)
    && typeof size === "number" && Number.isSafeInteger(size) && size >= 5 && size <= MAX_SUPPORTING_PDF && pdfFingerprint(sha256);
}
export function parseDocumentsView(value: unknown): DocumentsView | null {
  const raw = record(value);
  if (!raw || typeof raw.revision !== "string" || !/^[1-9]\d*$/.test(raw.revision) || !Array.isArray(raw.uploads) || !Array.isArray(raw.jobs)) return null;
  const current = record(raw.current), folder = record(raw.folder);
  if (raw.current !== null && (!current || !uuid(current.id) || !validPdfSelection(current.name, current.size, current.sha256) || typeof current.uploaderName !== "string" || typeof current.createdAt !== "string")) return null;
  if (raw.folder !== null && (!folder || !uuid(folder.id) || typeof folder.name !== "string")) return null;
  const uploads: UploadView[] = [];
  for (const value of raw.uploads) {
    const u = record(value);
    if (!u || !uuid(u.id) || !validPdfSelection(u.name, u.size, u.sha256) || typeof u.offset !== "number" || !Number.isSafeInteger(u.offset) || u.offset < 0 || u.offset > Number(u.size)
      || typeof u.state !== "string" || !["uploading", "validating", "failed", "expired", "conflict"].includes(u.state) || typeof u.expiresAt !== "string" || typeof u.uploaderName !== "string") return null;
    uploads.push({ id: u.id, name: String(u.name), size: Number(u.size), sha256: String(u.sha256), offset: u.offset, state: u.state, expiresAt: u.expiresAt, uploaderName: u.uploaderName });
  }
  const jobs: DocumentJob[] = [];
  for (const value of raw.jobs) {
    const j = record(value);
    if (!j || !uuid(j.id) || !["folder", "validate", "cleanup", "archive"].includes(String(j.kind)) || !["pending", "running", "failed", "paused"].includes(String(j.state)) || !(j.message === null || typeof j.message === "string") || typeof j.attempts !== "number") return null;
    jobs.push({ id: j.id, kind: j.kind as DocumentJob["kind"], state: String(j.state), message: j.message, attempts: j.attempts });
  }
  return { revision: raw.revision, current: current ? { id: String(current.id), name: String(current.name), size: Number(current.size), sha256: String(current.sha256), uploaderName: String(current.uploaderName), createdAt: String(current.createdAt) } : null,
    folder: folder ? { id: String(folder.id), name: String(folder.name) } : null, uploads, jobs };
}

/** Only a single byte range is accepted; do not forward arbitrary upstream headers. */
export function documentRange(value: string | null, size: number): { start: number; end: number } | null {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) throw Error("Invalid byte range");
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !match[1] && Number(match[2]) <= 0 || start < 0 || start >= size || end < start) throw Error("Invalid byte range");
  start = Math.max(start, 0); end = Math.min(end, size - 1);
  return { start, end };
}
