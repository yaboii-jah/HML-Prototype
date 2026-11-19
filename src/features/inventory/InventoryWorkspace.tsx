'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFoundationRealtime } from '@/src/app-state/FoundationRealtime';
import { Field, PageHeader, RecordHeader } from '@/src/components/ui/Primitives';
import { Register } from '@/src/components/ui/Register';
import type { InventoryAccount, InventoryView } from '@/src/domain/inventory/contracts';
import { ScopePicker, StockEntryForm, UsageEditor } from './InventoryActions';

const atTime = (value:string) => new Date(value).toLocaleString('en-PH',{ timeZone:'Asia/Manila' });
const materialHref = (item:InventoryAccount) => `/inventory/${item.projectId}/${item.accountId}`;
const projectName = (view:InventoryView,id:string) => view.projects.find(project=>project.id===id)?.name??'Project';
const movementNames:Record<string,string> = {
  usage:'Usage', adjustment:'Adjustment', correction:'Correction', opening:'Opening stock', dispatch:'Transfer out', receipt:'Receipt',
};

function ProjectPicker({ view, project, change }: { view:InventoryView; project:string; change:(project:string)=>void }) {
  return <select aria-label="Inventory project" value={project} onChange={event=>change(event.target.value)}>
    <option value="">All projects</option>{view.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select>;
}

function InventoryRegister({ view, actorId, initialUsage, refresh }: {
  view:InventoryView; actorId:string; initialUsage:boolean; refresh:()=>void;
}) {
  const [usage,setUsage]=useState(initialUsage);
  const [project,setProject]=useState(''),[scope,setScope]=useState(''),[search,setSearch]=useState('');
  const [opening,setOpening]=useState(false);
  const filters=<><ProjectPicker view={view} project={project} change={value=>{setProject(value);setScope('');}} />
    <input aria-label={usage?'Search usage entries':'Search inventory'} placeholder={usage?'Search explanation or person':'Search material or unit'}
      value={search} onChange={event=>setSearch(event.target.value)} /></>;
  const matching=(value:string)=>value.toLowerCase().includes(search.trim().toLowerCase());
  return <>
    <PageHeader title="Site inventory" actions={<>
      {view.role==='Site Personnel'&&view.projects.length>0&&<Link className="button primary"
        href={`/inventory/usage/new${project?`?siteId=${project}`:''}`}>Record usage</Link>}
      {view.role==='Accounting'&&view.projects.length>0&&<button type="button" className="button primary"
        aria-expanded={opening} onClick={()=>setOpening(value=>!value)}>Opening stock</button>}
    </>} />
    {opening&&view.role==='Accounting'&&<StockEntryForm view={view} actorId={actorId} refresh={refresh} />}
    <div className="button-row" aria-label="Inventory view">
      <button type="button" className={`button ${usage?'secondary':'primary'}`} aria-pressed={!usage}
        onClick={()=>{setUsage(false);setSearch('');}}>Stock</button>
      <button type="button" className={`button ${usage?'primary':'secondary'}`} aria-pressed={usage}
        onClick={()=>{setUsage(true);setSearch('');}}>Usage entries</button>
    </div>
    {usage ? <Register rows={view.usage.filter(e=>(!project||e.projectId===project)&&matching(e.reason+' '+e.actorName))}
      unit="usage entries" resetKey={project+search} filters={filters}
      headers={<><th>Recorded (PH)</th><th>Project</th><th>Materials</th><th>Explanation</th><th>Recorded by</th></>}
      empty="No usage entries match this view." renderRow={entry=><tr key={entry.id}>
        <td><Link className="text-link" href={`/inventory/usage/${entry.id}`}>{atTime(entry.at)}</Link></td>
        <td>{projectName(view,entry.projectId)}</td><td>{entry.materialCount}</td><td>{entry.reason}</td><td>{entry.actorName}</td>
      </tr>} />
    : <Register rows={view.accounts.filter(a=>(!project||a.projectId===project)&&(!scope||a.scopeIds.includes(scope))
      &&matching(a.description+' '+a.unit))}
      unit="materials" resetKey={project+scope+search}
      filters={<>{filters}<ScopePicker scopes={view.scopes.filter(s=>!project||s.projectId===project)} value={scope} setValue={setScope} /></>}
      headers={<><th>Material</th><th>Project</th><th>On hand</th><th>Reserved</th><th>Available</th></>}
      empty="No materials match this view. Posted receipts and opening stock appear here." renderRow={item=><tr key={item.accountId}>
        <th scope="row"><Link className="text-link" href={materialHref(item)}>{item.description}</Link><small>{item.unit}</small></th>
        <td>{projectName(view,item.projectId)}</td><td>{item.onHand}</td><td>{item.reserved}</td><td>{item.available}</td>
      </tr>} />}
  </>;
}

function UsagePage({ view, actorId, refresh, initialProject, initialMaterial }: {
  view:InventoryView; actorId:string; refresh:()=>void; initialProject?:string; initialMaterial?:string;
}) {
  const [project,setProject]=useState(view.projects.some(p=>p.id===initialProject)?initialProject!
    : view.projects.length===1?view.projects[0].id:'');
  const allowed=view.projects.some(p=>p.id===project);
  return <>
    <RecordHeader title="Record usage" backHref="/inventory" backLabel="Site inventory" eyebrow={allowed?projectName(view,project):''} badges={null} />
    <section className="panel"><Field label="Project"><select value={allowed?project:''} onChange={event=>setProject(event.target.value)}>
      <option value="">Choose an assigned project</option>{view.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select></Field></section>
    {allowed&&view.role==='Site Personnel'&&<UsageEditor key={project} projectId={project} view={view}
      initialMaterial={view.accounts.some(a=>a.projectId===project&&a.accountId===initialMaterial)?initialMaterial:undefined}
      actorId={actorId} refresh={refresh} />}
  </>;
}

function MaterialPage({ view, actorId, refresh }: { view:InventoryView; actorId:string; refresh:()=>void }) {
  const item=view.accounts[0];
  const [correction,setCorrection]=useState<string|null>(null);
  if (!item) return <p>This inventory record is unavailable.</p>;
  const canCorrect=view.role==='Site Personnel'||view.role==='Accounting';
  const usageLink=`/inventory/usage/new?siteId=${item.projectId}&materialId=${item.accountId}`;
  return <>
    <RecordHeader title={item.description} backHref="/inventory" backLabel="Site inventory" eyebrow={projectName(view,item.projectId)} badges={null} />
    <div className="metric-strip">
      <div><small>On hand</small><strong>{item.onHand} {item.unit}</strong></div>
      <div><small>Reserved</small><strong>{item.reserved} {item.unit}</strong></div>
      <div><small>Available</small><strong>{item.available} {item.unit}</strong></div>
    </div>
    {view.role==='Site Personnel'&&<div className="form-actions"><Link className="button primary" href={usageLink}>Record usage</Link></div>}
    {canCorrect&&<StockEntryForm key={correction??'general'} view={view} account={item} actorId={actorId} refresh={refresh}
      linked={view.movements.find(m=>m.id===correction)} />}
    {canCorrect&&correction&&<button type="button" className="button secondary" onClick={()=>setCorrection(null)}>Clear movement link</button>}
    <section className="panel">
      <h2>Movement history</h2>
      <Register embedded rows={view.movements} unit="movements"
        headers={<><th>Posted (PH)</th><th>Movement</th><th>Quantity</th><th>Reason and source</th><th>Recorded by</th></>}
        empty="No stock movements have been recorded." renderRow={m=><tr key={m.id} id={`movement-${m.id}`}>
          <td>{atTime(m.at)}</td><td>{movementNames[m.kind]??m.kind}</td><td>{m.quantity} {m.unit}</td>
          <td>{m.reason}
            {m.usageId&&<small><Link className="text-link" href={`/inventory/usage/${m.usageId}`}>Open usage entry</Link></small>}
            {m.deliveryId&&<small><Link className="text-link" href={`/deliveries/${m.deliveryId}`}>Open delivery</Link></small>}
            {m.transferId&&<small><Link className="text-link" href={`/stock-transfers/${m.transferId}`}>Open transfer</Link></small>}
            {m.relatedMovementId&&<small>Corrects {movementNames[view.movements.find(related=>related.id===m.relatedMovementId)?.kind??'']?.toLowerCase()??'an earlier'} movement</small>}
            {canCorrect&&<small><button type="button" className="text-link"
              onClick={()=>{setCorrection(m.id); document.querySelector('main')?.scrollIntoView();}}>Link correction</button></small>}
          </td><td>{m.actorName}<small>{m.actorRole}</small></td>
        </tr>} />
    </section>
  </>;
}

function UsageDetail({ view }: { view:InventoryView }) {
  const entry=view.usage[0];
  if (!entry) return <p>This usage entry is unavailable.</p>;
  return <>
    <RecordHeader title="Usage entry" backHref="/inventory?view=usage" backLabel="Usage entries" eyebrow={projectName(view,entry.projectId)} badges={null} />
    <section className="panel">
      <p>Posted {atTime(entry.at)} (PH) by {entry.actorName}</p>
      <p>{entry.reason}</p>
      <Register embedded rows={view.movements} unit="materials" headers={<><th>Material</th><th>Quantity used</th><th>Explanation</th></>}
        empty="No materials found." renderRow={line=><tr key={line.id}>
          <th scope="row"><Link className="text-link" href={`/inventory/${entry.projectId}/${line.accountId}`}>{line.description}</Link></th>
          <td>{line.quantity.replace(/^-/,'')} {line.unit}</td><td>{line.reason}</td>
        </tr>} />
    </section>
  </>;
}

export function InventoryWorkspace({ initial, actorId, initialUsage=false, initialProject, initialMaterial }: {
  initial:InventoryView; actorId:string; initialUsage?:boolean; initialProject?:string; initialMaterial?:string;
}) {
  const { view:live,refresh }=useFoundationRealtime();
  const view=live?.kind==='inventory'&&live.data.mode===initial.mode&&live.data.target===initial.target?live.data:initial;
  if (view.mode==='new') return <UsagePage view={view} actorId={actorId} refresh={refresh} initialProject={initialProject} initialMaterial={initialMaterial} />;
  if (view.mode==='material') return <MaterialPage view={view} actorId={actorId} refresh={refresh} />;
  if (view.mode==='entry') return <UsageDetail view={view} />;
  return <InventoryRegister view={view} actorId={actorId} initialUsage={initialUsage} refresh={refresh} />;
}
