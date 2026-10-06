"use client";

import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, PageHeader } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { dashboardMetrics, tasksFor } from "@/src/domain/queues";
import { RequestMonitoringTable } from "@/src/features/requests/RequestMonitoringTable";
import { budgetFor } from "@/src/domain/selectors";

export function Dashboard() {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  const metrics = dashboardMetrics(state);
  const tasks = tasksFor(state);
  const visibleSites = state.sites.filter(site => state.siteFilter === "all" || site.id === state.siteFilter);
  return <>
    <PageHeader eyebrow={`${state.role} workspace`} title="Operations dashboard" description="Your next decisions and the current position of every project." actions={state.role === "Site Personnel" && state.sites.length ? <Link href="/requests/new" className="button primary">New material request</Link> : undefined}/>
    {!state.sites.length && <section className="panel"><span className="eyebrow">START HERE</span><h2>Build your workflow from an empty workspace</h2><p>An Administrator adds projects, then Site Personnel creates material requests. Each department receives the next task in its queue.</p><Link className="button primary" href="/admin">Set up project</Link></section>}
    <div className="metric-strip dashboard-metrics">
      <div><span className="metric-icon blue">MRF</span><small>Procurement reviews</small><strong>{metrics.procurementReviews}</strong><span>Requests awaiting a decision</span></div>
      <div><span className="metric-icon cyan">PO</span><small>Accounting reviews</small><strong>{metrics.accountingReviews}</strong><span>Purchase orders to assess</span>
      </div><div><span className="metric-icon cyan">PAY</span><small>Finance payments</small><strong>{metrics.financeReviews}</strong><span>Review or disburse payment</span></div>
      <div><span className="metric-icon amber">DR</span><small>Open delivery lines</small><strong>{metrics.openDeliveryLines}</strong><span>Materials still expected</span></div>
      <div><span className="metric-icon teal">₱</span><small>Approved commitment</small><strong>{money(metrics.commitment)}</strong><span>Unpaid approved PO value</span></div>
    </div>
    <div className="dashboard-main">
      <section className="panel task-panel"><div className="panel-heading"><div><h2>Waiting for your role</h2></div><Badge>{tasks.length} tasks</Badge></div>{tasks.length ? <div className="task-list">{tasks.slice(0, 8).map(task => <Link href={task.href} key={`${task.href}-${task.title}`}><span className="task-marker"/><span className="task-copy"><strong>{task.title}</strong><small>{task.detail}</small></span><span className="task-age">{task.waiting ? `${task.waiting}d waiting` : "Now"}</span><span className="task-arrow" aria-hidden="true">→</span></Link>)}</div> : <Empty title="You're all caught up" detail="No pending actions for this role and project."/>}</section>
      <section className="panel project-panel"><div className="panel-heading"><div><h2>Budget at a glance</h2></div><Link className="text-link" href="/projects">All projects →</Link></div><div className="project-positions">{visibleSites.map(site => { const budget = budgetFor(state, site.id); const share = budget.allocated > 0 ? Math.max(0, Math.min(100, ((budget.allocated - budget.available) / budget.allocated) * 100)) : 0; return <Link href={`/projects/${site.id}`} key={site.id}><div className="project-position-head"><strong>{site.name}</strong><span>{money(budget.available)} available</span></div><div className="budget-track"><span style={{ width: `${share}%` }}/></div><small>{site.location} · {state.requests.filter(request => request.siteId === site.id).length} requests</small></Link>; })}</div></section>
    </div>
    <RequestMonitoringTable state={state}/>

  </>;
}
