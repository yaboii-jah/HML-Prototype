"use client";
import { roleLabel } from "@/src/domain/format";
import { useMemo, useState } from "react";
import Link from "next/link";
import { actorName,auditRecords,auditTime } from "@/src/domain/audit";
import { activityRangeError,adminActivityGroups,emptyActivityFilters,type ActivityFilters } from "@/src/domain/admin-activity";
import type { AuditGroup } from "@/src/domain/request-lifecycle";
import type { DemoSnapshot } from "@/src/domain/types";
import { Field,InlineError } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
export function AdminActivity({state}:{state:DemoSnapshot}) {
  const [filters,setFilters]=useState<ActivityFilters>(emptyActivityFilters),[selected,setSelected]=useState<AuditGroup|null>(null);
  const records=useMemo(()=>auditRecords(state),[state]),groups=useMemo(()=>adminActivityGroups(state,filters),[state,filters]);
  const departments=[...new Set(state.activity.map(event=>event.actor))].sort(),error=activityRangeError(filters);
  const change=(key:keyof ActivityFilters,value:string)=>{setFilters(current=>({...current,[key]:value}));setSelected(null);};
  return <section className="admin-activity"><InlineError message={error}/><Register rows={groups} resetKey={JSON.stringify(filters)} unit="activity rows" filters={<>
    <div className="admin-activity-filters">
      <Field label="Search activity"><input type="search" placeholder="Action, record, project or user" value={filters.search} onChange={event => change("search", event.target.value)}/></Field>
      <Field label="Activity project"><select value={filters.project} onChange={event => change("project", event.target.value)}><option value="all">All projects</option><option value="unassigned">Workspace / unassigned</option>{state.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
      <Field label="Activity department"><select value={filters.department} onChange={event => change("department", event.target.value)}><option value="all">All departments</option>{departments.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></Field>
      <Field label="From"><input type="date" value={filters.from} onChange={event => change("from", event.target.value)}/></Field>
      <Field label="To"><input type="date" value={filters.to} min={filters.from || undefined} aria-invalid={!!error} onChange={event => change("to", event.target.value)}/></Field>
      <button className="button secondary" type="button" onClick={() => { setFilters(emptyActivityFilters); setSelected(null); }}>Clear filters</button>
    </div>
</>} empty={error|| (state.activity.length?"No activity matches these filters.":"Project setup and workflow decisions will appear here.")} headers={<><th>Recorded at</th><th>Action</th><th>User / department</th><th>Record</th><th>Details</th></>} renderRow={group=>{const event=group.entries[0],record=records.get(event.entity),ref=event.entityRef||record?.ref||event.entity;return <tr key={group.id} data-admin-activity-event={group.id}><td><time dateTime={event.at}>{auditTime(event.at)}</time></td><td><strong>{event.action}</strong>{group.entries.length>1&&<small>{group.entries.length} matching saves</small>}</td><td>{actorName(event.actor,event.actorIdentity)}<small>{roleLabel(event.actor)}</small></td><td>{record?.href?<Link href={record.href}>{ref}</Link>:ref}</td><td className="register-actions"><button type="button" className="button secondary" aria-haspopup="dialog" onClick={()=>setSelected(group)}>Show details</button></td></tr>;}}/>
    <RecordModal open={!!selected} title="Activity details" onClose={()=>setSelected(null)}><div className="admin-activity-details">{selected?.entries.map(entry=><div key={entry.id}><strong>{entry.action}</strong><p>{auditTime(entry.at)} / {actorName(entry.actor,entry.actorIdentity)} / {roleLabel(entry.actor)}</p><p>{entry.changedFields?.length?entry.changedFields.join(", "):"No changed fields recorded."}</p>{entry.reason&&<p>Reason: {entry.reason}</p>}</div>)}</div></RecordModal>
  </section>;
}
