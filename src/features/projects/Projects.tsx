"use client";

import Link from "next/link";
import { poStatusLabel } from "@/src/domain/workflow";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, PageHeader, RecordHeader } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money } from "@/src/domain/format";
import { budgetFor, earliestNeededDate, inventoryFor, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import { DriveProjectFiles } from "./DriveProjectFiles";

export function Projects() {
  const { snapshot: state } = useDemo(); if (!state) return null;
  return <><PageHeader eyebrow="PROJECT PORTFOLIO" title="Projects and sites" description="Open a site to review its requests, commitments, deliveries, and stock."/>{!state.sites.length && <section className="panel"><Empty title="No projects yet" detail="Ask an Administrator to add a project to start the workflow."/><Link className="button primary" href="/admin">Open administration</Link></section>}<div className="site-grid">{state.sites.filter(s=>state.siteFilter==="all"||s.id===state.siteFilter).map(site=>{const b=budgetFor(state,site.id);return <Link className="site-tile" href={`/projects/${site.id}`} key={site.id}><div className="site-tile-top"><span className="site-code">{site.id.toUpperCase()}</span><Badge>Active</Badge></div><h2>{site.name}</h2><p>{site.location}</p><dl><div><dt>Available</dt><dd>{money(b.available)}</dd></div><div><dt>Requests</dt><dd>{state.requests.filter(r=>r.siteId===site.id).length}</dd></div><div><dt>Purchase orders</dt><dd>{state.pos.filter(po=>requestForPO(state,po)?.siteId===site.id).length}</dd></div></dl><span>Open project workspace →</span></Link>})}</div></>;
}

export function ProjectDetail({ id }: { id: string }) {
  const { snapshot: state } = useDemo(); if (!state) return null;
  const site = state.sites.find(s=>s.id===id); if (!site) return <MissingRecord name="Project" listHref="/projects"/>;
  const budget = budgetFor(state,id), requests = state.requests.filter(r=>r.siteId===id), pos = state.pos.filter(po=>requestForPO(state,po)?.siteId===id);
  const batches = state.batches.filter(batch=>pos.some(po=>po.id===batch.poId));
  return <><RecordHeader backHref="/projects" backLabel="Projects" eyebrow={`${site.location} · ${site.id.toUpperCase()}`} title={site.name} badges={<Badge>Active project</Badge>}/>
    <div className="metric-strip"><div><small>ALLOCATED</small><strong>{money(budget.allocated)}</strong></div><div><small>COMMITTED</small><strong>{money(budget.committed)}</strong></div><div><small>PAID / SPENT</small><strong>{money(budget.spent)}</strong></div><div><small>AVAILABLE</small><strong>{money(budget.available)}</strong></div></div>
    <div className="content-grid"><section className="panel"><div className="panel-heading"><h2>Material requests</h2><Link href="/requests" className="text-link">Register →</Link></div>{requests.length?requests.map(r=><Link className="data-link" key={r.id} href={`/requests/${r.id}`}><div><strong>{r.ref}</strong><small>{r.items.map(i=>i.name).join(", ")} · Earliest needed {earliestNeededDate(r)?dateText(earliestNeededDate(r)):"—"}</small></div><Badge value={r.status}/></Link>):<Empty detail="No requests for this project."/>}</section><section className="panel"><div className="panel-heading"><h2>Purchase orders</h2><Link href="/purchase-orders" className="text-link">Register →</Link></div>{pos.length?pos.map(po=><Link className="data-link" key={po.id} href={`/purchase-orders/${po.id}`}><div><strong>{po.ref}</strong><small>{supplierName(state,po)} · {money(poTotal(state,po))}</small></div><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></Link>):<Empty detail="No purchase orders for this project."/>}</section></div>
    <div className="content-grid"><section className="panel"><h2 className="panel-title">Deliveries</h2>{batches.length?batches.map(batch=><Link className="data-link" key={batch.id} href={`/deliveries/${batch.id}`}><div><strong>{batch.ref}</strong><small>{dateText(batch.scheduledDate)} · {batch.evidence}</small></div><Badge value={batch.status}/></Link>):<Empty detail="No batches have been scheduled."/>}</section><section className="panel"><h2 className="panel-title">Stock on hand</h2>{inventoryFor(state,id).map(item=><Link className="data-link" key={item.id} href={`/inventory/${id}/${item.id}`}><div><strong>{item.name}</strong><small>{siteName(state,id)}</small></div><strong>{item.onHand} {item.unit}</strong></Link>)}</section></div>
    {site.driveFolderId ? <DriveProjectFiles projectFolderId={site.driveFolderId}/> : <section className="panel"><h2 className="panel-title">Google Drive documents</h2><p className="helper-note">An administrator must map this project&apos;s Drive folder before approved MRFs can be archived.</p></section>}
  </>;
}
