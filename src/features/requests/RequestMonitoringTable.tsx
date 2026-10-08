"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Badge } from "@/src/components/ui/Primitives";
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
  return <div className="monitoring-related"><div className="panel-heading"><div><small>Latest activity: {auditTime(row.latestActivity?.at)} / {row.latestActivity ? actorText(row.latestActivity.actor,row.latestActivity.actorIdentity) : "User not recorded"}</small></div><Link className="text-link" href={`/requests/${row.request.id}#lifecycle`}>Open full lifecycle</Link></div>
    <h4>Purchase orders</h4>
    {row.pos.length ? <Register embedded rows={row.pos} headers={<><th>PO</th><th>Supplier</th><th>Review / release</th><th className="numeric">PO value</th><th>Payment</th><th className="numeric">Paid / outstanding</th><th>Next action</th></>} renderRow={po => {
      const eligible = ["approved", "released"].includes(po.status);
      return <tr key={po.id}><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link><small><Link href={`/accounting/${po.id}`}>Accounting details</Link></small></td><td>{supplierName(state, po)}</td><td><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></td><td className="numeric">{money(poTotal(state, po))}</td><td>{eligible ? <><Badge value={paymentStatus(state, po)}/><small>{deliveryPayment(state, po)}</small></> : "Awaiting approval"}</td><td>{eligible ? <>{money(paidTotal(state, po.id))}<small>{money(Math.max(0, poTotal(state, po) - paidTotal(state, po.id)))} outstanding</small></> : "—"}</td><td>{accountingNextAction(state, po)}</td></tr>;
    }}/> : <p className="muted">No purchase orders yet.</p>}
    <h4>Delivery legs</h4>
    {row.batches.length ? <Register embedded rows={row.batches} headers={<><th>Batch / parent</th><th>PO</th><th>Route</th><th>Destination</th><th>Scheduled</th><th>Stage</th><th>Issue</th></>} renderRow={batch => {
      const po = row.pos.find(value => value.id === batch.poId)!;
      const parent = row.batches.find(value => value.id === batch.parentBatchId), location = deliveryLocations(state, po, batch).destination;
      return <tr key={batch.id}><td><Link href={`/deliveries/${batch.id}`}>{batch.ref}</Link>{parent && <small>From <Link href={`/deliveries/${parent.id}`}>{parent.ref}</Link></small>}</td><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link></td><td>{legLabel(batch)}</td><td>{location.name}<small>{location.address}</small></td><td>{dateText(batch.scheduledDate)}</td><td><Badge value={batch.status}>{batchStage(batch)}</Badge></td><td>{batch.lines.map(line => line.issue).filter(Boolean).join(" · ") || "—"}</td></tr>;
    }}/> : <p className="muted">No delivery legs yet.</p>}
    <h4>Requested material coverage</h4>
    <Register embedded rows={row.coverage} headers={<><th>Material</th><th>Unit</th><th className="numeric">Requested</th><th className="numeric">Released</th><th className="numeric">Accepted at site</th><th className="numeric">Posted</th></>} renderRow={value => <tr key={value.item.id}><th scope="row">{value.item.name || "Unnamed material"}</th><td>{value.item.unit}</td><td className="numeric">{value.item.quantity}</td><td className="numeric">{value.released}</td><td className="numeric">{value.accepted}</td><td className="numeric">{value.posted}</td></tr>}/>
    {row.paymentRequests.length > 0 && <p className="helper-note">Payment requests: {row.paymentRequests.map((payment, index) => <Fragment key={payment.id}>{index > 0 && " · "}<Link href={`/finance/${payment.poId}`}>{payment.ref}</Link> ({payment.status})</Fragment>)}</p>}
  </div>;
}

export function RequestMonitoringTable({state,siteId,title="MRF lifecycle checklist"}:{state:DemoSnapshot;siteId?:string;title?:string}) {
  const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[selected,setSelected]=useState<string|null>(null);
  const all = useMemo(() => monitoringRequests(state, siteId), [state, siteId]);
  const rows = useMemo(() => all.filter(row => {
    const text = `${row.request.ref} ${row.projectName} ${row.scopeName} ${row.pos.map(po => `${po.ref} ${supplierName(state, po)}`).join(" ")}`.toLowerCase();
    const matches = filter === "all" || filter === "attention" && row.flags.needsAttention || filter === "finance" && row.flags.forFinance || filter === "logistics" && row.flags.forLogistics || filter === "delivered" && row.delivered.state === "complete" || filter === "partial" && [row.served, row.finance, row.delivered, row.stock].some(value => value.state === "partial") || row.request.status === filter;
    return text.includes(search.trim().toLowerCase()) && matches;
  }), [all, search, filter, state]);

  const row=all.find(value=>value.request.id===selected);
  return <section className="request-monitoring"><div className="panel-heading"><div><h2>{title}</h2><p className="helper-note">Served: all quantities released. Delivered: accepted at site. Finance and stock posting progress independently.</p></div><span className="panel-total">{all.length} MRFs</span></div>
  <Register embedded tableClassName="monitoring-table" rows={rows} unit="MRFs" resetKey={search+filter+(siteId||state.siteFilter)} filters={<><input aria-label="Search MRF lifecycle" placeholder="Search MRF, PO, supplier, project or scope" value={search} onChange={event => { setSearch(event.target.value); }}/><select aria-label="MRF progress filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All progress</option><option value="attention">Needs attention</option><option value="finance">For Finance</option><option value="logistics">For Logistics</option><option value="delivered">Delivered</option><option value="partial">Partial progress</option><option value="draft">Draft</option><option value="submitted">For Procurement</option><option value="approved">Approved</option><option value="returned">Returned</option><option value="rejected">Rejected</option></select></>} empty={all.length?"No requests match this search and progress filter.":"Material requests will appear here as Site Personnel starts the project workflow."} headers={<><th>MRF / project</th><th>Review</th><th>Served</th><th>Finance</th><th>Logistics</th><th>Delivered</th><th>Stock posting</th><th>Details</th></>} renderRow={item=><tr key={item.request.id} data-monitoring-request={item.request.id}><td><Link className="table-primary" href={`/requests/${item.request.id}`}>{item.request.ref||"Unnumbered draft"}</Link><small title={`${item.projectName} / ${item.scopeName}`}>{item.projectName} / {item.scopeName}</small></td><td><ProgressCell value={item.review}/></td><td><ProgressCell value={item.served}/></td><td><ProgressCell value={item.finance}/></td><td><ProgressCell value={item.logistics}/></td><td><ProgressCell value={item.delivered}/></td><td><ProgressCell value={item.stock}/></td><td className="register-actions"><button className="button secondary" type="button" aria-haspopup="dialog" onClick={()=>setSelected(item.request.id)}>Show records</button></td></tr>}/>
  <RecordModal open={!!row} title={`Records for ${row?.request.ref||"MRF"}`} onClose={()=>setSelected(null)}>{row&&<RelatedRecords row={row} state={state}/>}</RecordModal></section>;
}
