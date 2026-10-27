import { validUsageEntries } from "../domain/usage-entries.ts";
import { applyCommand, type Command, type CommandResult } from "../domain/commands.ts";
import { validStockReviews } from "../domain/stock-suitability.ts";
import { validTransferState } from "../domain/transfer-document.ts";
import { newId } from "../domain/ids.ts";
import { blankWorkspace } from "./blank-workspace.ts";
import { normalizeKnownPlaceholders } from "./normalize.ts";
import { normalizeStoredRoles } from "../app-state/stored-roles.ts";
import { upgradeLegacyQuotes } from "../domain/procurement.ts";
import { ROLES, type AuditIdentity, type DemoSnapshot, type LegacySnapshot } from "../domain/types.ts";
import { clearQuoteFiles } from "../documents/files.ts";
import { validBidReport } from "../domain/bid-reports.ts";
import { validDeliveryReceipt } from "../domain/delivery-document.ts";
import { validDocumentNumberingState } from "../domain/document-numbering.ts";
import { clearOperationalStorage, clearShowcaseBackups, EMPTY_WORKSPACE_MARKER, initializeEmptyWorkspace } from "./workspace-initialization.ts";

const CURRENT_KEY = "hml-constructsync-demo-v12";
const PREVIOUS_KEYS = ["hml-constructsync-demo-v11", "hml-constructsync-demo-v10", "hml-constructsync-demo-v9", "hml-constructsync-demo-v8", "hml-constructsync-demo-v7", "hml-constructsync-demo-v6", "hml-constructsync-demo-v5", "hml-constructsync-demo-v4", "hml-constructsync-demo-v3", "hml-constructsync-demo-v2", "hml-buildsync-demo-v2", "hml-buildsync-demo-v1"] as const;
export type RepositoryView = { snapshot: DemoSnapshot | null; status: "loading" | "ready" | "volatile" | "recovery" | "setup-error"; message?: string };
export interface DemoRepository {
  load(): Promise<RepositoryView>;
  retrySetup(): Promise<RepositoryView>;
  getSnapshot(): RepositoryView;
  subscribe(listener: () => void): () => void;
  execute(command: Command, actor?: AuditIdentity, siteIds?: readonly string[]): Promise<CommandResult>;
  reset(): Promise<RepositoryView>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const arrays = ["sites", "suppliers", "categories", "requests", "quotes", "pos", "batches", "movements", "payments", "accounting", "activity"] as const;
const isSnapshotShape = (value: unknown): value is Record<string, unknown> => isRecord(value) && arrays.every(key => Array.isArray(value[key])) && (ROLES.includes(value.role as (typeof ROLES)[number]) || value.role === "Management") && typeof value.siteFilter === "string";
const dateFromTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const withRequestDates = (snapshot: DemoSnapshot): DemoSnapshot => ({ ...snapshot, requests: snapshot.requests.map(request => ({ ...request, requestDate: request.requestDate || dateFromTimestamp(request.createdAt) })) });
export function migrateLegacy(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || ![1, 2].includes(value.version as number)) return null;
  const legacy = value as LegacySnapshot;
  const requests = legacy.requests.map(request => {
    const { neededDate, purpose, location, remarks, items, ...rest } = request;
    return { ...rest, requestDate: dateFromTimestamp(rest.createdAt), requestedBy: "", approvedBy: "", purchaser: "", financeOfficer: "", items: items.map(item => ({ ...item, neededDate, purpose, location, remarks })) };
  });
  return withRequestDates(upgradeLegacyQuotes(normalizeKnownPlaceholders({ ...structuredClone(legacy), requests, pendingAwards: [], version: 11, bidReports: [] } as unknown as DemoSnapshot)));
}
export function migrateV3OrV4(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || ![3, 4].includes(value.version as number)) return null;
  return withRequestDates(upgradeLegacyQuotes(normalizeKnownPlaceholders({ ...structuredClone(value), pendingAwards: [], version: 11, bidReports: [] } as unknown as DemoSnapshot)));
}
export function migrateV5(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 5 || !Array.isArray(value.pendingAwards)) return null;
  return withRequestDates(normalizeKnownPlaceholders({ ...structuredClone(value), version: 11, bidReports: [] } as unknown as DemoSnapshot));
}
export function migrateV6(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 6 || !Array.isArray(value.pendingAwards)) return null;
  return withRequestDates(normalizeKnownPlaceholders({ ...structuredClone(value), version: 11, bidReports: [] } as unknown as DemoSnapshot));
}
export function migrateV7(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 7 || !Array.isArray(value.pendingAwards)) return null;
  return normalizeKnownPlaceholders({ ...structuredClone(value), version: 11, bidReports: [] } as unknown as DemoSnapshot);
}
export function migrateV8(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 8 || !Array.isArray(value.pendingAwards)) return null;
  return normalizeKnownPlaceholders({ ...structuredClone(value), version: 11, bidReports: [] } as unknown as DemoSnapshot);
}
export function migrateV9(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 9 || !Array.isArray(value.pendingAwards)) return null;
  return normalizeKnownPlaceholders({ ...structuredClone(value), version: 11, bidReports: [] } as unknown as DemoSnapshot);
}
export function migrateV10(value: unknown): DemoSnapshot | null {
  if (!isSnapshotShape(value) || value.version !== 10 || !Array.isArray(value.pendingAwards) || !Array.isArray(value.bidReports) || !value.bidReports.every(validBidReport)) return null;
  return normalizeKnownPlaceholders({ ...structuredClone(value), version: 11 } as unknown as DemoSnapshot);
}
export const parseCurrent = (raw: string): DemoSnapshot | null => {
  const saved: unknown = JSON.parse(normalizeStoredRoles(raw));
  const parsed = isRecord(saved) && saved.role === "Management" ? { ...saved, role: "Project Manager" } : saved;
  if (!isSnapshotShape(parsed) || parsed.version !== 12 || !Array.isArray(parsed.paymentRequests) || !Array.isArray(parsed.pendingAwards) || !Array.isArray(parsed.bidReports)) return null;
  const state = parsed as DemoSnapshot;
  if (state.showcase && (state.showcase.revision !== 1 || typeof state.showcase.installationId !== "string" || !/^[a-z0-9-]{8,80}$/.test(state.showcase.installationId) || typeof state.showcase.seededAt !== "string" || !Number.isFinite(Date.parse(state.showcase.seededAt)))) return null;
  if (state.sites.some(site => site.localArchiveId !== undefined && (!state.showcase || site.localArchiveId !== state.showcase.installationId))) return null;
  if (!validUsageEntries(state)) return null;
  if (!validStockReviews(state)) return null;
  if (!validTransferState(state)) return null;
  if (!validDocumentNumberingState(state)) return null;
  if (!state.pos.every(po => ["draft", "submitted", "hold", "returned", "rejected", "approved", "released"].includes(po.status))) return null;
  if (!state.paymentRequests.every(value => ["draft", "submitted", "hold", "returned", "rejected", "approved", "disbursed"].includes(value.status) && Number.isFinite(value.amount) && value.amount > 0 && state.pos.some(po => po.id === value.poId))) return null;
  if (!state.payments.every(value => state.paymentRequests.some(request => request.id === value.paymentRequestId && request.poId === value.poId && request.status === "disbursed" && request.amount === value.amount))) return null;
  if (state.scopes !== undefined && (!Array.isArray(state.scopes) || state.scopes.some(scope => !scope || typeof scope.id !== "string" || !scope.id || typeof scope.name !== "string" || !scope.name.trim() || !Number.isFinite(scope.budget) || scope.budget < 0 || !state.sites.some(site => site.id === scope.siteId)) || new Set(state.scopes.map(scope => scope.id)).size !== state.scopes.length)) return null;
  if (state.batches.some(batch => {
    if (!batch || !["expected", "dispatched", "confirmed", "posted"].includes(batch.status)) return true;
    if (batch.leg === undefined) return !!batch.parentBatchId;
    const po = state.pos.find(value => value.id === batch.poId), request = state.requests.find(value => value.id === po?.mrfId), project = state.sites.find(value => value.id === request?.siteId);
    return !validDeliveryReceipt({ kind: "delivery", batch, po, request, project, parentBatch: state.batches.find(value => value.id === batch.parentBatchId) });
  })) return null;
  return state.bidReports.every(validBidReport) ? normalizeKnownPlaceholders({ ...state, scopes: state.scopes || [] }) : null;
};

