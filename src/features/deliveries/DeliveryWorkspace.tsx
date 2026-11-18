'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFoundationRealtime } from '@/src/app-state/FoundationRealtime';
import { Field, PageHeader, Badge } from '@/src/components/ui/Primitives';
import { deliveryCommandAction } from '@/app/(workspace)/deliveries/actions';
import { COMPANY_WAREHOUSE } from '@/src/domain/company';
import { philippineToday } from '@/src/domain/payments/payments';
import { requestedQuantity, type DeliveriesView, type DeliveryCommand, type DeliveryPlan, type Departure, type DeliveryOrder } from '@/src/domain/deliveries/contracts';
import './deliveries.css';

const when = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone:'Asia/Manila' });
const localNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0,23);
const blankDeparture = (): Departure => ({ at:'', carrier:'', driver:'', vehicle:'', reference:'', note:'' });
function defaultPlan(order: DeliveryOrder): DeliveryPlan {
  return { route:'site', plannedDate:philippineToday(), plannedTime:'', pickup:order.pickup, destination:order.destination, address:order.address, note:'', lines:[] };
}
function equivalent(q: string, factor: string) {
  try { return requestedQuantity(q, factor); } catch { return 'Enter an exact quantity'; }
}
type Editor = { id:string; poId:string; version:string; plan:DeliveryPlan };
type Decision = { type:'dispatch' | 'cancel' | 'correct'; version:string; reason:string; departure:Departure; localTime:string; reviewed:boolean };

