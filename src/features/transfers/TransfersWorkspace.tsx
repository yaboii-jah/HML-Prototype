'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Field, PageHeader } from '@/src/components/ui/Primitives';
import { useFoundationRealtime } from '@/src/app-state/FoundationRealtime';
import { transferCommandAction } from '@/app/(workspace)/stock-transfers/actions';
import type { TransferCommand, TransferRecord, TransferSelection, TransferSourcing, TransferStatus, TransferView } from '@/src/domain/transfers/contracts';
import { rankStockCandidates } from '@/src/domain/stock-matching';
import { compare, decimal } from '@/src/domain/quotations/decimal';

type Command = TransferCommand extends infer C ? C extends TransferCommand ? Omit<C,'requestId'> : never : never;
type Action = Exclude<TransferCommand['type'],'submit'>;
type Send = (command:Command)=>Promise<void>;

const labels:Record<TransferStatus,string> = {
  review_pending:'Awaiting destination review', suitable:'Suitable · awaiting release request',
  converted:'Release requested', release_pending:'Awaiting source approval',
  approved:'Approved · stock reserved', rejected:'Rejected', cancelled:'Cancelled',
};
const actions:Record<string,string> = {
  submit:'Submitted', confirmSuitability:'Suitability confirmed', requestRelease:'Release requested',
  approveRelease:'Source release approved', reject:'Rejected', cancel:'Cancelled',
};
const when = (value:string) => new Date(value).toLocaleString('en-PH',{ timeZone:'Asia/Manila' });
const blankLine = ():TransferSelection => ({ itemId:'',stockId:'',quantity:'',match:'alternative',verified:false,explanation:'' });

