import type { DemoSnapshot, DocumentNumbering, DocumentRef, DocumentSeries, Site } from "./types.ts";

export const normalizeProjectCode = (value?: string) => value?.trim().toUpperCase() || "";
export const validProjectCode = (value: string) => value.length <= 20 && /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value);
export function validDocumentNumberingState(state: DemoSnapshot): boolean {
  const series: DocumentSeries[] = ["MRF", "PO", "DEL", "PAY"];
  const codes = state.sites.map(site => site.documentCode).filter((value): value is string => value !== undefined);
  if (codes.some(code => typeof code !== "string" || !validProjectCode(code)) || new Set(codes).size !== codes.length) return false;
  if (state.sites.some(site => site.codeLockedAt !== undefined && (typeof site.codeLockedAt !== "string" || !Number.isFinite(Date.parse(site.codeLockedAt))) || site.documentCounters !== undefined && (!site.documentCounters || typeof site.documentCounters !== "object" || Array.isArray(site.documentCounters) || Object.entries(site.documentCounters).some(([key, value]) => !series.includes(key as DocumentSeries) || !Number.isSafeInteger(value) || value < 0)))) return false;
  const requestProjects = new Map(state.requests.map(request => [request.id, request.siteId]));
  const orderProjects = new Map(state.pos.map(po => [po.id, requestProjects.get(po.mrfId)]));
  return series.every(type => seriesRecords(state, type).every(record => {
    const n = record.numbering;
    if (!n) return true;
    const site = state.sites.find(value => value.id === n.projectId);
    const owner = type === "MRF" ? requestProjects.get(record.id) : type === "PO" ? orderProjects.get(record.id) : "poId" in record ? orderProjects.get(record.poId) : undefined;
    return !!site && projectCodeLocked(site) && owner === n.projectId && site.documentCode === n.projectCode && n.type === type && Number.isSafeInteger(n.sequence) && n.sequence > 0 && record.ref === `${n.projectCode}-${type}-${String(n.sequence).padStart(4, "0")}`;
  }));
}
export function projectCodeValidation(state: DemoSnapshot, value: string, siteId?: string): string {
  if (!validProjectCode(value)) return "Enter a project code of 1–20 letters, numbers or internal hyphens.";
  return state.sites.some(site => site.id !== siteId && normalizeProjectCode(site.documentCode) === value) ? "This project code is already in use." : "";
}
export function projectCodeRequired(state: DemoSnapshot, siteId: string): string {
  return validProjectCode(state.sites.find(site => site.id === siteId)?.documentCode || "") ? "" : "Ask an Administrator or Project Manager to set the project code in Project settings before creating new documents.";
}
export function projectCodeLocked(site: Site): boolean {
  return !!site.codeLockedAt || Object.values(site.documentCounters || {}).some(value => value > 0);
}
export function lockProjectCode(site: Site, at: string) { site.codeLockedAt ||= at; }

function seriesRecords(state: DemoSnapshot, type: DocumentSeries) {
  return type === "MRF" ? state.requests : type === "PO" ? state.pos : type === "DEL" ? state.batches : state.paymentRequests;
}
export function nextDocumentReference(state: DemoSnapshot, siteId: string, type: DocumentSeries): { ref: string; numbering: DocumentNumbering } {
  const site = state.sites.find(value => value.id === siteId)!;
  const records = seriesRecords(state, type);
  const issued = records.filter(value => value.numbering?.projectId === siteId && value.numbering.type === type).map(value => value.numbering!.sequence);
  let sequence = Math.max(site.documentCounters?.[type] || 0, 0, ...issued) + 1;
  const ref = () => `${site.documentCode}-${type}-${String(sequence).padStart(4, "0")}`;
  // An imported legacy reference may already occupy a candidate; never rewrite it.
  while (records.some(value => value.ref.toUpperCase() === ref())) sequence++;
  if (!Number.isSafeInteger(sequence)) throw new Error("The document sequence has reached its limit.");
  return { ref: ref(), numbering: { projectId: siteId, projectCode: site.documentCode!, type, sequence } };
}
export function issueDocumentReference(state: DemoSnapshot, siteId: string, type: DocumentSeries, at: string) {
  const result = nextDocumentReference(state, siteId, type);
  const site = state.sites.find(value => value.id === siteId)!;
  (site.documentCounters ||= {})[type] = result.numbering.sequence;
  lockProjectCode(site, at);
  return result;
}

export function prefixedReference(code: string, ref: string) {
  return ref.startsWith(`${code}-`) ? ref : `${code}-${ref}`;
}
const safePart = (value: string) => value.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim() || "document";
/** Keep the identifying prefix/suffix and extension; shorten only descriptive text. */
export function archiveFileName(prefix: string, original: string, identity = "", extension?: string): string {
  const match = original.match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext = extension || match?.[1] || "";
  const base = safePart(match ? original.slice(0, -match[1].length) : original);
  const start = safePart(prefix).slice(0, 60) + "-";
  const end = (identity ? `-${safePart(identity).slice(-48)}` : "") + ext;
  return start + base.slice(0, Math.max(1, 120 - start.length - end.length)) + end;
}

export const hasNewFiles = (documents: DocumentRef[], previous: DocumentRef[] = []) => documents.some(doc => doc.fileId && !previous.some(old => old.fileId === doc.fileId));
export function freezeUploadNames(state: DemoSnapshot, siteId: string, ref: string, documents: DocumentRef[], previous: DocumentRef[], at: string, quotationId?: string): DocumentRef[] {
  const project = state.sites.find(site => site.id === siteId)!;
  const occupied = new Set(previous.map(doc => doc.archiveName));
  return documents.map((doc, index) => {
    const old = previous.find(value => !!doc.fileId && value.fileId === doc.fileId);
    if (old || !doc.fileId) return { ...doc, archiveName: old?.archiveName };
    lockProjectCode(project, at);
    const prefix = prefixedReference(project.documentCode!, ref);
    let suffix = index + 1;
    let archiveName = archiveFileName(prefix, doc.name, quotationId ? `${quotationId}-${suffix}` : doc.fileId);
    while (occupied.has(archiveName)) archiveName = archiveFileName(prefix, doc.name, `${quotationId || doc.fileId}-${++suffix}`);
    occupied.add(archiveName);
    return { ...doc, archiveName };
  });
}
