import { isAuthRole, UUID_PATTERN, type AuthRole } from "../auth/session.ts";

export type AccountDraft = { name: string; roles: AuthRole[]; projectIds: string[]; active: boolean; clearAssignments: boolean };
export type Account = {
  id: string; name: string; email: string; active: boolean; version: string;
  roles: AuthRole[]; projectIds: string[]; confirmed: boolean; firstSignedInAt: string | null;
  messageStatus: "not_sent" | "accepted" | "failed" | "uncertain";
};
export type AccountDirectory = {
  users: Account[]; projects: { id: string; name: string }[];
  pending: { requestId: string; draft: AccountDraft & { email: string } }[];
  history: { id: string; actorName: string; action: string; targetId: string; at: string }[];
};
export type AccountCommand =
  | { type: "invite"; requestId: string; draft: AccountDraft & { email: string } }
  | { type: "save"; requestId: string; id: string; version: string; draft: AccountDraft }
  | { type: "message"; requestId: string; id: string; version: string; kind: "invite" | "recovery" };
export type AccountResult = { ok: boolean; message: string; conflict?: boolean; signInRequired?: boolean; accountSaved?: boolean };

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;

function parseDraft(value: unknown): AccountDraft | null {
  const v = object(value);
  if (!v || !text(v.name, 100) || typeof v.active !== "boolean" || typeof v.clearAssignments !== "boolean"
    || !Array.isArray(v.roles) || !v.roles.length || !v.roles.every(isAuthRole) || new Set(v.roles).size !== v.roles.length
    || !Array.isArray(v.projectIds) || !v.projectIds.every(uuid) || new Set(v.projectIds).size !== v.projectIds.length
    || (v.roles.includes("Site Personnel") && v.roles.length !== 1)
    || (!v.roles.includes("Site Personnel") && v.projectIds.length)) return null;
  return { name: v.name.trim(), roles: [...v.roles].sort(), projectIds: [...v.projectIds].sort(), active: v.active, clearAssignments: v.clearAssignments };
}

export function parseAccountCommand(value: unknown): AccountCommand | null {
  const v = object(value);
  if (!v || !uuid(v.requestId)) return null;
  if (v.type === "invite") {
    const draft = parseDraft(v.draft), raw = object(v.draft);
    if (!draft || !raw || !text(raw.email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim())) return null;
    return { type: "invite", requestId: v.requestId, draft: { ...draft, active: true, email: raw.email.trim().toLowerCase() } };
  }
  if (!uuid(v.id) || !version(v.version)) return null;
  if (v.type === "save") {
    const draft = parseDraft(v.draft);
    return draft ? { type: "save", requestId: v.requestId, id: v.id, version: v.version, draft } : null;
  }
  return v.type === "message" && (v.kind === "invite" || v.kind === "recovery")
    ? { type: "message", requestId: v.requestId, id: v.id, version: v.version, kind: v.kind } : null;
}

export function parseAccount(value: unknown): Account | null {
  const v = object(value), draft = parseDraft({ ...v, clearAssignments: false });
  if (!v || !draft || !uuid(v.id) || !version(v.version) || !text(v.email, 254) || typeof v.confirmed !== "boolean"
    || !(v.firstSignedInAt === null || (typeof v.firstSignedInAt === "string" && Number.isFinite(Date.parse(v.firstSignedInAt))))
    || !["not_sent", "accepted", "failed", "uncertain"].includes(String(v.messageStatus))) return null;
  return { id: v.id, name: draft.name, email: v.email, active: draft.active, version: v.version, roles: draft.roles, projectIds: draft.projectIds,
    confirmed: v.confirmed, firstSignedInAt: v.firstSignedInAt, messageStatus: v.messageStatus as Account["messageStatus"] };
}

export function parseDirectory(value: unknown): AccountDirectory | null {
  const v = object(value);
  if (!v || !Array.isArray(v.users) || !Array.isArray(v.projects) || !Array.isArray(v.history) || !Array.isArray(v.pending)) return null;
  const users = v.users.map(parseAccount);
  const projects: AccountDirectory["projects"] = [], history: AccountDirectory["history"] = [];
  const pending: AccountDirectory["pending"] = [];
  if (users.some(user => !user)) return null;
  for (const value of v.projects) {
    const p = object(value);
    if (!p || !uuid(p.id) || !text(p.name, 200)) return null;
    projects.push({ id: p.id, name: p.name });
  }
  for (const value of v.history) {
    const h = object(value);
    if (!h || !uuid(h.id) || !uuid(h.targetId) || !text(h.actorName, 100) || !text(h.action, 100) || typeof h.at !== "string" || !Number.isFinite(Date.parse(h.at))) return null;
    history.push({ id: h.id, targetId: h.targetId, actorName: h.actorName, action: h.action, at: h.at });
  }
  for (const value of v.pending) {
    const p = object(value), command = parseAccountCommand({ ...p, type: "invite" });
    if (!command || command.type !== "invite") return null;
    pending.push({ requestId: command.requestId, draft: command.draft });
  }
  return { users: users.filter((user): user is Account => user !== null), projects, history, pending };
}
