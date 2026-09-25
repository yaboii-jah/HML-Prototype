import { applyCommand, type Command, type CommandResult } from "../domain/commands.ts";
import { seedDemo } from "./fixtures/seed.ts";
import { normalizeKnownPlaceholders } from "./normalize.ts";
import { ROLES, type DemoSnapshot, type LegacySnapshot } from "../domain/types.ts";
import { clearQuoteFiles } from "../features/requests/quote-files.ts";

const CURRENT_KEY = "hml-constructsync-demo-v4";
const PREVIOUS_KEYS = ["hml-constructsync-demo-v3", "hml-constructsync-demo-v2", "hml-buildsync-demo-v2", "hml-buildsync-demo-v1"] as const;
export type RepositoryView = { snapshot: DemoSnapshot | null; status: "loading" | "ready" | "volatile" | "recovery"; message?: string };
export interface DemoRepository {
  load(): Promise<RepositoryView>;
  getSnapshot(): RepositoryView;
  subscribe(listener: () => void): () => void;
  execute(command: Command): Promise<CommandResult>;
  reset(): Promise<RepositoryView>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const arrays = ["sites", "suppliers", "categories", "requests", "quotes", "pos", "batches", "movements", "payments", "accounting", "activity"] as const;
const isSnapshotShape = (value: unknown): value is Record<string, unknown> => isRecord(value) && arrays.every(key => Array.isArray(value[key])) && ROLES.includes(value.role as (typeof ROLES)[number]) && typeof value.siteFilter === "string";
export function migrateLegacy(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || ![1, 2].includes(value.version as number)) return null;
  const legacy = value as LegacySnapshot;
  const requests = legacy.requests.map(request => {
    const { neededDate, purpose, location, remarks, items, ...rest } = request;
    return { ...rest, requestedBy: "", approvedBy: "", purchaser: "", financeOfficer: "", items: items.map(item => ({ ...item, neededDate, purpose, location, remarks })) };
  });
  return normalizeKnownPlaceholders({ ...structuredClone(legacy), requests, version: 4 });
}
const parseCurrent = (raw: string): DemoSnapshot | null => {
  const parsed: unknown = JSON.parse(raw);
  return isSnapshotShape(parsed) && parsed.version === 4 ? normalizeKnownPlaceholders(parsed as DemoSnapshot) : null;
};

export class LocalDemoRepository implements DemoRepository {
  private view: RepositoryView = { snapshot: null, status: "loading" };
  private initialized = false;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key !== CURRENT_KEY && !PREVIOUS_KEYS.some(key => key === event.key)) return;
      this.initialized = false;
      this.read();
      this.notify();
    });
  }

  private notify() { this.listeners.forEach(listener => listener()); }
  private write(snapshot: DemoSnapshot): RepositoryView {
    try {
      localStorage.setItem(CURRENT_KEY, JSON.stringify(snapshot));
      return { snapshot, status: "ready" };
    } catch {
      return { snapshot, status: "volatile", message: "Changes cannot be saved right now." };
    }
  }
  private read(): RepositoryView {
    if (this.initialized) return this.view;
    this.initialized = true;
    if (typeof window === "undefined") return this.view;
    let current: string | null;
    let previous: { key: string; raw: string } | undefined;
    try {
      current = localStorage.getItem(CURRENT_KEY);
      if (!current) for (const key of PREVIOUS_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw) { previous = { key, raw }; break; }
      }
    } catch {
      this.view = { snapshot: seedDemo(), status: "volatile", message: "Changes cannot be saved right now." };
      return this.view;
    }
    try {
      if (current) {
        const parsed = parseCurrent(current);
        this.view = parsed ? { snapshot: parsed, status: "ready" } : { snapshot: null, status: "recovery", message: "Saved workspace data could not be read. Restore the workspace to continue." };
        return this.view;
      }
      if (previous) {
        const source: unknown = JSON.parse(previous.raw);
        const migrated = isSnapshotShape(source) && source.version === 3
          ? normalizeKnownPlaceholders({ ...source, version: 4 } as DemoSnapshot)
          : migrateLegacy(source);
        this.view = migrated ? this.write(migrated) : { snapshot: null, status: "recovery", message: "Saved workspace data could not be opened. Restore the workspace to continue." };
        if (migrated && this.view.status === "ready") try { localStorage.removeItem(previous.key); } catch {}
        return this.view;
      }
      this.view = this.write(seedDemo());
      return this.view;
    } catch {
      this.view = { snapshot: null, status: "recovery", message: "Saved workspace data could not be opened. Restore the workspace to continue." };
      return this.view;
    }
  }
  async load() { return this.read(); }
  getSnapshot() { return this.read(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async execute(command: Command): Promise<CommandResult> {
    const current = this.read().snapshot;
    if (!current) return { ok: false, message: "Restore the workspace before making changes." };
    const result = applyCommand(current, command);
    if (result.ok) { this.view = this.write(result.snapshot); this.notify(); }
    return result;
  }
  async reset() {
    this.initialized = true;
    this.view = this.write(seedDemo());
    try { await clearQuoteFiles(); } catch {}
    if (this.view.status === "ready") try { PREVIOUS_KEYS.forEach(key => localStorage.removeItem(key)); } catch {}
    this.notify();
    return this.view;
  }
}

export const demoRepository: DemoRepository = new LocalDemoRepository();
export const serverRepositoryView: RepositoryView = { snapshot: null, status: "loading" };
