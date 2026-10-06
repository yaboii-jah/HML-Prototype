"use client";

import { RequestMonitoringTable } from "@/src/features/requests/RequestMonitoringTable";

import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, PageHeader, RecordHeader } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { budgetFor, inventoryFor, requestForPO, siteName } from "@/src/domain/selectors";
import { ScopeBudgets } from "./ScopeBudgets";
import { DriveProjectFiles } from "./DriveProjectFiles";

export function Projects() {
  const { snapshot: state } = useDemo(); if (!state) return null;
  return <><PageHeader eyebrow="PROJECT PORTFOLIO" title="Projects and sites" description="Open a site to review its requests, commitments, deliveries, and stock."/>{!state.sites.length && <section className="panel"><Empty title="No projects yet" detail="Ask an Administrator to add a project to start the workflow."/><Link className="button primary" href="/admin">Open administration</Link></section>}<div className="site-grid">{state.sites.filter(s=>state.siteFilter==="all"||s.id===state.siteFilter).map(site=>{const b=budgetFor(state,site.id);return <Link className="site-tile" href={`/projects/${site.id}`} key={site.id}><div className="site-tile-top"><span className="site-code">{site.id.toUpperCase()}</span><Badge>Active</Badge></div><h2>{site.name}</h2><p>{site.location}</p><dl><div><dt>Available</dt><dd>{money(b.available)}</dd></div><div><dt>Requests</dt><dd>{state.requests.filter(r=>r.siteId===site.id).length}</dd></div><div><dt>Purchase orders</dt><dd>{state.pos.filter(po=>requestForPO(state,po)?.siteId===site.id).length}</dd></div></dl><span>Open project workspace →</span></Link>})}</div></>;
}

export function ProjectDetail({ id }: { id: string }) {
  const { snapshot: state } = useDemo(); if (!state) return null;
  const site = state.sites.find(s=>s.id===id); if (!site) return <MissingRecord name="Project" listHref="/projects"/>;
  const budget = budgetFor(state,id);
  return <><RecordHeader backHref="/projects" backLabel="Projects" eyebrow={`${site.location} · ${site.id.toUpperCase()}`} title={site.name} badges={<Badge>Active project</Badge>}/>
    <div className="metric-strip"><div><small>ALLOCATED</small><strong>{money(budget.allocated)}</strong></div><div><small>COMMITTED</small><strong>{money(budget.committed)}</strong></div><div><small>PAID / SPENT</small><strong>{money(budget.spent)}</strong></div><div><small>AVAILABLE</small><strong>{money(budget.available)}</strong></div></div>
    <section className="panel"><ScopeBudgets siteId={id}/></section>
    <RequestMonitoringTable state={state} siteId={id}/>
    <section className="panel"><h2 className="panel-title">Stock on hand</h2>{inventoryFor(state,id).map(item=><Link className="data-link" key={item.id} href={`/inventory/${id}/${item.id}`}><div><strong>{item.name}</strong><small>{siteName(state,id)}</small></div><strong>{item.onHand} {item.unit}</strong></Link>)}{!inventoryFor(state,id).length && <Empty detail="Site stock appears after receiving and posting."/>}</section>
    {site.driveFolderId ? <DriveProjectFiles projectFolderId={site.driveFolderId}/> : <section className="panel"><h2 className="panel-title">Google Drive documents</h2><p className="helper-note">An administrator must map this project&apos;s Drive folder before approved MRFs can be archived.</p></section>}
  </>;
}
