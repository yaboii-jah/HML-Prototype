"use client";

import { RecordLink as Link } from "./RecordLink";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useMemo, useState } from "react";
import { actorName, auditTime, type AuditRecord } from "@/src/domain/audit";
import { groupAuditEvents, type AuditGroup } from "@/src/domain/request-lifecycle";
import type { Activity } from "@/src/domain/types";

const recordLink = (event: Activity, records: Map<string, AuditRecord>) => { const record = records.get(event.entity); const ref = event.entityRef || record?.ref || event.entity; return record?.href ? <Link href={record.href}>{ref}</Link> : <span>{ref}</span>; };

function HistoryTable({ groups, records, visible }: { groups: AuditGroup[]; records: Map<string, AuditRecord>; visible?: Set<string> }) {
  return <div className="table-frame"><table><thead><tr><th>Recorded at</th><th>Action / changes</th><th>User</th><th>Department</th><th>Record</th><th>Reason</th></tr></thead><tbody>{groups.map(group => {
    const event = group.entries[0], hidden = visible ? !visible.has(group.id) : false;
    return <tr key={group.id} data-audit-event={event.eventType || "historical"} {...(hidden ? { "data-off-page": "true" } : {})}><td><time dateTime={event.at}>{auditTime(event.at)}</time>{group.entries.length > 1 && <small>From {auditTime(group.entries.at(-1)?.at)}</small>}</td><td>{group.entries.length > 1 ? <details className="audit-save-group"><summary>{event.action} · {group.entries.length} saves</summary><ol>{group.entries.map(value => <li key={value.id}><time dateTime={value.at}>{auditTime(value.at)}</time><strong>{actorName(value.actor, value.actorIdentity)} · {value.actor}</strong>{value.changedFields?.length ? <span>{value.changedFields.join(", ")}</span> : null}{value.reason && <span>{value.reason}</span>}</li>)}</ol></details> : <><strong>{event.action}</strong>{!!event.changedFields?.length && <small>{event.changedFields.join(", ")}</small>}</>}</td><td>{actorName(event.actor, event.actorIdentity)}</td><td>{event.actor}</td><td>{recordLink(event, records)}</td><td>{event.reason || "—"}</td></tr>;
  })}</tbody></table></div>;
}

export function AuditHistory({ entries, records, paginated = false }: { entries: Activity[]; records: Map<string, AuditRecord>; paginated?: boolean }) {
  const { access } = useDemo();
  const visibleEntries = useMemo(() => entries.filter(access.canReadActivity), [entries, access]);
  const [limit, setLimit] = useState(50);
  const [paging, setPaging] = useState({ key: String(visibleEntries.length), page: 1, size: 10 });
  const groups = useMemo(() => groupAuditEvents(visibleEntries), [visibleEntries]);
  const pages = Math.max(1, Math.ceil(groups.length / paging.size));
  const page = paging.key === String(visibleEntries.length) ? Math.min(paging.page, pages) : 1;
  const start = (page - 1) * paging.size;
  const visible = new Set(groups.slice(start, start + paging.size).map(group => group.id));
  return <div className={`audit-history ${paginated ? "is-paginated" : ""}`}>
    <p className="helper-note">Recorded times are shown in Philippine time. Automatic saves can be expanded to view each saved change.</p>
    {!groups.length ? <p className="muted">No activity recorded yet.</p> : paginated ? <>
      <HistoryTable groups={groups} records={records} visible={visible}/>
      <footer className="audit-history-footer register-footer"><label>Per page <select aria-label="History rows per page" value={paging.size} onChange={event => setPaging({ key: String(visibleEntries.length), page: 1, size: Number(event.target.value) })}>{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>{start + 1}–{Math.min(start + paging.size, groups.length)} of {groups.length} history rows · {visibleEntries.length} recorded events</span><div className="register-page-controls"><button type="button" className="button secondary" disabled={page <= 1} aria-label="Previous history page" onClick={() => setPaging({ key: String(visibleEntries.length), page: page - 1, size: paging.size })}>Previous</button><span>{page} / {pages}</span><button type="button" className="button secondary" disabled={page >= pages} aria-label="Next history page" onClick={() => setPaging({ key: String(visibleEntries.length), page: page + 1, size: paging.size })}>Next</button></div></footer>
    </> : <>
      <HistoryTable groups={groups.slice(0, limit)} records={records}/>
      <div className="audit-history-footer"><small>{Math.min(limit, groups.length)} of {groups.length} history rows · {visibleEntries.length} recorded events</small>{limit < groups.length && <button className="button secondary" type="button" onClick={() => setLimit(value => value + 50)}>Load more history</button>}</div>
    </>}
  </div>;
}
