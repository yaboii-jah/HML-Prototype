"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { AdminUsers } from "./AdminUsers";
import { AdminActivity } from "./AdminActivity";
import { AdminProjectSettings, ProjectCreation } from "./AdminProjectSettings";
import Link from "next/link";
import { Register, ViewTabs } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { projectScopes } from "@/src/domain/scope-budgets";
import { money } from "@/src/domain/format";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useToasts } from "@/src/app-state/ToastProvider";

export function Admin() {
  const {snapshot:state,directory,reset}=useDemo();const id=useId(),lastProject=useRef<string|null>(null);
  const {jobs,isRunning,dismiss}=useArchive();
  const {notify,toasts}=useToasts();
  const working=toasts.some(toast=>toast.tone==="progress"),pendingWork=useRef(false);
  useEffect(()=>{pendingWork.current=working;},[working]);
  const [clearing,setClearing]=useState(false),clearPending=useRef(false);
  const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(""),[view,setView]=useState(0),[tabs,setTabs]=useState<Record<string,number>>({});
  const {confirm,confirmation}=useConfirmation();if(!state)return null;
  if(state.role!=="Administrator")return <><PageHeader title="Access unavailable" description="User administration requires an Administrator account."/><Link href="/projects" className="button secondary">Open projects</Link></>;
  const rows=state.sites.filter(site=>`${site.name} ${site.location}`.toLowerCase().includes(search.trim().toLowerCase()));
  const project=state.sites.find(site=>site.id===selected),tab=selected?tabs[selected]||0:0;
  const select=(key:string)=>{lastProject.current=key;setSelected(key);};
  const clearWorkspace=async()=>{
    if(clearPending.current||isRunning()||pendingWork.current)return;
    clearPending.current=true;setClearing(true);
    try{
      if(!await confirm("Clear all workspace data?","This permanently removes all projects, suppliers, transactions, inventory, drafts, browser documents and old workspace backups from this browser. User accounts, passwords and account-management history are kept. Project assignments are removed. Files already archived in Google Drive are not deleted. This cannot be undone.","Clear workspace",true))return;
      if(isRunning()||pendingWork.current){notify({tone:"warning",title:"Wait for running operations to finish before clearing the workspace."});return;}
      if(await reset()){setCreating(false);setSelected(null);setSearch("");setView(0);setTabs({});lastProject.current=null;jobs.forEach(job=>dismiss(job.id));}
    }finally{clearPending.current=false;setClearing(false);}
  };
  const archiving=jobs.some(job=>!job.error&&job.phase!=="complete"),blocked=archiving||working;
  return <><PageHeader title="Administration" description="Projects, user access and recorded workspace changes." actions={<><button className="button danger-outline" type="button" disabled={clearing||blocked} title={blocked?"Wait for running operations to finish":undefined} onClick={()=>void clearWorkspace()}>{clearing?"Clearing workspace…":"Clear workspace"}</button><button className="button primary" type="button" disabled={creating||clearing} onClick={()=>{setView(0);setCreating(true);}}>Add project</button></>}/>
    <ViewTabs id={id} labels={["Projects","Activity","Users"]} active={view} onChange={setView}/>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={view!==0}>
      {creating&&<ProjectCreation confirm={confirm} onCancel={()=>setCreating(false)} onCreated={key=>{setCreating(false);setSearch("");setTabs(current=>({...current,[key]:1}));select(key);}}/>}
      <div className="admin-projects"><Register rows={rows} unit="projects" resetKey={search} filters={<input type="search" aria-label="Search projects" placeholder="Search project or location" value={search} onChange={event=>setSearch(event.target.value)}/>} empty={state.sites.length?"No projects match this search.":"No projects yet. Add a project to configure its folder and scopes."} headers={<><th>Project</th><th>Location</th><th className="numeric">Budget</th><th className="numeric">Scopes</th><th>Drive</th><th>Details</th></>} renderRow={site=><tr key={site.id} data-project-row={site.id}><td><strong className="table-primary" title={site.name}>{site.name}</strong></td><td><span className="table-text" title={site.location}>{site.location}</span></td><td className="numeric">{money(site.budget)}</td><td className="numeric">{projectScopes(state,site.id).length}</td><td><span className={`badge ${site.localArchiveId||site.driveFolderId?"good":"warn"}`}>{site.localArchiveId?"Local archive ready":site.driveFolderId?"Folder ready":"Setup pending"}</span></td><td className="register-actions"><button id={`project-details-${site.id}`} type="button" className="button secondary" aria-haspopup="dialog" aria-label={`Details for ${site.name}`} onClick={()=>select(site.id)}>Details</button></td></tr>}/></div>
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={view!==1}><AdminActivity state={{...state,activity:[...state.activity,...directory.activity].sort((a,b)=>b.at.localeCompare(a.at))}}/></div>
    <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={view!==2}><AdminUsers/></div>
    <RecordModal open={!!project} title={project?.name||"Project settings"} onClose={()=>setSelected(null)} returnFocus={()=>{const trigger=document.getElementById(`project-details-${lastProject.current}`);return trigger?.checkVisibility()?trigger:document.querySelector<HTMLInputElement>('[aria-label="Search projects"]');}} tabs={<ViewTabs id={`${id}-settings`} labels={["Project","Documents","Scopes"]} active={tab} onChange={value=>selected&&setTabs(current=>({...current,[selected]:value}))}/>}>
      {state.sites.map(site=><div key={site.id} role="tabpanel" id={site.id===selected?`${id}-settings-panel-${tab}`:undefined} aria-labelledby={site.id===selected?`${id}-settings-tab-${tab}`:undefined} hidden={site.id!==selected}><AdminProjectSettings site={site} active={site.id===selected} tab={tabs[site.id]||0} confirm={confirm}/></div>)}
    </RecordModal>{confirmation}
  </>;
}
