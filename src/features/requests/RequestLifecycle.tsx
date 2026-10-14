"use client";

import { RecordLink as Link } from "@/src/components/ui/RecordLink";
import { useEffect, useMemo, useRef } from "react";
import { AuditHistory } from "@/src/components/ui/AuditHistory";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { actorText, auditTime } from "@/src/domain/audit";
import { requestLifecycle } from "@/src/domain/request-lifecycle";
import type { DemoSnapshot } from "@/src/domain/types";

export function RequestLifecycle({ state, requestId }: { state: DemoSnapshot; requestId: string }) {
  const lifecycle = useMemo(() => requestLifecycle(state, requestId), [state, requestId]);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const openFromLink = () => {
      if (window.location.hash !== "#lifecycle") return;
      const disclosure = sectionRef.current?.querySelector<HTMLDetailsElement>(":scope > details");
      if (disclosure) disclosure.open = true;
    };
    openFromLink();
    window.addEventListener("hashchange", openFromLink);
    return () => window.removeEventListener("hashchange", openFromLink);
  }, [requestId]);
  return <section ref={sectionRef} className="request-lifecycle" aria-label="MRF lifecycle" id="lifecycle">
    <CollapsibleSection title="MRF lifecycle" defaultOpen={false} stickyHeading="always" summary="Progress and combined activity history">
    <p className="helper-note">Purchasing, payment and delivery progress for this request. Payment and delivery can proceed independently under credit terms.</p>
    <div className="table-frame lifecycle-summary"><table><thead><tr><th>Stage</th><th>Current progress</th><th>Related records</th><th>Latest recorded activity</th></tr></thead><tbody>{lifecycle.stages.map(stage => <tr key={stage.name}><th scope="row">{stage.name}</th><td>{stage.progress}</td><td><div className="lifecycle-record-links">{stage.records.length ? stage.records.map(record => record.href ? <Link href={record.href} key={record.id}>{record.ref}</Link> : <span key={record.id}>{record.ref}</span>) : <span>None yet</span>}</div></td><td><time dateTime={stage.lastEvent?.at || stage.recordedAt}>{auditTime(stage.lastEvent?.at || stage.recordedAt)}</time><small>{stage.lastEvent ? actorText(stage.lastEvent.actor, stage.lastEvent.actorIdentity) : "User not recorded"}</small></td></tr>)}</tbody></table></div>
    <h3 className="subheading">Combined activity history</h3>
    <AuditHistory entries={lifecycle.events} records={lifecycle.records}/>
    </CollapsibleSection>
  </section>;
}
