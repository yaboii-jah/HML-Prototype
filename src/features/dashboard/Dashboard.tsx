"use client";

import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import { PageHeader, Badge, Empty } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { dashboardMetrics, tasksFor } from "@/src/domain/queues";
import { budgetFor, outstandingFor, requestForPO, siteName, stockFor } from "@/src/domain/selectors";

export function Dashboard() {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  const metrics = dashboardMetrics(state), tasks = tasksFor(state);
  const activePO = state.pos.find(po => po.status === "served" && (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter) && requestForPO(state, po)?.items.length);
  const activeRequest = activePO && requestForPO(state, activePO);
  const material = activeRequest?.items[0];
  const outstanding = activePO && material ? outstandingFor(state, activePO, material.id) : 0;
  const used = material && activeRequest ? -state.movements.filter(m => m.siteId === activeRequest.siteId && m.itemName.toLowerCase() === material.name.toLowerCase() && m.unit.toLowerCase() === material.unit.toLowerCase() && m.kind === "usage").reduce((sum, m) => sum + m.quantity, 0) : 0;
  return <>
    <PageHeader eyebrow={`${state.role.toUpperCase()} WORKSPACE`} title="Operations dashboard" description="Current work, linked records, and project exposure." actions={state.role === "Site Personnel" ? <Link href="/requests/new" className="button primary">New material request</Link> : undefined}/>
    <div className="metric-strip"><div><small>PM REVIEWS</small><strong>{metrics.pmReviews}</strong><span>Submitted requests</span></div><div><small>FINANCE REVIEWS</small><strong>{metrics.financeReviews}</strong><span>Finalized or held POs</span></div><div><small>OPEN DELIVERY LINES</small><strong>{metrics.openDeliveryLines}</strong><span>Served purchase orders</span></div><div><small>APPROVED COMMITMENT</small><strong>{money(metrics.commitment)}</strong><span>Unpaid PO value</span></div></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">ACTION QUEUE</span><h2>Waiting for your role</h2></div><Badge>{tasks.length} tasks</Badge></div>{tasks.length ? <div className="compact-list">{tasks.slice(0,9).map(task=><Link href={task.href} key={`${task.href}-${task.title}`}><div><strong>{task.title}</strong><small>{task.detail}</small></div><span>{task.waiting}d waiting →</span></Link>)}</div> : <Empty detail="No pending actions for this role and site."/>}</section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT POSITION</span><h2>Budget at a glance</h2></div><Link className="text-link" href="/projects">All projects →</Link></div><div className="compact-list">{state.sites.filter(s=>state.siteFilter==="all"||s.id===state.siteFilter).map(site=>{const b=budgetFor(state,site.id);return <Link href={`/projects/${site.id}`} key={site.id}><div><strong>{site.name}</strong><small>{site.location} · {state.requests.filter(r=>r.siteId===site.id).length} requests</small></div><span>{money(b.available)} available →</span></Link>})}</div></section></div>
    {activePO&&activeRequest&&material&&<section className="purchase-pulse"><div><span className="eyebrow">PURCHASE POSITION · {activePO.ref}</span><h2>{material.name}</h2><p>{siteName(state, activeRequest.siteId)}. Track accepted deliveries, usage, and remaining quantity for this purchase.</p><Link className="button secondary" href={`/purchase-orders/${activePO.id}`}>Open purchase order →</Link></div><dl><div><dt>Ordered</dt><dd>{material.quantity} {material.unit}</dd></div><div><dt>Accepted</dt><dd>{material.quantity-outstanding} {material.unit}</dd></div><div><dt>Used</dt><dd>{used} {material.unit}</dd></div><div><dt>On hand</dt><dd>{stockFor(state,activeRequest.siteId,material.name,material.unit)} {material.unit}</dd></div><div><dt>Outstanding</dt><dd>{outstanding} {material.unit}</dd></div></dl></section>}
  </>;
}
