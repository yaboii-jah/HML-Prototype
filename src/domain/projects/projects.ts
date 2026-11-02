import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";

export const SCOPE_NAMES = [
  "General Requirement",
  "Structural Works",
  "Civil Works",
  "Architectural",
  "Mechanical",
  "Electrical",
  "Plumbing & Sanitary",
  "Fire Protection",
  "Medical Gas",
  "Variation Order",
] as const;
export const MAX_MONEY_CENTS = BigInt("999999999999999999");
const uuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_PATTERN.test(v);
const version = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9]\d{0,18}$/.test(v);
export const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
const text = (v: unknown, limit: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= limit;

export function moneyCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{0,2})?$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return cents <= MAX_MONEY_CENTS ? cents : null;
}
export function canonicalMoney(value: unknown): string | null {
  const cents = moneyCents(value);
  return cents === null
    ? null
    : `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
export function formatPhp(value: string | null): string {
  const cents = moneyCents(value);
  if (cents === null) return "Unavailable";
  return `₱${(cents / BigInt(100)).toLocaleString("en-PH")}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}

export type ProjectSummary = {
  id: string;
  name: string;
  location: string;
  code: string | null;
  codeLocked: boolean;
  version: string;
  scopeCount: number;
  financial?: {
    budget: string | null;
    allocated: string | null;
    unallocated: string | null;
  };
};
export type ProjectScope = {
  id: string;
  name: string;
  version: string;
  budget?: string | null;
};
export type ProjectDetail = ProjectSummary & {
  scopes: ProjectScope[];
  assignments?: { id: string; name: string }[];
  assignmentCount?: number;
};
export type ProjectHistory = {
  id: string;
  actorName: string;
  actorRole: AuthRole;
  action: string;
  projectId: string;
  projectName: string;
  at: string;
  changes: Record<string, unknown>;
};
export type ProjectDraft = {
  name: string;
  location: string;
  code: string;
  budget: string;
};
export type ProjectCommand =
  | ({ type: "createProject"; requestId: string } & ProjectDraft)
  | ({
      type: "saveProject";
      requestId: string;
      projectId: string;
      projectVersion: string;
    } & ProjectDraft)
  | {
      type: "createScope";
      requestId: string;
      projectId: string;
      projectVersion: string;
      name: string;
      budget: string;
    }
  | {
      type: "saveScope";
      requestId: string;
      projectId: string;
      projectVersion: string;
      scopeId: string;
      scopeVersion: string;
      name: string;
      budget: string;
    }
  | {
      type: "deleteScope";
      requestId: string;
      projectId: string;
      projectVersion: string;
      scopeId: string;
      scopeVersion: string;
    }
  | {
      type: "deleteProject";
      requestId: string;
      projectId: string;
      projectVersion: string;
      assignmentIds: string[];
      clearAssignments: boolean;
    };
export type ProjectResult = {
  ok: boolean;
  message: string;
  conflict?: boolean;
  projectId?: string;
  deleted?: boolean;
};
type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type ProjectInput = WithoutRequest<ProjectCommand>;

export function parseProjectCommand(value: unknown): ProjectCommand | null {
  const v = record(value);
  if (!v || !uuid(v.requestId)) return null;
  const type = v.type;
  if (
    ![
      "createProject",
      "saveProject",
      "createScope",
      "saveScope",
      "deleteScope",
      "deleteProject",
    ].includes(String(type))
  )
    return null;
  if (
    type !== "createProject" &&
    (!uuid(v.projectId) || !version(v.projectVersion))
  )
    return null;
  if (
    (type === "saveScope" || type === "deleteScope") &&
    (!uuid(v.scopeId) || !version(v.scopeVersion))
  )
    return null;
  if (type === "deleteProject") {
    return Array.isArray(v.assignmentIds) &&
      v.assignmentIds.every(uuid) &&
      new Set(v.assignmentIds).size === v.assignmentIds.length &&
      typeof v.clearAssignments === "boolean"
      ? {
          type,
          requestId: v.requestId,
          projectId: String(v.projectId),
          projectVersion: String(v.projectVersion),
          assignmentIds: [...v.assignmentIds].sort(),
          clearAssignments: v.clearAssignments,
        }
      : null;
  }
  if (type === "deleteScope")
    return {
      type,
      requestId: v.requestId,
      projectId: String(v.projectId),
      projectVersion: String(v.projectVersion),
      scopeId: String(v.scopeId),
      scopeVersion: String(v.scopeVersion),
    };
  const budget = canonicalMoney(v.budget);
  if (budget === null || !text(v.name, 200)) return null;
  if (type === "createScope" || type === "saveScope") {
    // Existing nonstandard labels may be retained on edits; SQL permits them
    // only when the stored name is unchanged, never for a create or rename.
    if (type === "createScope" && !SCOPE_NAMES.some((name) => name === v.name))
      return null;
    const base = {
      requestId: v.requestId,
      projectId: String(v.projectId),
      projectVersion: String(v.projectVersion),
      name: v.name.trim(),
      budget,
    };
    return type === "createScope"
      ? { ...base, type }
      : {
          ...base,
          type,
          scopeId: String(v.scopeId),
          scopeVersion: String(v.scopeVersion),
        };
  }
  if (!text(v.location, 500) || typeof v.code !== "string") return null;
  const code = v.code.trim().toUpperCase();
  if (code.length > 20 || !/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code)) return null;
  const draft = {
    requestId: v.requestId,
    name: v.name.trim(),
    location: v.location.trim(),
    code,
    budget,
  };
  return type === "createProject"
    ? { ...draft, type }
    : {
        ...draft,
        type: "saveProject",
        projectId: String(v.projectId),
        projectVersion: String(v.projectVersion),
      };
}

