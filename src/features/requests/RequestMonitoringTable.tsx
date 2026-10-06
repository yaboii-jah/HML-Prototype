"use client";

import { Fragment, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Empty } from "@/src/components/ui/Primitives";
import { actorText, auditTime } from "@/src/domain/audit";
import { batchStage, deliveryLocations, deliveryPayment, legLabel } from "@/src/domain/delivery-flow";
import { dateText, money } from "@/src/domain/format";
import { monitoringRequests, type MonitoringMilestone, type RequestMonitoring } from "@/src/domain/request-monitoring";
import { accountingNextAction, poStatusLabel } from "@/src/domain/workflow";
import { paidTotal, paymentStatus, poTotal, supplierName } from "@/src/domain/selectors";
import type { DemoSnapshot } from "@/src/domain/types";

function ProgressCell({ value }: { value: MonitoringMilestone }) {
  const symbol = value.state === "complete" ? "✓" : value.state === "partial" ? "◐" : value.state === "blocked" ? "!" : "—";
  return <div className={`monitoring-progress is-${value.state}`}><strong><span aria-hidden="true">{symbol}</span> {value.label}</strong>{value.detail && <small>{value.detail}</small>}</div>;
}

function RelatedRecords({ row, state }: { row: RequestMonitoring; state: DemoSnapshot }) {
  return <div className="monitoring-related">
    <div className="panel-heading"><div><h3>Records for {row.request.ref || "unnumbered MRF"}</h3><small>Latest activity: {auditTime(row.latestActivity?.at)} · {row.latestActivity ? actorText(row.latestActivity.actor, row.latestActivity.actorIdentity) : "User not recorded"}</small></div><Link href={`/requests/${row.request.id}#lifecycle`} className="text-link">Open full lifecycle →</Link></div>
    <h4>Purchase orders</h4>
    {row.pos.length ? <div className="table-frame"><table><thead><tr><th>PO</th><th>Supplier</th><th>Review / release</th><th>PO value</th><th>Payment</th><th>Paid / outstanding</th><th>Next action</th></tr></thead><tbody>{row.pos.map(po => {
      const eligible = ["approved", "released"].includes(po.status);
      return <tr key={po.id}><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link><small><Link href={`/accounting/${po.id}`}>Accounting details</Link></small></td><td>{supplierName(state, po)}</td><td><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></td><td>{money(poTotal(state, po))}</td><td>{eligible ? <><Badge value={paymentStatus(state, po)}/><small>{deliveryPayment(state, po)}</small></> : "Awaiting approval"}</td><td>{eligible ? <>{money(paidTotal(state, po.id))}<small>{money(Math.max(0, poTotal(state, po) - paidTotal(state, po.id)))} outstanding</small></> : "—"}</td><td>{accountingNextAction(state, po)}</td></tr>;
    })}</tbody></table></div> : <p className="muted">No purchase orders yet.</p>}
    <h4>Delivery legs</h4>
    {row.batches.length ? <div className="table-frame"><table><thead><tr><th>Batch / parent</th><th>PO</th><th>Route</th><th>Destination</th><th>Scheduled</th><th>Stage</th><th>Issue</th></tr></thead><tbody>{row.batches.map(batch => {
      const po = row.pos.find(value => value.id === batch.poId)!;
      const parent = row.batches.find(value => value.id === batch.parentBatchId), location = deliveryLocations(state, po, batch).destination;
      return <tr key={batch.id}><td><Link href={`/deliveries/${batch.id}`}>{batch.ref}</Link>{parent && <small>From <Link href={`/deliveries/${parent.id}`}>{parent.ref}</Link></small>}</td><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link></td><td>{legLabel(batch)}</td><td>{location.name}<small>{location.address}</small></td><td>{dateText(batch.scheduledDate)}</td><td><Badge value={batch.status}>{batchStage(batch)}</Badge></td><td>{batch.lines.map(line => line.issue).filter(Boolean).join(" · ") || "—"}</td></tr>;
    })}</tbody></table></div> : <p className="muted">No delivery legs yet.</p>}
    <h4>Requested material coverage</h4>
    <div className="table-frame"><table><thead><tr><th>Material</th><th>Unit</th><th>Requested</th><th>Released</th><th>Accepted at site</th><th>Posted</th></tr></thead><tbody>{row.coverage.map(value => <tr key={value.item.id}><th scope="row">{value.item.name || "Unnamed material"}</th><td>{value.item.unit}</td><td>{value.item.quantity}</td><td>{value.released}</td><td>{value.accepted}</td><td>{value.posted}</td></tr>)}</tbody></table></div>
    {row.paymentRequests.length > 0 && <p className="helper-note">Payment requests: {row.paymentRequests.map((payment, index) => <Fragment key={payment.id}>{index > 0 && " · "}<Link href={`/finance/${payment.poId}`}>{payment.ref}</Link> ({payment.status})</Fragment>)}</p>}
  </div>;
}

