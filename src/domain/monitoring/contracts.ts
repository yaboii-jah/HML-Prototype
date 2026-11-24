import { z } from "zod";
import { UUID_PATTERN, safeWorkspaceDestination } from "../auth/session.ts";
import { businessDate, businessRangeError } from "../business-dates.ts";

const id = z.string().regex(UUID_PATTERN);
const text = z.string();
const count = z.number().int().nonnegative();
const amount = text.regex(/^-?\d+(?:\.\d+)?$/);
const link = text.refine(value => safeWorkspaceDestination(value) === value);
const project = z.object({ id, name: text });
const queue = z.object({
  count,
  actions: z.array(z.object({
    key: text, projectId: id, ref: text, href: link, label: text,
    blocker: text.nullable(), at: text, flag: text.nullable(),
  })),
});
const progress = z.object({
  state: z.enum(["unavailable", "not-started", "partial", "complete"]),
  completeLines: count,
});

export const monitoringSchemas = {
  bell: queue,
  dashboard: queue.extend({
    projects: z.array(project),
    overview: z.array(z.object({ projectId: id, draft: count, review: count, approved: count })),
  }),
  dashboardProgress: z.object({
    page: count.positive(), pages: count.positive(), total: count,
    rows: z.array(z.object({
      id, ref: text, project: text,
      status: z.enum(["draft", "submitted", "returned", "approved", "rejected"]),
      correctionKind: z.enum(["full", "documents"]).nullable(),
      correctionState: z.enum(["editing", "submitted", "returned"]).nullable(),
      totalLines: count, sourcing: progress, receipt: progress, posting: progress,
    })),
  }),
  lifecycle: z.object({
    target: id,
    items: z.array(z.object({
      id, material: text, unit: text, requested: amount, hold: amount, awarded: amount,
      purchasing: amount, releasePending: amount, confirmed: amount, unassigned: amount, accepted: amount, posted: amount,
    })),
    blockers: z.array(text),
    shipments: z.array(z.object({
      ref: text, href: link, warehouse: z.boolean(), state: text, received: z.boolean(),
      posted: z.boolean(), evidence: text, forward: z.boolean(),
    })),
    purchasing: z.array(z.object({
      ref: text, href: link, settled: z.boolean(), cleared: z.boolean(), blockers: z.array(text),
    })),
  }),
  reports: z.object({
    projects: z.array(project),
    activity: z.array(z.object({ projectId: id, label: text, total: count })),
    exceptions: z.array(z.object({ projectId: id, ref: text, href: link, label: text })),
    balances: z.array(z.object({
      accountId: id, projectId: id, description: text, unit: text, onHand: amount,
      reserved: amount, available: amount,
    })),
    financial: z.array(z.object({
      projectId: id, allocated: amount.nullable(), committed: amount, spent: amount, available: amount.nullable(),
      paid: amount, credit: amount, overdue: amount, unsettled: count, uncleared: count,
    })),
  }),
  consumption: z.object({
    projects: z.array(project),
    scopes: z.array(project.extend({ projectId: id })),
    rows: z.array(z.object({
      id, projectId: id, project: text, material: text, unit: text, opening: amount,
      openingEntries: amount, receipts: amount, usage: amount, dispatch: amount, corrections: amount, closing: amount,
    })),
  }),
};

export type MonitoringMode = keyof typeof monitoringSchemas;
export type MonitoringView<M extends MonitoringMode> = z.infer<(typeof monitoringSchemas)[M]>;
export type MonitoringFilters = {
  projectId?: string; target?: string; scopeId?: string;
  from?: string; to?: string; search?: string; unit?: string; status?: string; page?: string;
};
export type MonitoringAction = MonitoringView<"dashboard">["actions"][number];
export type ConsumptionRow = MonitoringView<"consumption">["rows"][number];

export function monitoringMode(value: string | null): MonitoringMode | null {
  return value && Object.hasOwn(monitoringSchemas, value) ? value as MonitoringMode : null;
}

export function parseMonitoringView<M extends MonitoringMode>(mode: M, value: unknown): MonitoringView<M> | null {
  const parsed = monitoringSchemas[mode].safeParse(value);
  return parsed.success ? parsed.data as MonitoringView<M> : null;
}

export function parseMonitoringFilters(mode: MonitoringMode, params: URLSearchParams, today = businessDate()): MonitoringFilters | null {
  const filters: MonitoringFilters = {};
  const keys: Record<MonitoringMode, (keyof MonitoringFilters)[]> = {
    bell: [], dashboard: ["projectId"], lifecycle: ["target"],
    dashboardProgress: ["projectId", "status", "search", "page"],
    reports: ["projectId", "from", "to"],
    consumption: ["projectId", "from", "to", "scopeId", "search", "unit"],
  };
  for (const key of keys[mode]) {
    const values = params.getAll(key);
    if (values.length > 1) return null;
    const value = values[0]?.trim();
    if (!value) continue;
    if ((key === "target" || key.endsWith("Id")) && !id.safeParse(value).success) return null;
    if ((key === "search" || key === "unit") && value.length > 4000) return null;
    filters[key] = value;
  }
  if (mode === "lifecycle" && !filters.target) return null;
  if (mode === "dashboardProgress" && (
    filters.status && !["active", "all"].includes(filters.status) ||
    filters.page && !/^[1-9]\d{0,7}$/.test(filters.page) ||
    (filters.search?.length ?? 0) > 128
  )) return null;
  if (mode === "consumption") {
    filters.from ??= today.slice(0, 7) + "-01";
    filters.to ??= today;
  }
  if (filters.from?.startsWith("0000") || filters.to?.startsWith("0000") ||
    businessRangeError(filters.from ?? "", filters.to ?? "")) return null;
  return filters;
}

export function monitoringParams(filters: MonitoringFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

const consumptionColumns = [
  ["Project", "project"], ["Material", "material"], ["Unit", "unit"],
  ["Opening balance", "opening"], ["Opening stock added", "openingEntries"],
  ["Receipts", "receipts"], ["Usage", "usage"], ["Transfer dispatch", "dispatch"],
  ["Corrections", "corrections"], ["Closing balance", "closing"],
] as const satisfies readonly (readonly [string, keyof ConsumptionRow])[];

function csvCell(value: string, userText = false) {
  const prefix = userText && /^[\s\u0000-\u001f\u007f=+\-@]/u.test(value) ? "'" : "";
  return `"${(prefix + value).replaceAll('"', '""')}"`;
}

export function consumptionCsv(rows: readonly ConsumptionRow[]) {
  const header = consumptionColumns.map(([title]) => csvCell(title)).join(",");
  return "\uFEFF" + header + "\r\n" + rows.map(row =>
    consumptionColumns.map(([, key], index) => csvCell(row[key], index < 3)).join(",") + "\r\n"
  ).join("");
}