function SourcingForm({ sourcing, busy, send }: { sourcing:TransferSourcing; busy:boolean; send:Send }) {
  const [source,setSource] = useState('');
  const [draft,setDraft] = useState<{ key:number; line:TransferSelection }[]>([]);
  const [note,setNote] = useState('');
  const [expected,setExpected] = useState(sourcing.demandVersion);
  const nextLine=useRef(0);
  const sources = [...new Map(sourcing.candidates.map(c => [c.projectId,c.project])).entries()];
  const stock = sourcing.candidates.filter(c => c.projectId===source);
  const changed = expected!==sourcing.demandVersion;
  function change(key:number,patch:Partial<TransferSelection>) {
    setDraft(fields => fields.map(field => field.key===key ? { ...field,line:{ ...field.line,...patch } } : field));
  }
  if (!sourcing.ready) return <p role="status">Sourcing is paused until the approved material request archive is ready.</p>;
  return <form className="stock-transfer-approval-form" onSubmit={event => {
    event.preventDefault();
    if (changed) return;
    void send({ type:'submit',mrfId:sourcing.requestId,sourceId:source,expectedDemand:expected,reason:note,selections:draft.map(field=>field.line) });
  }}>
    <Field label="Source project">
      <select required value={source} disabled={busy||draft.length>0} onChange={event=>setSource(event.target.value)}>
        <option value="">Select a source project</option>
        {sources.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select>
    </Field>
    {sources.length===0 && <p>Other projects have no available stock in the requested units.</p>}
    {draft.map(({key,line},position) => {
      const item=sourcing.items.find(i=>i.id===line.itemId);
      const candidates=item ? rankStockCandidates(item,stock) : [];
      const selected=candidates.find(candidate=>candidate.id===line.stockId);
      return <fieldset key={key} disabled={busy}>
        <legend>Material {position+1}</legend>
        <div className="form-grid">
          <Field label="Requested material">
            <select required value={line.itemId} onChange={event=>change(key,{ ...blankLine(),itemId:event.target.value })}>
              <option value="">Select a material</option>
              {sourcing.items.map(i=><option key={i.id} value={i.id}>{i.name} · {i.unassigned} {i.unit} unassigned</option>)}
            </select>
          </Field>
          <Field label="Available source stock">
            <select required disabled={!item} value={selected?.id??''} onChange={event=>{
              const candidate=candidates.find(c=>c.id===event.target.value);
              change(key,{ stockId:event.target.value,match:candidate?.exact?'direct':'alternative',verified:false,explanation:'' });
            }}>
              <option value="">Select source stock</option>
              {candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.available} {c.unit} available</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input required inputMode="decimal" maxLength={80} value={line.quantity}
            onChange={event=>change(key,{ quantity:event.target.value })} /></Field>
        </div>
        {item && candidates.length===0 && <p>No available stock at this project uses the requested unit.</p>}
        {selected?.exact && <Field label="Matching decision">
          <select value={line.match} onChange={event=>change(key,{ match:event.target.value==='direct'?'direct':'alternative',verified:false })}>
            <option value="direct">Verify the exact match</option>
            <option value="alternative">Ask destination staff to confirm suitability</option>
          </select>
        </Field>}
        {selected && line.match==='direct' && <label>
          <input required type="checkbox" checked={line.verified} onChange={event=>change(key,{ verified:event.target.checked })} />
          {' '}I verified the source material meets the request.
        </label>}
        {selected && line.match==='alternative' && <Field label="Why this stock may meet the same specifications">
          <textarea required minLength={5} maxLength={2000} value={line.explanation}
            onChange={event=>change(key,{ explanation:event.target.value })} />
        </Field>}
        <div><button type="button" className="button secondary" onClick={()=>setDraft(fields=>fields.filter(field=>field.key!==key))}>Remove material {position+1}</button></div>
      </fieldset>;
    })}
    {draft.length>0 && <Field label="Procurement note (optional)"><textarea disabled={busy} maxLength={2000} value={note} onChange={event=>setNote(event.target.value)} /></Field>}
    {changed && <p role="status">Demand changed. Review the available quantities and confirm the current version before sending.</p>}
    <div className="form-actions">
      {changed && <button type="button" className="button secondary" disabled={busy} onClick={()=>setExpected(sourcing.demandVersion)}>Use current version after review</button>}
      <button type="button" className="button secondary" disabled={busy||!source||draft.length>=100}
        onClick={()=>{ const key=nextLine.current++; setDraft(fields=>[...fields,{key,line:blankLine()}]); }}>Add material</button>
      <button className="button primary" disabled={busy||changed||draft.length===0}>Send stock requests</button>
    </div>
  </form>;
}

function RecordList({ records }: { records:TransferRecord[] }) {
  if (!records.length) return <p>No transfers or suitability reviews are available for this view.</p>;
  return <div className="table-scroll"><table className="data-table">
    <thead><tr><th>Record</th><th>Source</th><th>Destination</th><th>Status</th></tr></thead>
    <tbody>{records.map(record=><tr key={record.id}>
      <td><Link href={`/stock-transfers/${record.id}`}>{record.ref??'Suitability review'}</Link><small>{record.requestRef}</small></td>
      <td>{record.source}</td><td>{record.destination}</td><td><Badge value={labels[record.status]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

function TransferDetail({ record,busy,send }: { record:TransferRecord; busy:boolean; send:Send }) {
  const [review,setReview] = useState<{ type:Action; version:string; demand:string|null }|null>(null);
  const [reason,setReason] = useState('');
  const [quantities,setQuantities] = useState<Record<string,string>>({});
  const [confirmed,setConfirmed] = useState(false);
  const line=record.lines[0];
  const stale=!!review&&(review.version!==record.version || (review.type==='requestRelease' && review.demand!==record.demandVersion));
  const reducing=review?.type==='approveRelease'&&record.lines.some(entry=>{
    try { return compare(decimal(quantities[entry.id]),decimal(entry.proposed))<0; } catch { return false; }
  });
  function open(type:Action) {
    setReview({ type,version:record.version,demand:record.demandVersion });
    setQuantities(Object.fromEntries(record.lines.map(l=>[l.id,type==='requestRelease'?l.approved:l.proposed])));
    setConfirmed(false);
    setReason('');
  }
  return <>
    <section className="panel">
      <h2>Material quantities</h2>
      <p>{record.source} → {record.destination} · {record.requestId ? <Link href={`/requests/${record.requestId}`}>{record.requestRef}</Link> : record.requestRef}</p>
      <p><Badge value={labels[record.status]} /></p>
      {!record.ready && <p role="status">Approval is paused until the current MRF archive is ready.</p>}
      {record.note && <p>{record.note}</p>}
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Requested material</th><th>Source stock</th><th>Proposed</th><th>Approved</th></tr></thead>
        <tbody>{record.lines.map(l=><tr key={l.id}>
          <td>{l.requestedName}<small>{l.requestedUnit}</small></td>
          <td>{l.stockName}{l.explanation&&<small>{l.explanation}</small>}</td>
          <td>{l.proposed} {l.stockUnit}</td><td>{l.approved} {l.stockUnit}</td>
        </tr>)}</tbody>
      </table></div>
      {record.canReview && record.status==='release_pending' && !record.canApprove &&
        <p>Another assigned source reviewer must approve this release.</p>}
      {!review && <div className="form-actions">
        {record.canReview && record.status==='review_pending' && <button className="button primary" disabled={busy||!record.ready} onClick={()=>open('confirmSuitability')}>Confirm suitability</button>}
        {record.canReview && record.status==='release_pending' && record.canApprove &&
          <button className="button primary" disabled={busy||!record.ready} onClick={()=>open('approveRelease')}>Approve release</button>}
        {record.canReview && <button className="button secondary" disabled={busy} onClick={()=>open('reject')}>Reject request</button>}
        {record.canRequestRelease && <button className="button primary" disabled={busy||!record.ready} onClick={()=>open('requestRelease')}>Request source release</button>}
        {record.canCancel && <button className="button secondary" disabled={busy} onClick={()=>open('cancel')}>Cancel allocation</button>}
      </div>}
      {review && <form className="stock-transfer-approval-form" onSubmit={event=>{
        event.preventDefault();
        if (stale) return;
        const base={ transferId:record.id,expectedVersion:review.version,reason };
        void send({ ...base,type:review.type,
          ...(review.type==='approveRelease'?{ quantities }:{}),
          ...(review.type==='confirmSuitability'?{ quantity:quantities[line.id],specificationsConfirmed:confirmed }:{}),
          ...(review.type==='requestRelease'?{ quantity:quantities[line.id],expectedDemand:review.demand??undefined }:{}) });
      }}>
        <fieldset disabled={busy}>
          <legend>{actions[review.type]}</legend>
          {['approveRelease','confirmSuitability','requestRelease'].includes(review.type) && record.lines.map(l=>
            <Field key={l.id} label={`Quantity for ${l.requestedName} (${l.stockUnit})`}>
              <input required maxLength={80} inputMode="decimal" value={quantities[l.id]??''}
                onChange={event=>setQuantities(values=>({ ...values,[l.id]:event.target.value }))} />
            </Field>)}
          {review.type==='confirmSuitability' && <label><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} />
            {' '}The proposed stock meets the same specifications.</label>}
          <Field label={review.type==='confirmSuitability'?'Written specification confirmation':'Reason'}>
            <textarea required={reducing||['confirmSuitability','reject','cancel'].includes(review.type)} minLength={5} maxLength={2000}
              value={reason} onChange={event=>setReason(event.target.value)} />
          </Field>
        </fieldset>
        {stale && <button type="button" className="button secondary" disabled={busy}
          onClick={()=>setReview({ ...review,version:record.version,demand:record.demandVersion })}>Use current version after review</button>}
        <div className="form-actions">
          <button className="button primary" disabled={busy||stale||(!record.ready && !['reject','cancel'].includes(review.type))}>Save decision</button>
          <button type="button" className="button secondary" disabled={busy} onClick={()=>setReview(null)}>Close</button>
        </div>
      </form>}
    </section>
    <section className="panel">
      <h2>History</h2>
      <ol>{record.history.map(event=><li key={event.id}>
        <strong>{actions[event.action]??event.action}</strong> · {event.actorName} ({event.actorRole}) · {when(event.at)}
        {event.reason && <p>{event.reason}</p>}
        <details><summary>Saved quantities</summary><ul>{event.snapshot.lines.map(l=><li key={l.id}>
          {l.requestedName}: {l.proposed} proposed, {l.approved} approved {l.stockUnit}
        </li>)}</ul></details>
      </li>)}</ol>
    </section>
  </>;
}

export function TransfersWorkspace({ initial,recordId,sourcingPage=false }: { initial:TransferView; recordId?:string; sourcingPage?:boolean }) {
  const live=useFoundationRealtime();
  const view=live.view?.kind==='transfers'?live.view.data:initial;
  const selected=view.records.find(r=>r.id===recordId);
  const [busy,setBusy]=useState(false), [uncertain,setUncertain]=useState(false), [message,setMessage]=useState('');
  const [formVersion,setFormVersion]=useState(0);
  const pending=useRef<TransferCommand|null>(null), running=useRef(false);
  async function perform(input?:Command) {
    if (running.current || (input&&pending.current)) return;
    if (input) pending.current=structuredClone({ ...input,requestId:crypto.randomUUID() } as TransferCommand);
    if (!pending.current) return;
    running.current=true;
    setBusy(true);
    try {
      const result=await transferCommandAction(pending.current);
      setMessage(result.message);
      setUncertain(!!result.uncertain);
      if (!result.uncertain) pending.current=null;
      if (result.ok) setFormVersion(version=>version+1);
    } catch {
      setUncertain(true);
      setMessage('The response was interrupted. Use Check saved outcome before another action.');
    } finally {
      running.current=false;
      setBusy(false);
      live.refresh();
    }
  }
  return <div className="stock-transfer-detail">
    <PageHeader title={sourcingPage?'Source project stock':selected?.ref??(recordId?'Suitability review':'Stock transfers')}
      description={sourcingPage?view.sourcing?.requestRef:undefined}
      actions={(recordId||sourcingPage)?<Link className="button secondary" href="/stock-transfers">All transfers</Link>:undefined} />
    {message&&<p role="status" className="notice">{message}</p>}
    {uncertain&&<div><button type="button" className="button primary" disabled={busy} onClick={()=>void perform()}>Check saved outcome</button></div>}
    {sourcingPage&&view.sourcing&&<section className="panel">
      <Link className="back-link" href={`/requests/${view.sourcing.requestId}/purchasing`}>Back to purchasing</Link>
      <SourcingForm key={formVersion} sourcing={view.sourcing} busy={busy||uncertain} send={perform} />
    </section>}
    {selected&&<TransferDetail key={formVersion} record={selected} busy={busy||uncertain} send={perform} />}
    {recordId&&!selected&&<p>This transfer is unavailable for your current access.</p>}
    {!recordId&&<section className="panel"><h2>{sourcingPage?'Stock requests for this MRF':'Transfer register'}</h2>
      <RecordList records={view.records} /></section>}
  </div>;
}
