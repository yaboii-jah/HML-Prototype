import { actorName, auditProjectId, auditRecords } from "./audit.ts";
import { groupAuditEvents, type AuditGroup } from "./request-lifecycle.ts";
import type { DemoSnapshot } from "./types.ts";

export type ActivityFilters = { search: string; project: string; department: string; from: string; to: string };
export const emptyActivityFilters: ActivityFilters = { search: "", project: "all", department: "all", from: "", to: "" };
export function activityDateKey(at: string): string {
  if (!Number.isFinite(Date.parse(at))) return "";
  const parts = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find(value => value.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function activityRangeError(filters: Pick<ActivityFilters, "from" | "to">) {
  for (const value of [filters.from, filters.to]) if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return "Choose valid dates.";
  return filters.from && filters.to && filters.from > filters.to ? "Choose an end date on or after the start date." : "";
}
export function adminActivityGroups(state: DemoSnapshot, filters: ActivityFilters): AuditGroup[] {
  if (activityRangeError(filters)) return [];
  const records = auditRecords(state), search = filters.search.trim().toLowerCase();
  // Group the original history first: filtering must not join previously interrupted saves.
  return groupAuditEvents(state.activity).flatMap(group => {
    const entries = group.entries.filter(event => {
      const projectId = auditProjectId(state, event, records);
      if (filters.project !== "all" && (filters.project === "unassigned" ? !!projectId : projectId !== filters.project && !event.relatedProjectIds?.includes(filters.project))) return false;
      if (filters.department !== "all" && event.actor !== filters.department) return false;
      if (filters.from || filters.to) {
        const date = activityDateKey(event.at);
        if (!date || filters.from && date < filters.from || filters.to && date > filters.to) return false;
      }
      const record = records.get(event.entity), project = state.sites.find(site => site.id === projectId);
      return !search || [event.action, actorName(event.actor, event.actorIdentity), event.actor, event.entityRef, record?.ref, event.entity, event.reason, project?.name, ...(event.changedFields || [])].join(" ").toLowerCase().includes(search);
    });
    return entries.length ? [{ id: group.id, entries }] : [];
  });
}
