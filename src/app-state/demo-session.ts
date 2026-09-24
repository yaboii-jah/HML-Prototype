import { ROLES, type Role } from "../domain/types.ts";

export const DEMO_PASSWORD = "Demo123!";
export const DEMO_ACCOUNTS: { role: Role; email: string }[] = [
  { role: "Site Personnel", email: "site@constructsync.example" },
  { role: "Project Manager", email: "pm@constructsync.example" },
  { role: "Procurement", email: "procurement@constructsync.example" },
  { role: "Finance", email: "finance@constructsync.example" },
  { role: "Logistics", email: "logistics@constructsync.example" },
  { role: "Accounting / Auditing", email: "accounting@constructsync.example" },
  { role: "Management", email: "management@constructsync.example" },
  { role: "Administrator", email: "admin@constructsync.example" },
];

export function roleForDemoCredentials(email: string, password: string): Role | null {
  if (password !== DEMO_PASSWORD) return null;
  return DEMO_ACCOUNTS.find(account => account.email === email.trim().toLowerCase())?.role ?? null;
}

const SESSION_KEY = "hml-constructsync-demo-session-v1";
export type DemoSessionView = { role: Role | null; status: "loading" | "ready" | "volatile" };
export const serverSessionView: DemoSessionView = { role: null, status: "loading" };

class LocalDemoSession {
  private view: DemoSessionView = serverSessionView;
  private initialized = false;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key !== SESSION_KEY) return;
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
      const saved = localStorage.getItem(SESSION_KEY);
      this.view = { role: ROLES.find(role => role === saved) ?? null, status: "ready" };
    } catch {
      this.view = { role: null, status: "volatile" };
    }
    return this.view;
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  select(role: Role) {
    try {
      localStorage.setItem(SESSION_KEY, role);
      this.view = { role, status: "ready" };
    } catch {
      this.view = { role, status: "volatile" };
    }
    this.initialized = true;
    this.notify();
  }

  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
      this.view = { role: null, status: "ready" };
    } catch {
      this.view = { role: null, status: "volatile" };
    }
    this.initialized = true;
    this.notify();
  }
}

export const demoSession = new LocalDemoSession();
