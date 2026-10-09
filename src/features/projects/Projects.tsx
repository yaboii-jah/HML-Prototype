"use client";
import { Register } from "@/src/components/ui/Register";
import { useId, useState } from "react";

import { RequestMonitoringTable } from "@/src/features/requests/RequestMonitoringTable";

import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, PageHeader, RecordHeader } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { budgetFor, inventoryFor, requestForPO, siteName } from "@/src/domain/selectors";
import { AdminProjectSettings, ProjectCreation } from "@/src/features/admin/AdminProjectSettings";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { ViewTabs } from "@/src/components/ui/Register";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import type { Site } from "@/src/domain/types";
import { ScopeBudgets } from "./ScopeBudgets";
import { DriveProjectFiles } from "./DriveProjectFiles";

export function Projects() {
  const { snapshot: state } = useDemo(); const [search,setSearch]=useState("");
  const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null); const {confirm,confirmation}=useConfirmation(); if (!state) return null;
  const canEdit=["Administrator","Project Manager"].includes(state.role);
  const rows=state.sites.filter(site=>(state.siteFilter==="all"||site.id===state.siteFilter)&&`${site.name} ${site.location}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader title="Projects and sites" description="Project budgets, material requests and purchasing." actions={canEdit&&<button className="button primary" disabled={creating} onClick={()=>setCreating(true)}>Add project</button>}/>
    {creating&&<ProjectCreation confirm={confirm} onCancel={()=>setCreating(false)} onCreated={id=>{setCreating(false);setSelected(id);}}/>}
    <Register rows={rows} resetKey={search+state.siteFilter} filters={<input type="search" aria-label="Search project directory" placeholder="Search project or location" value={search} onChange={event=>setSearch(event.target.value)}/>} unit="projects" empty={state.sites.length?"No projects match this view.":"No projects yet. A Project Manager or Administrator can add a project."} headers={<><th>Project</th><th>Location</th><th className="numeric">Allocated</th><th className="numeric">Available</th><th className="numeric">MRFs</th><th className="numeric">POs</th>{canEdit&&<th>Settings</th>}</>} renderRow={site=>{const budget=budgetFor(state,site.id);return <tr key={site.id}><td><Link className="table-primary" href={`/projects/${site.id}`} title={site.name}>{site.name}</Link></td><td><span className="table-text" title={site.location}>{site.location}</span></td><td className="numeric">{money(budget.allocated)}</td><td className="numeric">{money(budget.available)}</td><td className="numeric">{state.requests.filter(request=>request.siteId===site.id).length}</td><td className="numeric">{state.pos.filter(po=>requestForPO(state,po)?.siteId===site.id).length}</td>{canEdit&&<td><button className="button secondary" onClick={()=>setSelected(site.id)}>Project settings</button></td>}</tr>;}}/>
    {canEdit&&<ProjectSettingsModal site={state.sites.find(site=>site.id===selected)} onClose={()=>setSelected(null)}/>}
    {confirmation}
  </>;
}

export function ProjectDetail({ id }: { id: string }) {
  const [settings,setSettings]=useState(false);
  const { snapshot: state } = useDemo(); if (!state) return null;
  const site = state.sites.find(s=>s.id===id); if (!site) return <MissingRecord name="Project" listHref="/projects"/>;
  const budget = budgetFor(state,id), canEdit=["Administrator","Project Manager"].includes(state.role);
  return <><RecordHeader backHref="/projects" backLabel="Projects" eyebrow={`${site.location} · ${site.id.toUpperCase()}`} title={site.name} badges={<Badge>Active project</Badge>}/>
    <div className="metric-strip"><div><small>ALLOCATED</small><strong>{money(budget.allocated)}</strong></div><div><small>COMMITTED</small><strong>{money(budget.committed)}</strong></div><div><small>PAID / SPENT</small><strong>{money(budget.spent)}</strong></div><div><small>AVAILABLE</small><strong>{money(budget.available)}</strong></div></div>
    {canEdit&&<div className="form-actions"><button className="button secondary" onClick={()=>setSettings(true)}>Project settings</button></div>}
    <section className="panel"><ScopeBudgets siteId={id} editable={canEdit}/></section>
    <RequestMonitoringTable state={state} siteId={id}/>
    <section className="panel"><h2 className="panel-title">Stock on hand</h2>{inventoryFor(state,id).map(item=><Link className="data-link" key={item.id} href={`/inventory/${id}/${item.id}`}><div><strong>{item.name}</strong><small>{siteName(state,id)}</small></div><strong>{item.onHand} {item.unit}</strong></Link>)}{!inventoryFor(state,id).length && <Empty detail="Site stock appears after receiving and posting."/>}</section>
    {site.driveFolderId ? <DriveProjectFiles projectFolderId={site.driveFolderId}/> : <section className="panel"><h2 className="panel-title">Google Drive documents</h2><p className="helper-note">A Project Manager or Administrator must map this project&apos;s Drive folder before approved MRFs can be archived.</p></section>}
    {canEdit&&<ProjectSettingsModal site={settings?site:undefined} onClose={()=>setSettings(false)}/>}
  </>;
}

function ProjectSettingsModal({site,onClose}:{site?:Site;onClose:()=>void}) {
  const id=useId(),[tab,setTab]=useState(0);const {confirm,confirmation}=useConfirmation();
  return <><RecordModal open={!!site} title={site?.name||"Project settings"} onClose={onClose} tabs={<ViewTabs id={id} labels={["Project","Drive folder","Scopes"]} active={tab} onChange={setTab}/>}>
    {site&&<AdminProjectSettings key={site.id} site={site} active tab={tab} confirm={confirm}/>}
  </RecordModal>{confirmation}</>;
}
