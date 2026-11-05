import { parseSessionContext, isAuthRole, UUID_PATTERN, type WorkspaceSession } from "../auth/session.ts";
import { parseDirectory, object, type AccountDirectory } from "../accounts/accounts.ts";
import { parseProject, parseProjectHistory, type ProjectSummary, type ProjectDetail, type ProjectHistory } from "../projects/projects.ts";
import { parseRequestView, type RequestView } from "../requests/drafts.ts";
import { parseSupplierView, type SupplierView } from "../suppliers/suppliers.ts";

export type DirectoryView = { role: WorkspaceSession["activeRole"]; projects: ProjectSummary[]; history: ProjectHistory[] };
export type DetailView = { role: WorkspaceSession["activeRole"]; project: ProjectDetail | null; history: ProjectHistory[] };
export type AccountsView = AccountDirectory & { actorId: string; emailEnabled: boolean };
import { parseQuotationsView, type QuotationsView } from "../quotations/drafts.ts";

export type FoundationView =
  | { kind: "quotations"; data: QuotationsView }
  | { kind: "suppliers"; data: SupplierView }
  | { kind: "requests"; data: RequestView }
  | { kind: "projects"; data: DirectoryView }
  | { kind: "project"; data: DetailView }
  | { kind: "accounts"; data: AccountsView };
export type RealtimeSession = { session: WorkspaceSession; sessionId: string; topic: string; accessToken: string; expiresAt: number };

export function parseWorkspaceSession(value: unknown): WorkspaceSession | null {
  const raw = object(value), context = parseSessionContext(value);
  return context && raw && isAuthRole(raw.activeRole) && context.roles.includes(raw.activeRole)
    ? { ...context, activeRole: raw.activeRole } : null;
}
export function parseRealtimeSession(value: unknown): RealtimeSession | null {
  const raw = object(value), session = parseWorkspaceSession(raw?.session);
  if (!raw || !session || typeof raw.sessionId !== "string" || !UUID_PATTERN.test(raw.sessionId)
    || raw.topic !== `foundation:${session.userId}:${session.revision}:${raw.sessionId}`
    || typeof raw.accessToken !== "string" || !raw.accessToken
    || typeof raw.expiresAt !== "number" || !Number.isFinite(raw.expiresAt)) return null;
  return { session, sessionId: raw.sessionId, topic: raw.topic, accessToken: raw.accessToken, expiresAt: raw.expiresAt };
}
export function parseFoundationView(value: unknown): FoundationView | null {
  const raw = object(value), data = object(raw?.data);
  if (!raw || !data) return null;
  if (raw.kind === "quotations") {
    const parsed = parseQuotationsView(data);
    return parsed ? { kind: "quotations", data: parsed } : null;
  }
  if (raw.kind === "suppliers") {
    const parsed = parseSupplierView(data);
    return parsed ? { kind: "suppliers", data: parsed } : null;
  }
  if (raw.kind === "requests") {
    const parsed = parseRequestView(data);
    return parsed ? { kind: "requests", data: parsed } : null;
  }
  if (raw.kind === "accounts") {
    const directory = parseDirectory(data);
    return directory && typeof data.actorId === "string" && UUID_PATTERN.test(data.actorId) && typeof data.emailEnabled === "boolean"
      ? { kind: "accounts", data: { ...directory, actorId: data.actorId, emailEnabled: data.emailEnabled } } : null;
  }
  if (!isAuthRole(data.role)) return null;
  const financial = data.role !== "Site Personnel";
  const history = parseProjectHistory(data.history, financial);
  if (!history) return null;
  if (raw.kind === "projects" && Array.isArray(data.projects)) {
    const projects = data.projects.map(p => parseProject(p, financial));
    return projects.every(p => p !== null)
      ? { kind: "projects", data: { role: data.role, projects, history } } : null;
  }
  if (raw.kind === "project") {
    const project = data.project === null ? null : parseProject(data.project, financial, true, data.role);
    return data.project === null || project
      ? { kind: "project", data: { role: data.role, project, history } } : null;
  }
  return null;
}
export function foundationViewQuery(pathname: string): string | null {
  const quote = /^\/requests\/([^/]+)\/quotes(?:\/[^/]+)?$/.exec(pathname);
  if (quote && UUID_PATTERN.test(quote[1])) return `view=quotations&mrfId=${quote[1]}`;
  if (pathname === "/suppliers") return "view=suppliers";
  const supplier = /^\/suppliers\/([^/]+)$/.exec(pathname);
  if (supplier && UUID_PATTERN.test(supplier[1])) return `view=suppliers&supplierId=${supplier[1]}`;
  if (pathname === "/requests" || pathname === "/requests/new") return "view=requests";
  const request = /^\/requests\/([^/]+)(?:\/edit)?$/.exec(pathname);
  if (request && UUID_PATTERN.test(request[1])) return `view=requests&requestId=${request[1]}`;
  if (pathname === "/projects") return "view=projects";
  if (pathname === "/admin") return "view=accounts";
  const match = /^\/projects\/([^/]+)$/.exec(pathname);
  return match && UUID_PATTERN.test(match[1]) ? `view=project&projectId=${match[1]}` : null;
}
