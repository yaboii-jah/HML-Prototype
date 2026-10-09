"use client";

import { useId, useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { AdminActivity } from "./AdminActivity";
import { AdminProjectSettings, ProjectCreation } from "./AdminProjectSettings";
import Link from "next/link";
import { Register, ViewTabs } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { projectScopes } from "@/src/domain/scope-budgets";
import { money } from "@/src/domain/format";

export function Admin() {
  const {snapshot:state}=useDemo();const id=useId(),lastProject=useRef<string|null>(null);
  const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(""),[view,setView]=useState(0),[tabs,setTabs]=useState<Record<string,number>>({}),[message,setMessage]=useState("");
  const {confirm,confirmation}=useConfirmation();if(!state)return null;
  const rows=state.sites.filter(site=>`${site.name} ${site.location}`.toLowerCase().includes(search.trim().toLowerCase()));
  const project=state.sites.find(site=>site.id===selected),tab=selected?tabs[selected]||0:0;
  const select=(key:string)=>{lastProject.current=key;setSelected(key);};
  return <><PageHeader title="Administration" description="Project setup and recorded workspace changes." actions={state.role==="Administrator"&&<><Link href="/admin/maintenance" className="button danger-outline">Clear workspace</Link><button className="button primary" type="button" disabled={creating} onClick={()=>{setView(0);setCreating(true);}}>Add project</button></>}/>
    <ViewTabs id={id} labels={["Projects","Activity"]} active={view} onChange={setView}/>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={view!==0}>
      {creating&&<ProjectCreation confirm={confirm} onCancel={()=>setCreating(false)} onCreated={key=>{setCreating(false);setSearch("");setTabs(current=>({...current,[key]:1}));select(key);setMessage("Project added. Configure its Drive folder and scopes.");}}/>}
      {message&&<p className="admin-feedback success" role="status">{message}</p>}
      <div className="admin-projects"><Register rows={rows} unit="projects" resetKey={search} filters={<input type="search" aria-label="Search projects" placeholder="Search project or location" value={search} onChange={event=>setSearch(event.target.value)}/>} empty={state.sites.length?"No projects match this search.":"No projects yet. Add a project to configure its folder and scopes."} headers={<><th>Project</th><th>Location</th><th className="numeric">Budget</th><th className="numeric">Scopes</th><th>Drive</th><th>Details</th></>} renderRow={site=><tr key={site.id} data-project-row={site.id}><td><strong className="table-primary" title={site.name}>{site.name}</strong></td><td><span className="table-text" title={site.location}>{site.location}</span></td><td className="numeric">{money(site.budget)}</td><td className="numeric">{projectScopes(state,site.id).length}</td><td><span className={`badge ${site.driveFolderId?"good":"warn"}`}>{site.driveFolderId?"Linked":"Missing"}</span></td><td className="register-actions"><button id={`project-details-${site.id}`} type="button" className="button secondary" aria-haspopup="dialog" aria-label={`Details for ${site.name}`} onClick={()=>select(site.id)}>Details</button></td></tr>}/></div>
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={view!==1}><AdminActivity state={state}/></div>
    <RecordModal open={!!project} title={project?.name||"Project settings"} onClose={()=>setSelected(null)} returnFocus={()=>{const trigger=document.getElementById(`project-details-${lastProject.current}`);return trigger?.checkVisibility()?trigger:document.querySelector<HTMLInputElement>('[aria-label="Search projects"]');}} tabs={<ViewTabs id={`${id}-settings`} labels={["Project","Drive folder","Scopes"]} active={tab} onChange={value=>selected&&setTabs(current=>({...current,[selected]:value}))}/>}>
      {state.sites.map(site=><div key={site.id} role="tabpanel" id={site.id===selected?`${id}-settings-panel-${tab}`:undefined} aria-labelledby={site.id===selected?`${id}-settings-tab-${tab}`:undefined} hidden={site.id!==selected}><AdminProjectSettings site={site} active={site.id===selected} tab={tabs[site.id]||0} confirm={confirm}/></div>)}
    </RecordModal>{confirmation}
  </>;
}

export function WorkspaceMaintenance() {
  const { snapshot: state, reset } = useDemo();
  const { confirm, confirmation } = useConfirmation();
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  if (state.role !== "Administrator") return <><PageHeader title="Access unavailable" description="Workspace maintenance requires an Administrator account."/><Link href="/dashboard" className="button secondary">Back to dashboard</Link></>;
  return <>
    <PageHeader eyebrow="ADMINISTRATION" title="Workspace maintenance" description="Manage saved workspace records."/>
    <section className="panel"><h2 className="panel-title">Reset workspace</h2><p>Remove saved projects, workflow records and uploaded files. Archived Google Drive files remain available.</p><button type="button" className="button danger-outline" disabled={busy} onClick={() => void (async () => {
      if (!await confirm("Reset all workspace data?", "All saved projects, requests, quotations, purchase orders, deliveries, payments and uploaded files will be removed.", "Reset workspace", true)) return;
      setBusy(true);
      try { await reset(); } finally { setBusy(false); }
    })()}>{busy ? "Resetting…" : "Reset workspace"}</button></section>
    {confirmation}
  </>;
}
