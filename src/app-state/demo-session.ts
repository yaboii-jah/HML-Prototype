import type { Role } from "../domain/types.ts";
import { userDirectory, LocalUserDirectory, USER_STORAGE_KEY, type ManagedUser } from "./user-directory.ts";
import { normalizeStoredRoles } from "./stored-roles.ts";
export { ACCOUNT_FIXTURES } from "./account-fixtures.ts";

export type AccountIdentity = { email: string; role: Role; userId?: string; revision?: number };
export function accountDisplayName(email: string | null): string { return userDirectory.getSnapshot().users.find(user => user.email === email)?.name || ""; }
const identity = (user: ManagedUser): AccountIdentity => ({ email: user.email, role: user.role, userId: user.id, revision: user.revision });
export async function accountForCredentials(email: string, password: string): Promise<AccountIdentity | null> {
  const user = await userDirectory.authenticate(email, password); return user ? identity(user) : null;
}
export const SESSION_STORAGE_KEY = "hml-constructsync-session-v2";
const LEGACY_SESSION_KEY = "hml-constructsync-demo-session-v1";
export type DemoSessionView = { email: string | null; role: Role | null; status: "loading" | "ready" | "volatile"; userId?: string; revision?: number };
export const serverSessionView: DemoSessionView = { email: null, role: null, status: "loading" };

export class LocalDemoSession {
  private view: DemoSessionView = serverSessionView;
  private initialized = false;
  private listeners = new Set<() => void>();
  private directory: LocalUserDirectory;
  constructor(directory: LocalUserDirectory = userDirectory) {
    this.directory = directory;
    directory.subscribe(() => { this.initialized = false; this.read(); this.notify(); });
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key !== null && ![SESSION_STORAGE_KEY, LEGACY_SESSION_KEY, USER_STORAGE_KEY].includes(event.key)) return;
      this.initialized = false; this.read(); this.notify();
    });
  }
  private storedIdentity(value: unknown): AccountIdentity | null {
    if (!value || typeof value !== "object") return null;
    const saved = value as Record<string, unknown>;
    const user = this.directory.getSnapshot().users.find(user => user.active && user.email === saved.email && user.role === saved.role && (saved.userId === undefined ? user.revision === 1 : user.id === saved.userId && user.revision === saved.revision));
    return user ? identity(user) : null;
  }
  private notify() { this.listeners.forEach(listener => listener()); }
  read(): DemoSessionView {
    if (this.directory.getSnapshot().status === "loading") return this.view;
    if (this.initialized || typeof window === "undefined") return this.view;
    this.initialized = true;
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      let account: AccountIdentity | null = null;
      if (saved) { try { account = this.storedIdentity(JSON.parse(normalizeStoredRoles(saved))); } catch {} }
      if (saved && !account) localStorage.removeItem(SESSION_STORAGE_KEY);
      if (account) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account));
      this.view = account ? { ...account, status: "ready" } : { email: null, role: null, status: "ready" };
    } catch { this.view = { email: null, role: null, status: "volatile" }; }
    return this.view;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  select(value: AccountIdentity) {
    const account = this.storedIdentity(value);
    if (!account) { this.clear(); return; }
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account)); this.view = { ...account, status: "ready" }; }
    catch { this.view = { ...account, status: "volatile" }; }
    this.initialized = true; this.notify();
  }
  switchAccount(userId: string): boolean {
    if (!this.read().role) return false;
    const user = this.directory.getSnapshot().users.find(user => user.id === userId && user.active);
    if (!user) return false;
    this.select(identity(user)); return true;
  }
  switchRole(role: Role): boolean {
    const user = this.directory.getSnapshot().users.find(user => user.role === role && user.active);
    return !!user && this.switchAccount(user.id);
  }
  clear() {
    try { localStorage.removeItem(SESSION_STORAGE_KEY); localStorage.removeItem(LEGACY_SESSION_KEY); this.view = { email: null, role: null, status: "ready" }; }
    catch { this.view = { email: null, role: null, status: "volatile" }; }
    this.initialized = true; this.notify();
  }
}
export const demoSession = new LocalDemoSession();
