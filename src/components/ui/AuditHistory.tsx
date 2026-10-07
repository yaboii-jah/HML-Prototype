"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { actorName, auditTime, type AuditRecord } from "@/src/domain/audit";
import { groupAuditEvents } from "@/src/domain/request-lifecycle";
import type { Activity } from "@/src/domain/types";

export function AuditHistory({ entries, records }: { entries: Activity[]; records: Map<string, AuditRecord> }) {
  const [limit, setLimit] = useState(50);
  const groups = useMemo(() => groupAuditEvents(entries), [entries]);
  const recordLink = (event: Activity) => { const record = records.get(event.entity); const ref = event.entityRef || record?.ref || event.entity; return record?.href ? <Link href={record.href}>{ref}</Link> : <span>{ref}</span>; };
  return <div className="audit-history">
    <p className="helper-note">Recorded times are shown in Philippine time. Automatic saves can be expanded to view each saved change.</p>
    {!groups.length ? <p className="muted">No activity recorded yet.</p> : <>
      <div className="table-frame"><table><thead><tr><th>Recorded at</th><th>Action / changes</th><th>User</th><th>Department</th><th>Record</th><th>Reason</th></tr></thead><tbody>{groups.slice(0, limit).map(group => {
        const event = group.entries[0];
        return <tr key={group.id} data-audit-event={event.eventType || "historical"}><td><time dateTime={event.at}>{auditTime(event.at)}</time>{group.entries.length > 1 && <small>From {auditTime(group.entries.at(-1)?.at)}</small>}</td><td>{group.entries.length > 1 ? <details className="audit-save-group"><summary>{event.action} · {group.entries.length} saves</summary><ol>{group.entries.map(value => <li key={value.id}><time dateTime={value.at}>{auditTime(value.at)}</time><strong>{actorName(value.actor, value.actorIdentity)} · {value.actor}</strong>{value.changedFields?.length ? <span>{value.changedFields.join(", ")}</span> : null}{value.reason && <span>{value.reason}</span>}</li>)}</ol></details> : <><strong>{event.action}</strong>{!!event.changedFields?.length && <small>{event.changedFields.join(", ")}</small>}</>}</td><td>{actorName(event.actor, event.actorIdentity)}</td><td>{event.actor}</td><td>{recordLink(event)}</td><td>{event.reason || "—"}</td></tr>;
      })}</tbody></table></div>
      <div className="audit-history-footer"><small>{Math.min(limit, groups.length)} of {groups.length} history rows · {entries.length} recorded events</small>{limit < groups.length && <button className="button secondary" type="button" onClick={() => setLimit(value => value + 50)}>Load more history</button>}</div>
    </>}
  </div>;
}
