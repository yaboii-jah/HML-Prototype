'use client';

import { useState } from 'react';
import { Badge, Field } from '@/src/components/ui/Primitives';
import { record } from '@/src/domain/projects/projects';
import { QUOTE_CHUNK_SIZE, quoteUuid, validQuoteFile } from '@/src/domain/quotations/drafts';
import { documentDigest } from '@/src/documents/digest';
import type { DeliveriesView, Delivery, DeliveryCommand, DeliveryOrder, ReceiptCount } from '@/src/domain/deliveries/contracts';

type ReceiptAction = Omit<DeliveryCommand,'requestId' | 'deliveryId' | 'poId'>;
type Draft = { type:'receive' | 'recount'; version:string; arrival:string; reason:string; extraGoods:string; lines:ReceiptCount[] };

const philippineTime = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone:'Asia/Manila' });
const philippineInputTime = () => new Date(Date.now()+8*3600000).toISOString().slice(0,23);
const positive = (quantity: string) => /[1-9]/.test(quantity);

async function fileAction(input: object) {
  const response = await fetch('/api/delivery-files', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(input) });
  const result = record(await response.json());
  if (!response.ok || !result) throw Error(typeof result?.error === 'string' ? result.error : 'Receipt evidence could not be saved.');
  return result;
}

async function uploadSignedEvidence(versionId: string, selected: File) {
  const details = { name:selected.name, mime:selected.type, size:selected.size, sha256:await documentDigest(selected) };
  if (!validQuoteFile(details)) throw Error('Choose a PDF, JPEG, PNG or WebP up to 20 MiB.');
  const upload = await fileAction({ type:'begin', versionId, file:details });
  if (!quoteUuid(upload.id) || typeof upload.offset !== 'number') throw Error('Upload status is unavailable.');
  if (upload.state === 'processing') {
    await fileAction({ type:'retry', versionId, kind:'signed' });
    return;
  }
  let offset = upload.offset;
  let corrections = 0;
  while (offset < selected.size) {
    const response = await fetch(`/api/delivery-files/${upload.id}`, {
      method:'PUT', headers:{ 'Upload-Offset':String(offset), 'Content-Type':'application/octet-stream' },
      body:selected.slice(offset,offset+QUOTE_CHUNK_SIZE),
    });
    const result = record(await response.json());
    if (!response.ok || typeof result?.offset !== 'number' || !Number.isSafeInteger(result.offset)
      || result.offset<0 || result.offset>selected.size) {
      throw Error(typeof result?.error === 'string' ? result.error : 'The upload was interrupted. Select the same file to resume.');
    }
    if (result.offset <= offset && ++corrections > 2) throw Error('The upload was interrupted. Select the same file to resume.');
    offset = result.offset;
  }
}

