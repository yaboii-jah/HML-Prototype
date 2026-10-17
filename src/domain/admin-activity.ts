import { businessDate, businessRangeError } from "./business-dates.ts";
import { actorName, auditProjectId, auditRecords } from "./audit.ts";
import { groupAuditEvents, type AuditGroup } from "./request-lifecycle.ts";
import type { DemoSnapshot } from "./types.ts";

export type ActivityFilters = { search: string; project: string; department: string; from: string; to: string };
export const emptyActivityFilters: ActivityFilters = { search: "", project: "all", department: "all", from: "", to: "" };
export const activityDateKey = (at: string) => typeof at === "string" && at ? businessDate(at) : "";
export const activityRangeError = (filters: Pick<ActivityFilters, "from" | "to">) => businessRangeError(filters.from, filters.to);
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
