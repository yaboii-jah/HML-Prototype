'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/src/components/ui/Primitives';
import { Register } from '@/src/components/ui/Register';
import { compare, decimal, subtract } from '@/src/domain/quotations/decimal';
import { positiveQuantity, type InventoryAccount, type InventoryCommand, type InventoryView, type StockMovement } from '@/src/domain/inventory/contracts';
import { quantity as validQuantity } from '@/src/domain/deliveries/contracts';
import { id } from '@/src/domain/purchasing/contracts';
import { exactQuantity } from '@/src/domain/purchasing/pricing';
import { inventoryStorageKey, useInventorySubmission } from './inventory-submission';

type Draft = { reason:string; lines:{ accountId:string; quantity:string; note:string }[] };
function parseDraft(raw:string|null):Draft|null {
  if (!raw) return null;
  const draft=JSON.parse(raw);
  if (!draft||typeof draft.reason!=='string'||!Array.isArray(draft.lines)||draft.lines.length>100
    ||!draft.lines.every((line:Draft['lines'][number])=>line&&id(line.accountId)&&typeof line.quantity==='string'&&typeof line.note==='string')
    ||new Set(draft.lines.map((line:Draft['lines'][number])=>line.accountId)).size!==draft.lines.length) return null;
  return draft;
}

const over = (amount:string,available:string) => compare(decimal(amount),decimal(available,available.length))>0;
const remaining = (amount:string,used:string) =>
  exactQuantity(subtract(decimal(amount,amount.length),decimal(used)),amount.length+used.length+2);

function SubmissionStatus({ state }: { state:ReturnType<typeof useInventorySubmission> }) {
  return <>
    {state.message&&<p role="status">{state.message}</p>}
    {state.pending&&<div className="form-actions"><button type="button" className="button primary" disabled={state.busy}
      onClick={()=>void state.submit()}>{state.busy?'Checking…':'Check saved outcome'}</button></div>}
  </>;
}

export function ScopePicker({ scopes, value, setValue }: {
  scopes:InventoryView['scopes']; value:string; setValue:(scope:string)=>void;
}) {
  return <select aria-label="Materials received for scope" value={value} onChange={event=>setValue(event.target.value)}>
    <option value="">All receipt scopes</option>{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.name}</option>)}
  </select>;
}

