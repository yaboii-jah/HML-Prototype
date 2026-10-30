import { ROLES, type Role } from "../types.ts";

export const AUTH_ROLES = ROLES;
export type AuthRole = Role;
export type SessionContext = {
  userId: string;
  displayName: string;
  email: string;
  revision: string;
  roles: AuthRole[];
  projectIds: string[];
};
export type WorkspaceSession = SessionContext & { activeRole: AuthRole };
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === "string" && AUTH_ROLES.some(role => role === value);
}

export function parseLoginPreflight(value: unknown): { userId: string; revision: string; credential: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  return typeof entry.userId === "string" && UUID_PATTERN.test(entry.userId)
    && typeof entry.revision === "string" && /^[1-9]\d*$/.test(entry.revision)
    && typeof entry.credential === "string" && /^[a-f0-9]{64}$/.test(entry.credential)
    ? { userId: entry.userId, revision: entry.revision, credential: entry.credential } : null;
}

export function parseSessionContext(value: unknown): SessionContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.userId !== "string" || !UUID_PATTERN.test(entry.userId)
    || typeof entry.displayName !== "string" || !entry.displayName.trim()
    || typeof entry.email !== "string" || !entry.email
    || typeof entry.revision !== "string" || !/^[1-9]\d*$/.test(entry.revision)
    || !Array.isArray(entry.roles) || !entry.roles.length || !entry.roles.every(isAuthRole)
    || !Array.isArray(entry.projectIds) || !entry.projectIds.every(id => typeof id === "string" && UUID_PATTERN.test(id))) return null;
  if (entry.roles.includes("Site Personnel") && entry.roles.length !== 1) return null;
  return {
    userId: entry.userId, displayName: entry.displayName, email: entry.email,
    revision: entry.revision, roles: [...new Set(entry.roles)], projectIds: [...entry.projectIds],
  };
}

export function chooseActiveRole(roles: readonly AuthRole[], preference: unknown): AuthRole | null {
  if (roles.length === 1) return roles[0];
  return isAuthRole(preference) && roles.includes(preference) ? preference : null;
}

export function rolePreferenceCookie(userId: string) {
  return `constructsync-role-${userId}`;
}

/** Restrict redirects to known workspace paths; credentials and auth routes never qualify. */
export function safeWorkspaceDestination(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\s#%]/.test(value) || value.startsWith("//")) return "/projects";
  const path = value.split("?")[0];
  if (!/^\/(?:projects|dashboard|requests|suppliers|purchase-orders|accounting|finance|deliveries|inventory|reports|admin|stock-transfers)(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) return "/projects";
  return value;
}