function moneyField(value: unknown): string | null | undefined {
  return value === null ? null : (canonicalMoney(value) ?? undefined);
}
export function parseProject(
  value: unknown,
  financial: boolean,
  detailed = false,
  role?: AuthRole,
): ProjectDetail | null {
  const v = record(value);
  if (
    !v ||
    !uuid(v.id) ||
    !text(v.name, 200) ||
    typeof v.location !== "string" ||
    v.location.length > 500 ||
    !(
      v.code === null ||
      (typeof v.code === "string" &&
        /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(v.code) &&
        v.code.length <= 20)
    ) ||
    !version(v.version) ||
    typeof v.codeLocked !== "boolean" ||
    !Number.isSafeInteger(v.scopeCount) ||
    Number(v.scopeCount) < 0
  )
    return null;
  const project: ProjectDetail = {
    id: v.id,
    name: v.name,
    location: v.location,
    code: v.code,
    codeLocked: v.codeLocked,
    version: v.version,
    scopeCount: Number(v.scopeCount),
    scopes: [],
  };
  if (financial) {
    const f = record(v.financial);
    if (!f) return null;
    const budget = moneyField(f.budget),
      allocated = moneyField(f.allocated),
      unallocated = moneyField(f.unallocated);
    if (
      budget === undefined ||
      allocated === undefined ||
      unallocated === undefined
    )
      return null;
    project.financial = { budget, allocated, unallocated };
  } else if ("financial" in v) return null;
  if (!detailed) return project;
  if (!Array.isArray(v.scopes)) return null;
  for (const item of v.scopes) {
    const s = record(item);
    if (!s || !uuid(s.id) || !text(s.name, 200) || !version(s.version))
      return null;
    const scope: ProjectScope = { id: s.id, name: s.name, version: s.version };
    if (financial) {
      const budget = moneyField(s.budget);
      if (budget === undefined) return null;
      scope.budget = budget;
    } else if ("budget" in s) return null;
    project.scopes.push(scope);
  }
  if (project.scopes.length !== project.scopeCount) return null;
  if (role === "Administrator") {
    if (!Array.isArray(v.assignments)) return null;
    const assignments = [];
    for (const item of v.assignments) {
      const a = record(item);
      if (!a || !uuid(a.id) || !text(a.name, 100)) return null;
      assignments.push({ id: a.id, name: a.name });
    }
    project.assignments = assignments;
  } else if (role === "Project Manager") {
    if (
      !Number.isSafeInteger(v.assignmentCount) ||
      Number(v.assignmentCount) < 0
    )
      return null;
    project.assignmentCount = Number(v.assignmentCount);
  }
  return project;
}
export function parseProjectHistory(
  value: unknown,
  financial: boolean,
): ProjectHistory[] | null {
  if (!Array.isArray(value) || (!financial && value.length > 0)) return null;
  const history = [];
  for (const item of value) {
    const h = record(item),
      changes = record(h?.changes);
    if (
      !h ||
      !uuid(h.id) ||
      !uuid(h.projectId) ||
      !text(h.projectName, 200) ||
      !text(h.actorName, 100) ||
      !isAuthRole(h.actorRole) ||
      !text(h.action, 100) ||
      typeof h.at !== "string" ||
      !Number.isFinite(Date.parse(h.at)) ||
      !changes
    )
      return null;
    history.push({
      id: h.id,
      projectId: h.projectId,
      projectName: h.projectName,
      actorName: h.actorName,
      actorRole: h.actorRole,
      action: h.action,
      at: h.at,
      changes,
    });
  }
  return history;
}
