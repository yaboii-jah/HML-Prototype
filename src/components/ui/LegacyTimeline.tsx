"use client";

import { AuditHistory } from "./AuditHistory";
import { CollapsibleSection } from "./CollapsibleSection";
import { auditRecords } from "@/src/domain/audit";
import { groupAuditEvents } from "@/src/domain/request-lifecycle";
import { activityFor } from "@/src/domain/selectors";
import type { DemoSnapshot } from "@/src/domain/types";

export function Timeline({ state, ids }: { state: DemoSnapshot; ids: string[] }) { const entries = activityFor(state, ids); return <section className="activity-timeline"><CollapsibleSection title="Activity timeline" defaultOpen={false} summary={`${groupAuditEvents(entries).length} history rows · ${entries.length} recorded events`}><AuditHistory entries={entries} records={auditRecords(state)} paginated/></CollapsibleSection></section>; }