export function DeliveryReceiving({ delivery, order, role, disabled, conflict, clearConflict, perform, refresh }: {
  delivery:Delivery; order:DeliveryOrder; role:DeliveriesView['role']; disabled:boolean; conflict:boolean;
  clearConflict:() => void; perform:(action:ReceiptAction) => Promise<boolean>; refresh:() => void;
}) {
  const [draft,setDraft] = useState<Draft | null>(null);
  const [replacementReason,setReplacementReason] = useState<string | null>(null);
  const [fileMessage,setFileMessage] = useState('');
  const [fileBusy,setFileBusy] = useState(false);
  const receipt = delivery.receipt;
  const warehouse = delivery.plan.route === 'warehouse';
  const receiver = role === (warehouse ? 'Procurement' : 'Site Personnel');
  const accounting = role === 'Accounting';
  const canPost = !warehouse && receipt?.lines.some(line => positive(line.stockQuantity));

  function openDraft() {
    setDraft({
      type:receipt ? 'recount' : 'receive', version:delivery.version, arrival:philippineInputTime(), reason:'',
      extraGoods:receipt?.extraGoods ?? '',
      lines:delivery.plan.lines.map(line => receipt?.lines.find(saved => saved.lineId===line.lineId)
        ?? { lineId:line.lineId, accepted:line.quantity, missing:'0', rejected:'0', issue:'' }),
    });
  }
  async function runFile(action: () => Promise<unknown>, success: string) {
    setFileBusy(true);
    setFileMessage('');
    try {
      await action();
      setFileMessage(success);
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : 'Receipt evidence is unavailable.');
    } finally {
      setFileBusy(false);
      refresh();
    }
  }
  if (delivery.state !== 'dispatched') return null;

  return <section className="panel">
    <h2>{warehouse ? 'Warehouse receipt' : 'Site receipt'}</h2>
    {!receipt && !draft && <p>Waiting for receipt confirmation.</p>}
    {receiver && !draft && (!receipt || receipt.canRecount) && <button type="button" className="button secondary" disabled={disabled} onClick={openDraft}>
      {receipt ? 'Record a recount' : 'Confirm receipt'}
    </button>}
    {draft && (draft.type==='receive' ? !receipt : receipt?.canRecount) && <form className="delivery-form" onSubmit={async event => {
      event.preventDefault();
      if (await perform({
        type:draft.type, expectedVersion:draft.version, reason:draft.reason, extraGoods:draft.extraGoods,
        receiptLines:draft.lines, ...(draft.type==='receive' ? { arrivalAt:new Date(`${draft.arrival}+08:00`).toISOString() } : {}),
      })) setDraft(null);
    }}>
      <fieldset disabled={disabled}><legend>Count the dispatched load</legend>
        {draft.type==='receive' && <Field label="Actual arrival (Philippine time)"><input type="datetime-local" step="0.001" required value={draft.arrival} onChange={event => setDraft({ ...draft, arrival:event.target.value })} /></Field>}
        {draft.lines.map((line,index) => {
          const material = order.lines.find(value => value.id===line.lineId);
          const expected = delivery.plan.lines.find(value => value.lineId===line.lineId)?.quantity;
          function change(patch: Partial<ReceiptCount>) {
            if (draft) setDraft({ ...draft, lines:draft.lines.map((entry,i) => i===index ? { ...entry, ...patch } : entry) });
          }
          return <fieldset key={line.lineId}><legend>{material?.description} · {expected} {material?.unit} dispatched</legend>
            <div className="form-grid">
              <Field label="Accepted"><input inputMode="decimal" required maxLength={80} value={line.accepted} onChange={event => change({ accepted:event.target.value })} /></Field>
              <Field label="Missing"><input inputMode="decimal" required maxLength={80} value={line.missing} onChange={event => change({ missing:event.target.value })} /></Field>
              <Field label="Rejected"><input inputMode="decimal" required maxLength={80} value={line.rejected} onChange={event => change({ rejected:event.target.value })} /></Field>
            </div>
            <Field label="Discrepancy explanation"><textarea required={positive(line.missing)||positive(line.rejected)} maxLength={2000} value={line.issue} onChange={event => change({ issue:event.target.value })} /></Field>
          </fieldset>;
        })}
        <Field label="Extra goods (optional)"><textarea maxLength={2000} value={draft.extraGoods} onChange={event => setDraft({ ...draft, extraGoods:event.target.value })} /></Field>
        {draft.type==='recount' && <Field label="Reason for recount"><textarea required minLength={5} maxLength={2000} value={draft.reason} onChange={event => setDraft({ ...draft, reason:event.target.value })} /></Field>}
      </fieldset>
      {conflict && <button type="button" className="button secondary" disabled={disabled} onClick={() => {
        setDraft({ ...draft, version:delivery.version }); clearConflict();
      }}>Use current version after review</button>}
      <div className="form-actions"><button className="button primary" disabled={disabled||conflict}>Save {draft.type==='receive' ? 'receipt' : 'recount'}</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => setDraft(null)}>Close</button></div>
    </form>}
    {receipt && <>
      <p>Arrived {philippineTime(receipt.arrivalAt)} · Version {receipt.revision}</p>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Material</th><th>Accepted</th><th>Missing</th><th>Rejected</th><th>{warehouse ? 'Available to forward' : 'Inventory quantity'}</th></tr></thead>
        <tbody>{receipt.lines.map(line => <tr key={line.lineId}>
          <td>{line.description}{line.issue && <small>{line.issue}</small>}</td><td>{line.accepted} {line.unit}</td>
          <td>{line.missing} {line.unit}</td><td>{line.rejected} {line.unit}</td>
          <td>{warehouse ? `${delivery.warehouseRemaining[line.lineId] ?? '0'} ${line.unit}` : `${line.stockQuantity} ${line.stockUnit}`}</td>
        </tr>)}</tbody></table></div>
      {receipt.extraGoods && <p>Extra goods for follow-up: {receipt.extraGoods}</p>}
      {!delivery.parentDeliveryId && receipt.lines.some(line => positive(line.missing)||positive(line.rejected)) && <p>Procurement follow-up required for the supplier discrepancy.</p>}
      {!warehouse && (receipt.postedAt ? <p>Stock posted {philippineTime(receipt.postedAt)}.</p>
        : canPost ? receiver && <button type="button" className="button primary" disabled={disabled||!!draft}
          onClick={() => void perform({ type:'post', expectedVersion:delivery.version, reason:'' })}>Post accepted stock</button>
          : <p>No stock to post.</p>)}
      <h3>Receipt documents</h3>
      <p>Accounting review <Badge value={receipt.reviewState==='needs_evidence' ? 'Needs replacement evidence' : receipt.reviewState} /></p>
      {receipt.reviewReason && <p>{receipt.reviewReason}</p>}
      <p>Generated receipt <Badge value={receipt.generated.state} /> {receipt.generated.id && receipt.generated.state==='complete' && <a href={`/api/delivery-files/${receipt.generated.id}`}>Open generated receipt</a>}</p>
      <p>Signed evidence <Badge value={receipt.signed?.state ?? 'Missing'} /> {receipt.signed?.id && <a href={`/api/delivery-files/${receipt.signed.id}`}>Open signed evidence</a>}</p>
      {receipt.signedUploadState && <p>Signed upload <Badge value={receipt.signedUploadState} /></p>}
      {(receiver||accounting) && <div className="form-actions">
        <Field label="Upload signed evidence"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={disabled||fileBusy} onChange={event => {
          const selected = event.target.files?.[0];
          event.target.value='';
          if (selected) void runFile(() => uploadSignedEvidence(receipt.id,selected),'Upload saved. Drive verification continues in the background.');
        }} /></Field>
        {receipt.generated.state!=='complete' && <button type="button" className="button secondary" disabled={disabled||fileBusy}
          onClick={() => void runFile(() => fileAction({ type:'retry', versionId:receipt.id, kind:'generated' }),'Generated receipt archive queued.')}>Retry generated archive</button>}
        {(receipt.signedUploadState==='processing'||receipt.signedUploadState==='failed') && <button type="button" className="button secondary" disabled={disabled||fileBusy}
          onClick={() => void runFile(() => fileAction({ type:'retry', versionId:receipt.id, kind:'signed' }),'Signed evidence verification requested. Reselect the original if the upload needs to restart.')}>Retry signed archive</button>}
      </div>}
      {fileMessage && <p role="status">{fileMessage}</p>}
      {!!receipt.historicalFiles.length && <details><summary>Previous receipt documents</summary><ul>
        {receipt.historicalFiles.map(file => <li key={file.id}><a href={`/api/delivery-files/${file.id}`}>{file.name}</a> · Receipt version {file.revision}</li>)}
      </ul></details>}
      {accounting && <div className="form-actions">
        {receipt.reviewState==='pending' && receipt.signed?.state==='complete' && receipt.generated.state==='complete' &&
          <button type="button" className="button primary" disabled={disabled}
            onClick={() => void perform({ type:'approveEvidence', expectedVersion:delivery.version, reason:'', receiptVersionId:receipt.id })}>Approve receipt evidence</button>}
        {replacementReason===null && receipt.reviewState!=='needs_evidence' &&
          <button type="button" className="button secondary" disabled={disabled} onClick={() => setReplacementReason('')}>Request replacement evidence</button>}
      </div>}
      {accounting && replacementReason!==null && <form onSubmit={async event => {
        event.preventDefault();
        if (await perform({ type:'requestEvidence', expectedVersion:delivery.version, reason:replacementReason, receiptVersionId:receipt.id })) setReplacementReason(null);
      }}>
        <Field label="What should the receiver replace?"><textarea required minLength={5} maxLength={2000} disabled={disabled} value={replacementReason} onChange={event => setReplacementReason(event.target.value)} /></Field>
        <button className="button primary" disabled={disabled}>Send evidence request</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => setReplacementReason(null)}>Cancel</button>
      </form>}
    </>}
  </section>;
}
