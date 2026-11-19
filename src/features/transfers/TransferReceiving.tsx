'use client';

import { useState } from 'react';
import { Badge, Field } from '@/src/components/ui/Primitives';
import { record as object } from '@/src/domain/projects/projects';
import { QUOTE_CHUNK_SIZE, quoteUuid, validQuoteFile } from '@/src/domain/quotations/drafts';
import { documentDigest } from '@/src/documents/digest';
import { add, compare, decimal } from '@/src/domain/quotations/decimal';
import type { ReceiptCount } from '@/src/domain/deliveries/contracts';
import { quantity } from '@/src/domain/deliveries/contracts';
import type { TransferRecord } from '@/src/domain/transfers/contracts';
import type { TransferFile, TransferFileKind, TransferReceiptCommand } from '@/src/domain/transfers/receipts';
import type { TransferTrip } from '@/src/domain/transfers/trips';

type Command = Omit<TransferReceiptCommand,'requestId'>;
type Draft = { action:'receiveTrip'|'recountTrip'; version:string; arrival:string; reason:string; extraGoods:string; lines:ReceiptCount[] };
const counts = ['accepted','missing','rejected'] as const;
const labels:Record<TransferFileKind,string> = { generated:'Generated receipt', signed:'Signed receipt', supporting:'Supporting evidence' };
const reviewLabels = { pending:'Review pending', needs_evidence:'Replacement requested', approved:'Evidence approved' };
const when = (value:string) => new Date(value).toLocaleString('en-PH',{ timeZone:'Asia/Manila' });
const accept = '.pdf,.jpg,.jpeg,.png,.webp';

async function evidenceCommand(input:object) {
  const response=await fetch('/api/transfer-files',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(input) });
  const result=object(await response.json());
  if (!result||!response.ok) throw Error(typeof result?.error==='string'?result.error:'The evidence action could not be saved.');
  return result;
}

async function upload(receiptId:string, kind:'signed'|'supporting', selected:File, change?:{ replacesId?:string; resumeId?:string }) {
  const file={ name:selected.name,size:selected.size,mime:selected.type,sha256:await documentDigest(selected) };
  if (!validQuoteFile(file)) throw Error('Choose a PDF, JPEG, PNG or WebP up to 20 MiB.');
  const saved=await evidenceCommand({ type:'begin',versionId:receiptId,kind,file,...change });
  if (!quoteUuid(saved.id)||typeof saved.offset!=='number') throw Error('Upload status is unavailable.');
  if (saved.state==='processing') {
    await evidenceCommand({ type:'retry',id:saved.id });
    return;
  }
  let offset=saved.offset;
  let corrections=0;
  while (offset<selected.size) {
    const response=await fetch(`/api/transfer-files/${saved.id}`,{
      method:'PUT',headers:{ 'Upload-Offset':String(offset),'Content-Type':'application/octet-stream' },
      body:selected.slice(offset,offset+QUOTE_CHUNK_SIZE),
    });
    const result=object(await response.json());
    if (!response.ok||typeof result?.offset!=='number'||!Number.isSafeInteger(result.offset)
      ||result.offset<0||result.offset>selected.size||(result.offset<=offset&&++corrections>2)) {
      throw Error(typeof result?.error==='string'?result.error:'The upload was interrupted. Select the same file to resume.');
    }
    offset=result.offset;
  }
}

function EvidenceFile({ file }: { file:TransferFile }) {
  const label=file.name??labels[file.kind];
  return <span>
    {file.id&&file.readable ? <a href={`/api/transfer-files/${file.id}`} target="_blank" rel="noreferrer">{label}</a> : label}
    {' '}<Badge value={file.state} />
  </span>;
}