export function RequestMonitoringTable({ state, siteId, title = "MRF lifecycle checklist" }: { state: DemoSnapshot; siteId?: string; title?: string }) {
  const id = useId(), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [limit, setLimit] = useState(50), [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => monitoringRequests(state, siteId), [state, siteId]);
  const rows = useMemo(() => all.filter(row => {
    const text = `${row.request.ref} ${row.projectName} ${row.scopeName} ${row.pos.map(po => `${po.ref} ${supplierName(state, po)}`).join(" ")}`.toLowerCase();
    const matches = filter === "all" || filter === "attention" && row.flags.needsAttention || filter === "finance" && row.flags.forFinance || filter === "logistics" && row.flags.forLogistics || filter === "delivered" && row.delivered.state === "complete" || filter === "partial" && [row.served, row.finance, row.delivered, row.stock].some(value => value.state === "partial") || row.request.status === filter;
    return text.includes(search.trim().toLowerCase()) && matches;
  }), [all, search, filter, state]);
  const changeFilter = (value: string) => { setFilter(value); setLimit(50); };
  const toggle = (requestId: string) => setExpanded(current => { const next = new Set(current); if (next.has(requestId)) next.delete(requestId); else next.add(requestId); return next; });
  return <section className="panel request-monitoring" aria-labelledby={`${id}-title`}>
    <div className="panel-heading"><div><h2 id={`${id}-title`}>{title}</h2><p className="helper-note">Served: all requested quantities released. Delivered: all requested quantities accepted at site. Finance and stock posting progress independently.</p></div><span className="panel-total">{all.length} MRFs</span></div>
    <div className="toolbar"><input aria-label="Search MRF lifecycle" placeholder="Search MRF, PO, supplier, project or scope" value={search} onChange={event => { setSearch(event.target.value); setLimit(50); }}/><select aria-label="MRF progress filter" value={filter} onChange={event => changeFilter(event.target.value)}><option value="all">All progress</option><option value="attention">Needs attention</option><option value="finance">For Finance</option><option value="logistics">For Logistics</option><option value="partial">Partial progress</option><option value="delivered">Delivered</option><option value="draft">Draft</option><option value="submitted">For Procurement</option><option value="approved">Approved</option><option value="returned">Returned</option><option value="rejected">Rejected</option></select></div>
    <p className="monitoring-legend helper-note">✓ Complete · ◐ Partial · ! Needs attention · — Pending. Each column follows its own records; expand an MRF to inspect related work.</p>
    {!rows.length ? <Empty detail={all.length ? "No requests match this search and progress filter." : "Material requests will appear here as Site Personnel starts the project workflow."}/> : <>
      <div className="table-frame"><table className="monitoring-table"><thead><tr><th>MRF / project / scope</th><th>MRF review</th><th>Served</th><th>Finance</th><th>Logistics</th><th>Delivered</th><th>Stock posting</th></tr></thead><tbody>{rows.slice(0, limit).map(row => {
        const open = expanded.has(row.request.id), recordsId = `${id}-${row.request.id}-records`;
        return <Fragment key={row.request.id}><tr data-monitoring-request={row.request.id}><td><Link className="table-primary" href={`/requests/${row.request.id}`}>{row.request.ref || "Unnumbered draft"}</Link><small>{row.projectName}</small><small>{row.scopeName}</small><button className="text-link monitoring-expand" type="button" aria-expanded={open} aria-controls={recordsId} aria-label={`${open ? "Hide" : "Show"} records for ${row.request.ref || "unnumbered draft"}`} onClick={() => toggle(row.request.id)}>{open ? "Hide records" : "Show records"}</button></td><td><ProgressCell value={row.review}/></td><td><ProgressCell value={row.served}/></td><td><ProgressCell value={row.finance}/>{row.amounts.payable > 0 && <small>{money(row.amounts.paid)} / {money(row.amounts.payable)} paid</small>}</td><td><ProgressCell value={row.logistics}/></td><td><ProgressCell value={row.delivered}/></td><td><ProgressCell value={row.stock}/></td></tr>{open && <tr className="monitoring-detail-row"><td colSpan={7}><div id={recordsId}><RelatedRecords row={row} state={state}/></div></td></tr>}</Fragment>;
      })}</tbody></table></div>
      <div className="audit-history-footer"><small>{Math.min(limit, rows.length)} of {rows.length} MRFs</small>{limit < rows.length && <button className="button secondary" type="button" onClick={() => setLimit(value => value + 50)}>Load more MRFs</button>}</div>
    </>}
  </section>;
}
