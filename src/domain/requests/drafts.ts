import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { record } from "../projects/projects.ts";

export const detailFields = ["sourceRef", "requestedBy", "approvedBy", "purchaser", "financeOfficer", "specialInstructions"] as const;
export const materialFields = ["name", "unit", "purpose", "location", "remarks"] as const;
export type DraftMaterial = { id: string; quantity: string | null; neededDate: string } & Record<typeof materialFields[number], string>;
export type MrfDraft = { scopeId: string | null; requestDate: string; items: DraftMaterial[] } & Record<typeof detailFields[number], string>;
export type SavedMrf = { id: string; projectId: string; ref: string; version: string; draft: MrfDraft; creatorId: string; creatorName: string; updaterId: string; updaterName: string; createdAt: string; updatedAt: string };
export type RequestProject = { id: string; name: string; code: string | null; scopes: { id: string; name: string }[] };
export type RequestView = { role: AuthRole; requests: SavedMrf[]; projects: RequestProject[] };
export type DraftCommand = { type: "createDraft"; requestId: string; projectId: string; draft: MrfDraft } | { type: "saveDraft"; requestId: string; mrfId: string; expectedVersion: string; draft: MrfDraft };
export type DraftResult = { ok: true; record: SavedMrf; changed: boolean } | { ok: false; message: string; conflict?: boolean; uncertain?: boolean };

export const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export function validDraftDate(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function draftQuantity(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  const normalized = `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  return normalized.replace(/\.$/, "");
}
export function emptyMrfDraft(requestDate = ""): MrfDraft {
  return { scopeId: null, requestDate, sourceRef: "", requestedBy: "", approvedBy: "", purchaser: "", financeOfficer: "", specialInstructions: "", items: [] };
}
export function parseMrfDraft(value: unknown): MrfDraft | null {
  const raw = record(value);
  if (!raw || !(raw.scopeId === null || uuid(raw.scopeId)) || !validDraftDate(raw.requestDate) || !Array.isArray(raw.items)) return null;
  const draft = emptyMrfDraft(raw.requestDate);
  draft.scopeId = raw.scopeId;
  for (const key of detailFields) {
    const text = raw[key];
    if (typeof text !== "string" || text.length > 4000) return null;
    draft[key] = text.trim();
  }
  for (const value of raw.items) {
    const row = record(value);
    if (!row || !uuid(row.id) || !validDraftDate(row.neededDate)) return null;
    const quantity = draftQuantity(row.quantity);
    if (quantity === undefined) return null;
    const item: DraftMaterial = { id: row.id, quantity, neededDate: row.neededDate, name: "", unit: "", purpose: "", location: "", remarks: "" };
    for (const key of materialFields) {
      const text = row[key];
      if (typeof text !== "string" || text.length > 4000) return null;
      item[key] = text.trim();
    }
    draft.items.push(item);
  }
  if (new Set(draft.items.map(item => item.id)).size !== draft.items.length || JSON.stringify(draft).length > 750000) return null;
  return draft;
}
export function parseDraftCommand(value: unknown): DraftCommand | null {
  const raw = record(value), draft = parseMrfDraft(raw?.draft);
  if (!raw || !uuid(raw.requestId) || !draft) return null;
  if (raw.type === "createDraft" && uuid(raw.projectId)) return { type: raw.type, requestId: raw.requestId, projectId: raw.projectId, draft };
  if (raw.type === "saveDraft" && uuid(raw.mrfId) && typeof raw.expectedVersion === "string" && /^[1-9]\d{0,18}$/.test(raw.expectedVersion)) return { type: raw.type, requestId: raw.requestId, mrfId: raw.mrfId, expectedVersion: raw.expectedVersion, draft };
  return null;
}
export function parseSavedMrf(value: unknown): SavedMrf | null {
  const raw = record(value), draft = parseMrfDraft(raw?.draft);
  if (!raw || !draft || !uuid(raw.id) || !uuid(raw.projectId) || !uuid(raw.creatorId) || !uuid(raw.updaterId)
    || typeof raw.ref !== "string" || !/^[A-Z0-9-]+-MRF-\d{4,}$/.test(raw.ref)
    || typeof raw.version !== "string" || !/^[1-9]\d{0,18}$/.test(raw.version)
    || typeof raw.creatorName !== "string" || typeof raw.updaterName !== "string"
    || typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))
    || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) return null;
  return { id: raw.id, projectId: raw.projectId, ref: raw.ref, version: raw.version, draft, creatorId: raw.creatorId, creatorName: raw.creatorName, updaterId: raw.updaterId, updaterName: raw.updaterName, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
}
export function parseRequestView(value: unknown): RequestView | null {
  const raw = record(value);
  if (!raw || !isAuthRole(raw.role) || !Array.isArray(raw.requests) || !Array.isArray(raw.projects)) return null;
  const requests = raw.requests.map(parseSavedMrf);
  if (requests.some(request => request === null)) return null;
  const projects: RequestProject[] = [];
  for (const value of raw.projects) {
    const project = record(value);
    if (!project || !uuid(project.id) || typeof project.name !== "string" || !(project.code === null || typeof project.code === "string") || !Array.isArray(project.scopes)) return null;
    const scopes: RequestProject["scopes"] = [];
    for (const value of project.scopes) {
      const scope = record(value);
      if (!scope || !uuid(scope.id) || typeof scope.name !== "string") return null;
      scopes.push({ id: scope.id, name: scope.name });
    }
    projects.push({ id: project.id, name: project.name, code: project.code, scopes });
  }
  return { role: raw.role, requests: requests.filter(value => value !== null), projects };
}
