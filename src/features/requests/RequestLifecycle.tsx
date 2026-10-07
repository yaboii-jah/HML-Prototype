"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AuditHistory } from "@/src/components/ui/AuditHistory";
import { actorText, auditTime } from "@/src/domain/audit";
import { requestLifecycle } from "@/src/domain/request-lifecycle";
import type { DemoSnapshot } from "@/src/domain/types";

export function RequestLifecycle({ state, requestId }: { state: DemoSnapshot; requestId: string }) {
  const lifecycle = useMemo(() => requestLifecycle(state, requestId), [state, requestId]);
  return <section className="panel request-lifecycle" aria-labelledby="request-lifecycle-title" id="lifecycle">
    <div className="panel-heading"><div><h2 id="request-lifecycle-title">MRF lifecycle</h2><p className="helper-note">Purchasing, payment and delivery progress for this request. Payment and delivery can proceed independently under credit terms.</p></div></div>
    <div className="table-frame lifecycle-summary"><table><thead><tr><th>Stage</th><th>Current progress</th><th>Related records</th><th>Latest recorded activity</th></tr></thead><tbody>{lifecycle.stages.map(stage => <tr key={stage.name}><th scope="row">{stage.name}</th><td>{stage.progress}</td><td><div className="lifecycle-record-links">{stage.records.length ? stage.records.map(record => record.href ? <Link href={record.href} key={record.id}>{record.ref}</Link> : <span key={record.id}>{record.ref}</span>) : <span>None yet</span>}</div></td><td><time dateTime={stage.lastEvent?.at || stage.recordedAt}>{auditTime(stage.lastEvent?.at || stage.recordedAt)}</time><small>{stage.lastEvent ? actorText(stage.lastEvent.actor, stage.lastEvent.actorIdentity) : "User not recorded"}</small></td></tr>)}</tbody></table></div>
    <h3 className="subheading">Combined activity history</h3>
    <AuditHistory entries={lifecycle.events} records={lifecycle.records}/>
  </section>;
}