export class LocalDemoRepository implements DemoRepository {
  private view: RepositoryView = { snapshot: null, status: "loading" };
  private initialized = false;
  private bootstrap: Promise<RepositoryView> | undefined;
  private clearing: Promise<RepositoryView> | undefined;
  private bootstrapFailed = false;
  private setupComplete = false;
  private setup: () => Promise<void>;
  private listeners = new Set<() => void>();

  constructor(setup?: () => Promise<void>) {
    this.setup = setup || initializeEmptyWorkspace;
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
    if (typeof window !== "undefined" && !this.setupComplete && !this.bootstrapFailed) {
      try { this.setupComplete = localStorage.getItem(EMPTY_WORKSPACE_MARKER) === "1"; } catch {}
      if (!this.setupComplete) { if (!this.bootstrap) queueMicrotask(() => { void this.load(); }); return this.view; }
    }
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
      this.view = { snapshot: blankWorkspace(), status: "volatile", message: "Changes cannot be saved right now." };
      return this.view;
    }
    try {
      if (current) {
        const normalized = normalizeStoredRoles(current);
        const parsed = parseCurrent(normalized);
        this.view = parsed ? { snapshot: parsed, status: "ready" } : { snapshot: null, status: "recovery", message: "Saved workspace data could not be read. Restore the workspace to continue." };
        if (parsed && normalized !== current) this.view = this.write(parsed);
        return this.view;
      }
      if (previous) {
        this.view = { snapshot: null, status: "recovery", message: "Saved records use an older workflow. Restore the workspace to start the current process. Existing records remain untouched until you confirm." };
        return this.view;
      }
      this.view = this.write(blankWorkspace());
      return this.view;
    } catch {
      this.view = { snapshot: null, status: "recovery", message: "Saved workspace data could not be opened. Restore the workspace to continue." };
      return this.view;
    }
  }
  async load(): Promise<RepositoryView> {
    if (typeof window === "undefined") return this.read();
    if (this.bootstrap) return this.bootstrap;
    this.bootstrap = (async () => {
      try {
        await this.setup();
        this.setupComplete = true;
        this.initialized = false;
        const result = this.read(); this.notify(); return result;
      } catch (cause) {
        this.bootstrapFailed = true; this.initialized = true;
        this.view = { snapshot: null, status: "setup-error", message: cause instanceof Error ? cause.message : "Workspace setup could not finish." };
        this.notify(); return this.view;
      }
    })();
    return this.bootstrap;
  }
  getSnapshot() { return this.read(); }
  async retrySetup(): Promise<RepositoryView> {
    if (this.view.status !== "setup-error") return this.bootstrap || this.view;
    this.bootstrap = undefined;
    this.bootstrapFailed = false;
    this.initialized = false;
    this.view = { snapshot: null, status: "loading" };
    // Establish the in-flight promise before notifying subscribers.
    const retry = this.load();
    this.notify();
    return retry;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async execute(command: Command, actor?: AuditIdentity, siteIds?: readonly string[]): Promise<CommandResult> {
    if (this.clearing) return { ok: false, message: "Wait for workspace clearing to finish before making changes." };
    const current = this.read().snapshot;
    if (!current) return { ok: false, message: "Restore the workspace before making changes." };
    const result = applyCommand(current, command, actor ? { actor, siteIds, now: () => new Date().toISOString(), id: newId } : undefined);
    if (result.ok) { this.view = this.write(result.snapshot); this.notify(); return { ...result, persisted: this.view.status === "ready" }; }
    return result;
  }
  reset(): Promise<RepositoryView> {
    if (this.clearing) return this.clearing;
    const role = this.read().snapshot?.role;
    this.clearing = (async () => {
      try {
        await clearOperationalStorage({ storage: localStorage, force: true, preserveSession: true, role,
          clearFiles: async () => { if (typeof indexedDB !== "undefined") await clearQuoteFiles(); },
          clearBackups: async () => { if (typeof indexedDB !== "undefined") await clearShowcaseBackups(); },
        });
        // Also supports storage adapters without key enumeration.
        PREVIOUS_KEYS.forEach(key => localStorage.removeItem(key));
        this.setupComplete = true;
        this.initialized = false;
        return this.read();
      } finally {
        this.clearing = undefined;
        this.initialized = false;
        this.read();
        this.notify();
      }
    })();
    return this.clearing;
  }
}

export const demoRepository: DemoRepository = new LocalDemoRepository();
export const serverRepositoryView: RepositoryView = { snapshot: null, status: "loading" };
