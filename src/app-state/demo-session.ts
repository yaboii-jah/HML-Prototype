import type { Role } from "../domain/types.ts";

// Fixed walkthrough credentials. Deployment protection remains the server access gate.
export const ACCOUNT_FIXTURES: { name: string; role: Role; email: string; password: string }[] = [
  { name: "Miguel Santos", role: "Site Personnel", email: "hml.constructsync.site@gmail.com", password: "HML!SITE2026" },
  { name: "Andrea Reyes", role: "Procurement", email: "hml.constructsync.procurement@gmail.com", password: "HML!PROC2026" },
  { name: "Paolo Mendoza", role: "Finance", email: "hml.constructsync.finance@gmail.com", password: "HML!FIN2026" },
  { name: "Carlo Villanueva", role: "Logistics", email: "hml.constructsync.logistics@gmail.com", password: "HML!LOG2026" },
  { name: "Isabel Cruz", role: "Accounting / Auditing", email: "hml.constructsync.accounting@gmail.com", password: "HML!ACCT2026" },
  { name: "Rafael Navarro", role: "Management", email: "hml.constructsync.management@gmail.com", password: "HML!MGMT2026" },
  { name: "Daniel Garcia", role: "Administrator", email: "hml.constructsync.admin@gmail.com", password: "HML!ADMIN2026" },
];
export function accountDisplayName(email: string | null): string {
  return ACCOUNT_FIXTURES.find(account => account.email === email)?.name ?? "";
}
export type AccountIdentity = { email: string; role: Role };
export function accountForCredentials(email: string, password: string): AccountIdentity | null {
  const account = ACCOUNT_FIXTURES.find(account => account.email === email.trim().toLowerCase() && account.password === password);
  return account ? { email: account.email, role: account.role } : null;
}

export const SESSION_STORAGE_KEY = "hml-constructsync-session-v2";
const LEGACY_SESSION_KEY = "hml-constructsync-demo-session-v1";
export type DemoSessionView = { email: string | null; role: Role | null; status: "loading" | "ready" | "volatile" };
export const serverSessionView: DemoSessionView = { email: null, role: null, status: "loading" };
const storedIdentity = (value: unknown): AccountIdentity | null => {
  if (!value || typeof value !== "object") return null;
  const identity = value as Record<string, unknown>;
  const account = ACCOUNT_FIXTURES.find(account => account.email === identity.email && account.role === identity.role);
  return account ? { email: account.email, role: account.role } : null;
};

export class LocalDemoSession {
  private view: DemoSessionView = serverSessionView;
  private initialized = false;
  private listeners = new Set<() => void>();
  constructor() {
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key !== null && event.key !== SESSION_STORAGE_KEY && event.key !== LEGACY_SESSION_KEY) return;
      this.initialized = false;
      this.read();
      this.notify();
    });
  }
  private notify() { this.listeners.forEach(listener => listener()); }
  read(): DemoSessionView {
    if (this.initialized || typeof window === "undefined") return this.view;
    this.initialized = true;
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      let account: AccountIdentity | null = null;
      if (saved) { try { account = storedIdentity(JSON.parse(saved)); } catch { /* Invalid sessions require sign-in. */ } }
      if (saved && !account) localStorage.removeItem(SESSION_STORAGE_KEY);
      this.view = { email: account?.email ?? null, role: account?.role ?? null, status: "ready" };
    } catch { this.view = { email: null, role: null, status: "volatile" }; }
    return this.view;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  select(identity: AccountIdentity) {
    const account = storedIdentity(identity);
    if (!account) { this.clear(); return; }
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account));
      this.view = { ...account, status: "ready" };
    } catch { this.view = { ...account, status: "volatile" }; }
    this.initialized = true;
    this.notify();
  }
  switchRole(role: Role): boolean {
    if (!this.read().role) return false;
    const account = ACCOUNT_FIXTURES.find(value => value.role === role);
    if (!account) return false;
    this.select(account);
    return true;
  }
  clear() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      this.view = { email: null, role: null, status: "ready" };
    } catch { this.view = { email: null, role: null, status: "volatile" }; }
    this.initialized = true;
    this.notify();
  }
}
export const demoSession = new LocalDemoSession();