export function UsageEditor({ view, projectId, initialMaterial, actorId, refresh }: {
  view:InventoryView; projectId:string; initialMaterial?:string; actorId:string; refresh:()=>void;
}) {
  const router=useRouter();
  const key=inventoryStorageKey(actorId,`usage/${projectId}`);
  const accounts=view.accounts.filter(account=>account.projectId===projectId);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [search,setSearch]=useState(accounts.find(account=>account.accountId===initialMaterial)?.description??'');
  const [scope,setScope]=useState('');
  const [problem,setProblem]=useState('');
  const [review,setReview]=useState<Extract<InventoryCommand,{kind:'usage'}>|null>(null);
  const submission=useInventorySubmission(key+'/submitted',command=>command.kind==='usage'&&command.projectId===projectId,
    saved=>{ try { localStorage.removeItem(key); } catch {} router.push(`/inventory/usage/${saved}`); },refresh);
  useEffect(()=>{
    const timer=setTimeout(()=>{
      let restored:Draft|null=null;
      try { restored=parseDraft(localStorage.getItem(key)); }
      catch { setProblem('The local draft could not be restored.'); }
      const next=restored??{ reason:'',lines:[] };
      if (initialMaterial&&!next.lines.some(row=>row.accountId===initialMaterial)) {
        next.lines.push({ accountId:initialMaterial,quantity:'',note:'' });
      }
      setDraft(next);
    },0);
    return ()=>clearTimeout(timer);
  },[key,initialMaterial]);
  const locked=!draft||!submission.ready||!!submission.pending||submission.busy;
  function save(next:Draft) {
    setReview(null);
    setDraft(next);
    setProblem('');
    try { localStorage.setItem(key,JSON.stringify(next)); }
    catch { setProblem('Browser storage is unavailable. Keep this page open to preserve your draft.'); }
  }
  function startReview(event:FormEvent) {
    event.preventDefault();
    if (!draft||locked) return;
    if (draft.reason.trim().length<5) { setProblem('Explain the usage in at least five characters.'); return; }
    const lines=[];
    for (const row of draft.lines) {
      const amount=row.quantity.trim();
      if (amount===''||validQuantity(amount)&&!positiveQuantity(amount)) continue;
      const item=accounts.find(account=>account.accountId===row.accountId);
      if (!item||!positiveQuantity(amount)||over(amount,item.available)||row.note.trim()&&row.note.trim().length<5) {
        setProblem(item?`Check the quantity and explanation for ${item.description}. Available stock is ${item.available} ${item.unit}.`:'Remove the unavailable material from the draft.');
        return;
      }
      lines.push({ accountId:row.accountId,expectedVersion:item.version,quantity:amount,note:row.note });
    }
    if (lines.length===0||lines.length>100) { setProblem('Enter quantities for 1 to 100 materials.'); return; }
    setProblem('');
    setReview({ kind:'usage',operationId:crypto.randomUUID(),projectId,reason:draft.reason,lines });
  }
  const rows=accounts.filter(account=>(account.description+' '+account.unit).toLowerCase().includes(search.trim().toLowerCase())
    &&(!scope||account.scopeIds.includes(scope)));
  const changed=review?.lines.some(row=>accounts.find(account=>account.accountId===row.accountId)?.version!==row.expectedVersion);
  if (!draft) return <p role="status">Opening your draft…</p>;
  return <section className="panel">
    <form className="stock-transfer-approval-form" onSubmit={startReview}>
      <fieldset disabled={locked}>
        <Field label="Usage explanation"><textarea required minLength={5} maxLength={2000} value={draft.reason}
          onChange={event=>save({ ...draft,reason:event.target.value })} /></Field>
        <Register embedded rows={rows} unit="materials" resetKey={search+scope}
          filters={<><input aria-label="Search usage materials" placeholder="Search material or unit" value={search}
            onChange={event=>setSearch(event.target.value)} /><ScopePicker scopes={view.scopes.filter(s=>s.projectId===projectId)} value={scope} setValue={setScope} /></>}
          headers={<><th>Material</th><th>Available</th><th>Quantity used</th><th>Material explanation</th></>}
          empty="No materials match this view." renderRow={account=>{
            const line=draft.lines.find(row=>row.accountId===account.accountId);
            function update(patch:Partial<Draft['lines'][number]>) {
              const item={ accountId:account.accountId,quantity:'',note:'',...line,...patch };
              save({ ...draft!,lines:line?draft!.lines.map(row=>row.accountId===item.accountId?item:row):[...draft!.lines,item] });
            }
            return <tr key={account.accountId}><th scope="row">{account.description}<small>{account.unit}</small></th>
              <td>{account.available} {account.unit}<small>{account.onHand} on hand · {account.reserved} reserved</small></td>
              <td><input aria-label={`Quantity used for ${account.description} (${account.unit})`} inputMode="decimal"
                maxLength={80} value={line?.quantity??''} onChange={event=>update({ quantity:event.target.value })} /></td>
              <td><textarea aria-label={`Usage explanation for ${account.description} (${account.unit})`} placeholder="Optional"
                maxLength={2000} value={line?.note??''} onChange={event=>update({ note:event.target.value })} /></td></tr>;
          }} />
        {draft.lines.filter(row=>!accounts.some(a=>a.accountId===row.accountId)).map(row=><p key={row.accountId}>
          A draft material is unavailable. <button type="button" className="text-link" onClick={()=>save({
            ...draft,lines:draft.lines.filter(line=>line.accountId!==row.accountId),
          })}>Remove unavailable row</button></p>)}
        <p>{draft.lines.filter(row=>positiveQuantity(row.quantity.trim())).length} materials entered. Drafts reserve no stock.</p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={()=>save({ reason:'',lines:[] })}>Clear draft</button>
          <button className="button primary">Review usage</button>
        </div>
      </fieldset>
    </form>
    {problem&&<p role="alert">{problem}</p>}
    {review&&!submission.pending&&<section>
      <h2>Confirm material usage</h2>
      <p>{review.reason}</p>
      <ul>{review.lines.map(line=>{
        const account=accounts.find(row=>row.accountId===line.accountId);
        return account&&<li key={line.accountId}>{account.description} · {line.quantity} {account.unit} used
          {!changed&&<> · {remaining(account.onHand,line.quantity)} {account.unit} on hand · {remaining(account.available,line.quantity)} {account.unit} available after posting</>}
          {line.note&&<p>{line.note}</p>}</li>;
      })}</ul>
      {changed&&<p role="status">Stock changed. Select Review usage again to see current balances.</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={()=>setReview(null)}>Keep editing</button>
        <button type="button" className="button primary" disabled={locked||changed}
          onClick={()=>{ void submission.submit(review); setReview(null); }}>Record usage</button>
      </div>
    </section>}
    <SubmissionStatus state={submission} />
  </section>;
}

export function StockEntryForm({ view, actorId, account, linked, refresh }: {
  view:InventoryView; actorId:string; account?:InventoryAccount; linked?:StockMovement; refresh:()=>void;
}) {
  const [project,setProject]=useState(view.projects.length===1?view.projects[0].id:'');
  const [description,setDescription]=useState(''),[unit,setUnit]=useState('');
  const [amount,setAmount]=useState(''),[reason,setReason]=useState('');
  const [direction,setDirection]=useState<'add'|'remove'>('add');
  const [problem,setProblem]=useState('');
  const [review,setReview]=useState<InventoryCommand|null>(null);
  const submission=useInventorySubmission(inventoryStorageKey(actorId,account?`correction/${account.accountId}`:'opening'),
    command=>account ? command.kind==='correction'&&command.projectId===account.projectId&&command.lines[0].accountId===account.accountId
      : command.kind==='opening'&&view.role==='Accounting'&&view.projects.some(p=>p.id===command.projectId),
    ()=>{ setAmount(''); setReason(''); setDescription(''); setUnit(''); },refresh);
  const locked=!submission.ready||!!submission.pending||submission.busy;
  function prepare(event:FormEvent) {
    event.preventDefault();
    if (locked) return;
    if (!positiveQuantity(amount.trim())||reason.trim().length<5||(!account&&(!project||!description.trim()||!unit.trim()))) {
      setProblem('Enter a positive stock quantity and explain the action in at least five characters.');
      return;
    }
    if (account&&direction==='remove'&&over(amount.trim(),account.available)) {
      setProblem('The deduction exceeds available stock. Review the amount or ask Procurement about releasing unused transfer reservations.');
      return;
    }
    const base={ operationId:crypto.randomUUID(),projectId:account?.projectId??project,reason };
    setProblem('');
    setReview(account ? { ...base,kind:'correction',direction,relatedMovementId:linked?.id,
      lines:[{ accountId:account.accountId,expectedVersion:account.version,quantity:amount.trim() }] }
      : { ...base,kind:'opening',lines:[{ accountId:crypto.randomUUID(),description,unit,quantity:amount.trim() }] });
  }
  const stale=review?.kind==='correction'&&review.lines[0].expectedVersion!==account?.version;
  return <section className="panel">
    <h2>{account?'Stock correction':'Opening stock'}</h2>
    {linked&&<p>Linked to the {linked.kind} movement of {linked.quantity} {linked.unit}.</p>}
    {!account&&<p>Use opening stock for a material and unit with no inventory record in this project.</p>}
    <form className="stock-transfer-approval-form" onSubmit={prepare} onChange={()=>{setReview(null);setProblem('');}}>
      <fieldset disabled={locked}>
        <div className="form-grid">
          {account ? <Field label="Direction"><select value={direction} onChange={event=>setDirection(event.target.value==='remove'?'remove':'add')}>
            <option value="add">Add stock</option><option value="remove">Remove stock</option></select></Field> : <>
            <Field label="Project"><select required value={project} onChange={event=>setProject(event.target.value)}>
              <option value="">Choose project</option>{view.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Material description"><input required maxLength={4000} value={description} onChange={event=>setDescription(event.target.value)} /></Field>
            <Field label="Unit"><input required maxLength={4000} value={unit} onChange={event=>setUnit(event.target.value)} /></Field>
          </>}
          <Field label={account?`Quantity (${account.unit})`:'Opening quantity'}><input required inputMode="decimal" maxLength={80}
            value={amount} onChange={event=>setAmount(event.target.value)} /></Field>
        </div>
        <Field label="Reason"><textarea required minLength={5} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} /></Field>
        <div className="form-actions"><button className="button secondary">Review {account?'correction':'opening stock'}</button></div>
      </fieldset>
    </form>
    {problem&&<p role="alert">{problem}</p>}
    {review&&!submission.pending&&<div className="form-actions">
      <p>{stale?'Stock changed. Review the current balance and submit the review again.'
        : `${account&&direction==='remove'?'Remove':'Add'} ${review.lines[0].quantity} ${account?.unit??unit} of ${account?.description??description}.`}</p>
      <button type="button" className="button primary" disabled={locked||stale}
        onClick={()=>{void submission.submit(review);setReview(null);}}>Confirm {account?'correction':'opening stock'}</button>
    </div>}
    <SubmissionStatus state={submission} />
  </section>;
}