export function DeliveryWorkspace({ initial, deliveryId, create = false }: { initial:DeliveriesView; deliveryId?:string; create?:boolean }) {
  const live = useFoundationRealtime(), router = useRouter();
  const view = live.view?.kind === 'deliveries' ? live.view.data : initial;
  const saved = view.deliveries.find(d => d.id === deliveryId);
  const order = view.orders.find(o => o.id === saved?.poId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [selectedPo, setSelectedPo] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const pending = useRef<DeliveryCommand | null>(null), running = useRef(false);
  const editingOrder = view.orders.find(o => o.id === editor?.poId);
  const logistics = view.role === 'Logistics';
  async function perform(command?: Omit<DeliveryCommand,'requestId'>) {
    if (running.current || command && pending.current) return;
    if (command) pending.current = structuredClone({ ...command, requestId:crypto.randomUUID() });
    if (!pending.current) return;
    running.current = true; setBusy(true); setMessage(''); setConflict(false);
    try {
      const result = await deliveryCommandAction(structuredClone(pending.current));
      setMessage(result.message); setUncertain(!!result.uncertain); setConflict(!!result.conflict);
      if (!result.uncertain) pending.current = null;
      if (result.ok) {
        setEditor(null); setDecision(null); live.refresh();
        if (create && result.targetId) router.push(`/deliveries/${result.targetId}`);
      } else live.refresh();
    } catch { setUncertain(true); setMessage('The response was interrupted. Check saved outcome before another action.'); }
    finally { running.current = false; setBusy(false); }
  }
  function changePlan(patch: Partial<DeliveryPlan>) { if (editor) setEditor({ ...editor, plan:{ ...editor.plan, ...patch } }); }
  function openDecision(type: Decision['type']) {
    if (!saved) return;
    const departure = saved.departure ?? blankDeparture();
    setDecision({ type, version:saved.version, reason:'', departure, reviewed:false,
      localTime:departure.at ? new Date(Date.parse(departure.at) + 8 * 3600000).toISOString().slice(0,23) : localNow() });
  }
  const disabled = busy || uncertain;
  return <div className="delivery-workspace">
    <PageHeader title={create ? 'Schedule a delivery' : saved?.ref ?? 'Deliveries'} description="Supplier delivery plans and departures. Dates and times use Philippine time." actions={<Link className="button secondary" href={deliveryId || create ? '/deliveries' : '/deliveries/new'}>{deliveryId || create ? 'All deliveries' : 'Schedule delivery'}</Link>} />
    {message && <p role="status" className="notice">{message}</p>}
    {uncertain && <button className="button primary" disabled={busy} onClick={() => void perform()}>Check saved outcome</button>}
    {conflict && <p>Compare your preserved entries with the current record before reviewing and submitting again.</p>}
    {create && logistics && !editor && <section className="panel">
      <h2>Select an issued purchase order</h2>
      <Field label="Purchase order"><select value={selectedPo} onChange={e => setSelectedPo(e.target.value)}><option value="">Select a PO</option>{view.orders.map(o => <option key={o.id} value={o.id}>{o.ref} · {o.project} · {o.vendor}</option>)}</select></Field>
      {!view.orders.length && <p>No issued POs are available for scheduling.</p>}
      <button className="button primary" disabled={!selectedPo || disabled} onClick={() => { const o = view.orders.find(o => o.id === selectedPo); if (o) setEditor({ id:crypto.randomUUID(), poId:o.id, version:o.version, plan:defaultPlan(o) }); }}>Plan delivery</button>
    </section>}
    {create && !logistics && <p>Logistics schedules and changes deliveries. You can follow saved plans in the delivery register.</p>}
    {!create && !deliveryId && <section className="panel">
      <h2>Delivery register</h2>
      {!view.deliveries.length ? <p>No deliveries have been scheduled yet.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Delivery</th><th>Project / PO</th><th>Destination</th><th>Planned</th><th>Status</th></tr></thead><tbody>{view.deliveries.map(d => {
        const o = view.orders.find(o => o.id === d.poId);
        return <tr key={d.id}><td><Link href={`/deliveries/${d.id}`}>{d.ref}</Link></td><td>{o?.project}<small>{o?.ref}</small></td><td>{d.plan.destination}<small>{d.plan.route === 'site' ? 'Supplier to site' : 'Supplier to warehouse'}</small></td><td>{d.plan.plannedDate} {d.plan.plannedTime}{d.state === 'scheduled' && d.plan.plannedDate < philippineToday() && <Badge value="Overdue" />}</td><td><Badge value={d.state} />{d.state === 'scheduled' && !o?.cleared && <span>Awaiting Accounting clearance</span>}</td></tr>;
      })}</tbody></table></div>}
    </section>}
    {deliveryId && !saved && <p>This delivery is unavailable or your project access changed.</p>}
    {saved && order && <>
      <section className="panel"><h2>{order.project} · {order.ref}</h2><p>{order.vendor} · <Badge value={saved.state} /></p>
        <dl className="delivery-facts"><div><dt>Pickup</dt><dd>{saved.plan.pickup}</dd></div><div><dt>Destination</dt><dd>{saved.plan.destination}<br />{saved.plan.address}</dd></div><div><dt>Planned</dt><dd>{saved.plan.plannedDate} {saved.plan.plannedTime}</dd></div></dl>
        {saved.plan.note && <p>{saved.plan.note}</p>}
        {saved.state === 'scheduled' && <p role="status">{order.cleared ? 'Accounting clearance is currently effective. Dispatch will check it again.' : 'Awaiting Accounting clearance. The saved load remains reserved.'}</p>}
        <ul>{saved.plan.lines.map(l => { const source = order.lines.find(x => x.id === l.lineId); return <li key={l.lineId}>{source?.description}: {l.quantity} {source?.unit} {source && `(${equivalent(l.quantity,source.factor)} ${source.requestedUnit})`}</li>; })}</ul>
        {saved.departure && <div><h3>Recorded departure</h3><p>{when(saved.departure.at)}</p><p>{[saved.departure.carrier,saved.departure.driver,saved.departure.vehicle,saved.departure.reference,saved.departure.note].filter(Boolean).join(' · ')}</p></div>}
        {logistics && !editor && !decision && <div className="form-actions">
          {saved.state === 'scheduled' && <><button className="button secondary" disabled={disabled} onClick={() => setEditor({ id:saved.id, poId:saved.poId, version:saved.version, plan:structuredClone(saved.plan) })}>Revise schedule</button><button className="button secondary" disabled={disabled} onClick={() => openDecision('cancel')}>Cancel delivery</button><button className="button primary" disabled={disabled || !order.cleared} onClick={() => openDecision('dispatch')}>Record dispatch</button></>}
          {saved.state === 'dispatched' && <button className="button secondary" disabled={disabled} onClick={() => openDecision('correct')}>Correct departure details</button>}
        </div>}
        <p>Receiving and warehouse forwarding are pending.</p>
      </section>
      <section className="panel"><h2>Retained history</h2><ol>{saved.history.map((e,i) => <li key={i}><strong>{e.action}</strong> · {e.actorName} · {when(e.at)}{e.reason && <p>{e.reason}</p>}<details><summary>Saved details</summary><p>{e.snapshot.plan.plannedDate} {e.snapshot.plan.plannedTime} · {e.snapshot.plan.pickup} → {e.snapshot.plan.destination}, {e.snapshot.plan.address}</p><p>{e.snapshot.plan.note}</p><ul>{e.snapshot.plan.lines.map(l => <li key={l.lineId}>{order.lines.find(x => x.id === l.lineId)?.description}: {l.quantity}</li>)}</ul>{e.snapshot.departure && <p>{when(e.snapshot.departure.at)} · {[e.snapshot.departure.carrier,e.snapshot.departure.driver,e.snapshot.departure.vehicle,e.snapshot.departure.reference,e.snapshot.departure.note].filter(Boolean).join(' · ')}</p>}</details></li>)}</ol></section>
    </>}
    {editor && editingOrder && <form className="panel delivery-form" onSubmit={e => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get('reason') ?? ''); void perform({ type:create ? 'schedule' : 'revise', deliveryId:editor.id, poId:editor.poId, expectedVersion:editor.version, reason, plan:editor.plan }); }}>
      <h2>{create ? 'Plan the load' : 'Revise the saved load'}</h2><p>{editingOrder.ref} · {editingOrder.project}. Site destinations must remain within this project.</p>
      <fieldset disabled={disabled}><legend>Schedule and locations</legend><div className="form-grid">
        <Field label="Route"><select value={editor.plan.route} onChange={e => { const warehouse = e.target.value === 'warehouse'; changePlan({ route:warehouse ? 'warehouse' : 'site', destination:warehouse ? COMPANY_WAREHOUSE.name : editingOrder.destination, address:warehouse ? COMPANY_WAREHOUSE.address : editingOrder.address }); }}><option value="site">Supplier to site</option><option value="warehouse">Supplier to warehouse</option></select></Field>
        <Field label="Planned date"><input type="date" required min={philippineToday()} value={editor.plan.plannedDate} onChange={e => changePlan({ plannedDate:e.target.value })} /></Field>
        <Field label="Planned time (optional)"><input type="time" value={editor.plan.plannedTime} onChange={e => changePlan({ plannedTime:e.target.value })} /></Field>
        <Field label="Pickup address"><textarea required maxLength={2000} value={editor.plan.pickup} onChange={e => changePlan({ pickup:e.target.value })} /></Field>
        <Field label="Destination name"><input required maxLength={2000} value={editor.plan.destination} onChange={e => changePlan({ destination:e.target.value })} /></Field>
        <Field label="Destination address"><textarea required maxLength={2000} value={editor.plan.address} onChange={e => changePlan({ address:e.target.value })} /></Field>
      </div></fieldset>
      <fieldset disabled={disabled}><legend>Load quantities in PO units</legend><p>Leave a line empty to exclude it. Saving reserves these quantities.</p>{editingOrder.lines.map(l => <Field key={l.id} label={`${l.description} (${l.unit})`} hint={`Ordered ${l.quantity}; currently allocated ${l.allocated}. MRF equivalent: ${equivalent(editor.plan.lines.find(x => x.lineId === l.id)?.quantity || '0',l.factor)} ${l.requestedUnit}`}><input inputMode="decimal" value={editor.plan.lines.find(x => x.lineId === l.id)?.quantity ?? ''} onChange={e => changePlan({ lines:[...editor.plan.lines.filter(x => x.lineId !== l.id), ...(e.target.value ? [{ lineId:l.id, quantity:e.target.value }] : [])] })} /></Field>)}</fieldset>
      <Field label="Notes (optional)"><textarea disabled={disabled} maxLength={2000} value={editor.plan.note} onChange={e => changePlan({ note:e.target.value })} /></Field>
      {!create && <Field label="Reason for revision"><textarea name="reason" required minLength={5} maxLength={2000} disabled={disabled} /></Field>}
      {conflict && <button type="button" className="button secondary" disabled={disabled} onClick={() => { setEditor({ ...editor, version:editingOrder.version }); setConflict(false); }}>Use current version after review</button>}
      <div className="form-actions"><button className="button primary" disabled={disabled || conflict}>Save schedule</button><button type="button" className="button secondary" disabled={disabled} onClick={() => setEditor(null)}>Close editor</button></div>
    </form>}
    {decision && saved && <form className="panel delivery-form" onSubmit={e => { e.preventDefault(); void perform({ type:decision.type, deliveryId:saved.id, poId:saved.poId, expectedVersion:decision.version, reason:decision.reason, ...(decision.type !== 'cancel' ? { departure:{ ...decision.departure, at:new Date(`${decision.localTime}+08:00`).toISOString() } } : {}) }); }}>
      <h2>{decision.type === 'cancel' ? 'Cancel this delivery' : decision.type === 'correct' ? 'Correct departure details' : 'Confirm the saved load departed'}</h2>
      <p>{decision.type === 'cancel' ? 'Cancellation retains history and releases this load’s reservation.' : 'Confirm the exact saved quantities and destination above. Revise a short load before dispatch. Invalid departures require external escalation.'}</p>
      <fieldset disabled={disabled}><legend>{decision.type === 'cancel' ? 'Cancellation reason' : 'Departure details'}</legend>
        {decision.type !== 'cancel' && <><Field label="Actual departure (Philippine time)"><input type="datetime-local" step="0.001" required value={decision.localTime} onChange={e => setDecision({ ...decision, localTime:e.target.value })} /></Field>{(['carrier','driver','vehicle','reference','note'] as const).map(key => <Field key={key} label={`${key.charAt(0).toUpperCase() + key.slice(1)} (optional)`}><input maxLength={2000} value={decision.departure[key]} onChange={e => setDecision({ ...decision, departure:{ ...decision.departure, [key]:e.target.value } })} /></Field>)}</>}
        {decision.type !== 'dispatch' && <Field label="Reason"><textarea required minLength={5} maxLength={2000} value={decision.reason} onChange={e => setDecision({ ...decision, reason:e.target.value })} /></Field>}
        <label><input type="checkbox" required checked={decision.reviewed} onChange={e => setDecision({ ...decision, reviewed:e.target.checked })} /> I reviewed this load and the action details.</label>
      </fieldset>
      {conflict && <button type="button" className="button secondary" disabled={disabled} onClick={() => { setDecision({ ...decision, version:saved.version, reviewed:false }); setConflict(false); }}>Use current version after review</button>}
      <div className="form-actions"><button className="button primary" disabled={disabled || conflict || !decision.reviewed}>Confirm {decision.type}</button><button type="button" className="button secondary" disabled={disabled} onClick={() => setDecision(null)}>Close</button></div>
    </form>}
  </div>;
}