export function TransferReceiving({ trip,record,busy,send,refresh }: {
  trip:TransferTrip; record:TransferRecord; busy:boolean; send:(command:Command)=>Promise<void>; refresh:()=>void;
}) {
  const [draft,setDraft]=useState<Draft|null>(null);
  const [postVersion,setPostVersion]=useState<string|null>(null);
  const [review,setReview]=useState<{ reason:string; version:string }|null>(null);
  const [kind,setKind]=useState<'signed'|'supporting'>('signed');
  const [fileBusy,setFileBusy]=useState(false);
  const [error,setError]=useState('');
  const receipt=trip.receipt;
  const warehouse=trip.route==='site-warehouse';
  const disabled=busy||fileBusy;
  const base={ transferId:record.id,tripId:trip.id,expectedVersion:record.version,reason:'' };
  const activeFiles=receipt?.files.filter(file=>file.current)??[];
  const history=receipt?.files.filter(file=>!file.current&&(file.readable||receipt.canWriteEvidence&&file.kind==='generated'))??[];
  const canApprove=receipt?.reviewState==='pending'&&activeFiles.some(file=>file.kind==='signed')
    &&activeFiles.some(file=>file.kind==='generated')&&activeFiles.every(file=>file.state==='complete');
  const canCount=draft?.action==='recountTrip'?receipt?.canRecount:trip.canReceive&&!receipt;
  const stale=draft?.version!==record.version;

  function open(action:Draft['action']) {
    setError('');
    setDraft({ action,version:record.version,arrival:new Date(Date.now()+8*3600000).toISOString().slice(0,23),
      reason:'',extraGoods:receipt?.extraGoods??'',lines:receipt?.lines.map(({lineId,accepted,missing,rejected,issue})=>({
        lineId,accepted,missing,rejected,issue,
      }))??trip.lines.map(line=>({ lineId:line.lineId,accepted:line.quantity,missing:'0',rejected:'0',issue:'' })) });
  }

  function save() {
    if (!draft||!canCount||stale) return;
    const lines=draft.lines.map(line=>({ ...line,accepted:line.accepted.trim(),missing:line.missing.trim(),rejected:line.rejected.trim() }));
    if (lines.some((line,index)=>counts.some(field=>!quantity(line[field]))
      ||compare(add(add(decimal(line.accepted),decimal(line.missing)),decimal(line.rejected)),decimal(trip.lines[index].quantity))!==0
      ||((/[1-9]/.test(line.missing)||/[1-9]/.test(line.rejected))&&line.issue.trim().length<5))) {
      setError('Counts must add up to the dispatched quantity. Explain each discrepancy.');
      return;
    }
    const at=Date.parse(`${draft.arrival}+08:00`);
    if (draft.action==='receiveTrip'&&!Number.isFinite(at)) {
      setError('Enter the actual Philippine arrival date and time.');
      return;
    }
    void send({ ...base,type:draft.action,expectedVersion:draft.version,reason:draft.reason,extraGoods:draft.extraGoods,
      receiptLines:lines,arrivalAt:draft.action==='receiveTrip'?new Date(at).toISOString():undefined });
  }

  async function runFiles(action:()=>Promise<unknown>) {
    setFileBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error?cause.message:'The receipt file action could not complete.'); }
    finally { setFileBusy(false); refresh(); }
  }

  if (!receipt&&!trip.canReceive&&!draft) return null;
  return <section aria-label={`Receiving for ${trip.ref}`}>
    {!receipt&&trip.canReceive&&!draft&&<button type="button" className="button primary" disabled={disabled}
      onClick={()=>open('receiveTrip')}>{warehouse?'Confirm warehouse receiving':'Confirm site receiving'}</button>}
    {receipt&&<>
      <h4>Receipt version {receipt.revision}</h4>
      <p>Received {when(receipt.arrivalAt)} (PH) · {receipt.actorName}</p>
      <ul className="transfer-trip-load">{receipt.lines.map(line=>{
        const custody=receipt.custody.find(c=>c.lineId===line.lineId);
        return <li key={line.lineId}><strong>{line.description}</strong>{' '}
          {line.accepted} {line.unit} accepted · {line.missing} missing · {line.rejected} rejected
          {custody&&<> · {custody.available} available to forward</>}
          {line.issue&&<p>{line.issue}</p>}
        </li>;
      })}</ul>
      {receipt.extraGoods&&<p>Extra goods · {receipt.extraGoods}</p>}
      {receipt.postedAt&&<p>Stock posted {when(receipt.postedAt)} (PH)</p>}
      {!warehouse&&!receipt.lines.some(line=>/[1-9]/.test(line.accepted))&&<p>No accepted stock to post.</p>}
      {!draft&&<div className="form-actions">
        {receipt.canRecount&&<button type="button" className="button secondary" disabled={disabled} onClick={()=>{ setPostVersion(null); open('recountTrip'); }}>Recount receipt</button>}
        {receipt.canPost&&!postVersion&&<button type="button" className="button primary" disabled={disabled} onClick={()=>setPostVersion(record.version)}>Post accepted stock</button>}
      </div>}
      {postVersion&&receipt.canPost&&<div className="form-actions">
        <p>{postVersion!==record.version?'The transfer changed. Close this confirmation and review the latest receipt.'
          : `Post the accepted quantities from receipt version ${receipt.revision} to destination inventory?`}</p>
        <button type="button" className="button primary" disabled={disabled||postVersion!==record.version}
          onClick={()=>void send({ ...base,type:'postTrip',expectedVersion:postVersion })}>Confirm stock posting</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={()=>setPostVersion(null)}>Close</button>
      </div>}
      {receipt.priorVersions.length>0&&<details><summary>Previous counts</summary>
        {receipt.priorVersions.map(version=><div key={version.revision}><strong>Receipt version {version.revision}</strong>
          <ul className="transfer-trip-load">{version.lines.map(line=><li key={line.lineId}>
            {line.description} · {line.accepted} {line.unit} accepted · {line.missing} missing · {line.rejected} rejected
            {line.issue&&<p>{line.issue}</p>}
          </li>)}</ul>{version.extraGoods&&<p>Extra goods · {version.extraGoods}</p>}
        </div>)}
      </details>}
      <h4>Receipt evidence</h4>
      <Badge value={reviewLabels[receipt.reviewState]} />
      {receipt.reviewReason&&<p>{receipt.reviewReason}</p>}
      <ul className="transfer-trip-load">{activeFiles.map((file,index)=><li key={file.id??index}>
        <EvidenceFile file={file} />
        {receipt.canWriteEvidence&&file.id&&<div className="form-actions">
          {((file.kind==='generated'&&file.state!=='complete')||(file.uploaded&&['failed','processing'].includes(file.state)))&&
            <button type="button" className="button secondary" disabled={disabled}
              onClick={()=>void runFiles(()=>evidenceCommand({ type:'retry',id:file.id }))}>Retry archive</button>}
          {file.kind!=='generated'&&<>
            <Field label={`Replace ${file.name??labels[file.kind]}`}><input type="file" accept={accept} disabled={disabled}
              onChange={event=>{ const selected=event.target.files?.[0]; event.target.value='';
                if (selected) void runFiles(()=>upload(receipt.id,file.kind as 'signed'|'supporting',selected,{ replacesId:file.id! })); }} /></Field>
            {['uploading','failed'].includes(file.state)&&!file.uploaded&&file.resumable&&
              <Field label={`Resume ${file.name??labels[file.kind]}`}><input type="file" accept={accept} disabled={disabled}
                onChange={event=>{ const selected=event.target.files?.[0]; event.target.value='';
                  if (selected) void runFiles(()=>upload(receipt.id,file.kind as 'signed'|'supporting',selected,{ resumeId:file.id! })); }} /></Field>}
            {['uploading','failed'].includes(file.state)&&<button type="button" className="button secondary" disabled={disabled}
              onClick={()=>void runFiles(()=>evidenceCommand({ type:'withdraw',id:file.id }))}>Withdraw unfinished file</button>}
          </>}
        </div>}
      </li>)}</ul>
      {!activeFiles.some(file=>file.kind==='signed')&&<p>Signed receipt required for Accounting review.</p>}
      {receipt.canWriteEvidence&&<div className="form-grid">
        <Field label="Evidence type"><select disabled={disabled} value={kind}
          onChange={event=>setKind(event.target.value==='signed'?'signed':'supporting')}>
          <option value="signed">Signed receipt</option><option value="supporting">Supporting evidence</option>
        </select></Field>
        <Field label="Choose evidence files"><input type="file" accept={accept} multiple disabled={disabled}
          onChange={event=>{ const files=Array.from(event.target.files??[]); event.target.value='';
            if (files.length) void runFiles(async()=>{ for (const file of files) await upload(receipt.id,kind,file); }); }} /></Field>
        <small>Up to 12 PDF or image files, 20 MiB each and 45 MiB total.</small>
      </div>}
      {history.length>0&&<details><summary>Receipt file history</summary><ul>
        {history.map(file=><li key={file.id}><EvidenceFile file={file} /> · Receipt version {file.revision}
          {receipt.canWriteEvidence&&file.id&&file.kind==='generated'&&file.state!=='complete'&&
            <button type="button" className="button secondary" disabled={disabled}
              onClick={()=>void runFiles(()=>evidenceCommand({ type:'retry',id:file.id }))}>Retry archive</button>}
        </li>)}
      </ul></details>}
      {receipt.canReview&&!review&&<div className="form-actions">
        {canApprove&&<button type="button" className="button primary" disabled={disabled}
          onClick={()=>void send({ ...base,type:'approveTripEvidence',receiptVersionId:receipt.id })}>Approve receipt evidence</button>}
        {receipt.reviewState!=='needs_evidence'&&<button type="button" className="button secondary" disabled={disabled}
          onClick={()=>setReview({ reason:'',version:record.version })}>Request replacement evidence</button>}
      </div>}
      {receipt.canReview&&review&&<form onSubmit={event=>{ event.preventDefault();
        void send({ ...base,type:'requestTripEvidence',expectedVersion:review.version,receiptVersionId:receipt.id,reason:review.reason }); }}>
        <Field label="What needs to be replaced?"><textarea value={review.reason} required minLength={5} maxLength={2000}
          disabled={disabled} onChange={event=>setReview({ ...review,reason:event.target.value })} /></Field>
        <div className="form-actions">
          {review.version!==record.version&&<button type="button" className="button secondary" disabled={disabled}
            onClick={()=>setReview({ ...review,version:record.version })}>Use current version after review</button>}
          <button className="button primary" disabled={disabled||review.version!==record.version}>Save replacement request</button>
          <button type="button" className="button secondary" disabled={disabled} onClick={()=>setReview(null)}>Close</button>
        </div>
      </form>}
    </>}
    {draft&&<form className="stock-transfer-approval-form" onSubmit={event=>{ event.preventDefault(); save(); }}>
      <fieldset disabled={disabled||!canCount}>
        <legend>{draft.action==='recountTrip'?'Recount receipt':'Confirm receipt'}</legend>
        {draft.action==='receiveTrip'&&<Field label="Actual arrival (PH)"><input type="datetime-local" step=".001" required value={draft.arrival}
          onChange={event=>setDraft({ ...draft,arrival:event.target.value })} /></Field>}
        {draft.lines.map((line,index)=>{
          const material=record.lines.find(l=>l.id===line.lineId);
          function change(patch:Partial<ReceiptCount>) {
            if (draft) setDraft({ ...draft,lines:draft.lines.map((entry,position)=>position===index?{ ...entry,...patch }:entry) });
          }
          return <fieldset key={line.lineId}><legend>{material?.stockName} · {trip.lines[index].quantity} {material?.stockUnit} dispatched</legend>
            <div className="form-grid">{counts.map(field=><Field key={field} label={field[0].toUpperCase()+field.slice(1)}>
              <input required inputMode="decimal" maxLength={80} value={line[field]} onChange={event=>change({ [field]:event.target.value })} />
            </Field>)}</div>
            <Field label="Discrepancy explanation"><textarea maxLength={2000} value={line.issue} onChange={event=>change({ issue:event.target.value })} /></Field>
          </fieldset>;
        })}
        <Field label="Extra goods (optional)"><textarea maxLength={2000} value={draft.extraGoods}
          onChange={event=>setDraft({ ...draft,extraGoods:event.target.value })} /></Field>
        {draft.action==='recountTrip'&&<Field label="Recount reason"><textarea required minLength={5} maxLength={2000} value={draft.reason}
          onChange={event=>setDraft({ ...draft,reason:event.target.value })} /></Field>}
      </fieldset>
      <div className="form-actions">
        {stale&&canCount&&<button type="button" className="button secondary" disabled={disabled}
          onClick={()=>setDraft({ ...draft,version:record.version })}>Use current version after review</button>}
        <button className="button primary" disabled={disabled||!canCount||stale}>{draft.action==='recountTrip'?'Save recount':'Save receiving'}</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={()=>{ setDraft(null); setError(''); }}>Close</button>
      </div>
    </form>}
    {fileBusy&&<p role="status">Saving receipt evidence…</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
