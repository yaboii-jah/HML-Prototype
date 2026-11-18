'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Field } from '@/src/components/ui/Primitives';
import { quantity, type Departure } from '@/src/domain/deliveries/contracts';
import { philippineToday } from '@/src/domain/payments/payments';
import { compare, decimal, add } from '@/src/domain/quotations/decimal';
import { exactQuantity } from '@/src/domain/purchasing/pricing';
import type { TransferRecord } from '@/src/domain/transfers/contracts';
import type { TransferRoute, TransferTrip, TransferTripCommand, TripPlan, TripState } from '@/src/domain/transfers/trips';

type TripAction = TransferTripCommand['type'];
type Editor = { type:TripAction; version:string; tripId:string; plan:TripPlan; quantities:Record<string,string>;
  departure:Departure; reason:string; confirmed:boolean };

const routes:Record<TransferRoute,string> = { 'site-site':'Site to site', 'site-warehouse':'Site to warehouse' };
const states:Record<TripState,string> = { scheduled:'Scheduled',dispatched:'Departed',cancelled:'Cancelled' };
const labels:Record<TripAction,string> = {
  scheduleTrip:'Schedule trip', reviseTrip:'Revise trip', cancelTrip:'Cancel trip',
  dispatchTrip:'Record departure', correctTrip:'Correct departure', cancelRemaining:'Cancel undispatched balance',
};
const historyLabels:Record<string,string> = {
  scheduleTrip:'Trip scheduled', reviseTrip:'Schedule revised', cancelTrip:'Trip cancelled',
  dispatchTrip:'Departure recorded', correctTrip:'Departure corrected', cancelRemaining:'Trip cancelled with allocation balance',
};
const transport = { carrier:'Carrier',driver:'Driver',vehicle:'Vehicle',reference:'Waybill reference',note:'Transport notes' } as const;
const timeZone='Asia/Manila';
const when=(value:string)=>new Date(value).toLocaleString('en-PH',{ timeZone });
const manilaTime=(value:string)=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,23);
const positive=(value:string)=>compare(decimal(value))>0;

function TripFacts({ trip, record }: { trip:Omit<TransferTrip,'history'>; record:TransferRecord }) {
  return <>
    <dl className="transfer-trip-facts">
      <div><dt>Pickup</dt><dd>{trip.pickupName}<br />{trip.pickupAddress}</dd></div>
      <div><dt>Drop-off</dt><dd>{trip.destinationName}<br />{trip.destinationAddress}</dd></div>
      <div><dt>Scheduled</dt><dd><time dateTime={trip.plannedDate}>{trip.plannedDate}</time> {trip.plannedTime} (PH)</dd></div>
      {trip.departure && <div><dt>Departed</dt><dd>{when(trip.departure.at)} (PH)</dd></div>}
      {trip.departure && (Object.keys(transport) as (keyof typeof transport)[]).map(key=>trip.departure?.[key]&&
        <div key={key}><dt>{transport[key]}</dt><dd>{trip.departure[key]}</dd></div>)}
      {trip.directions && <div><dt>Directions</dt><dd>{trip.directions}</dd></div>}
    </dl>
    <ul className="transfer-trip-load">{trip.lines.map(line=>{
      const material=record.lines.find(entry=>entry.id===line.lineId);
      return <li key={line.lineId}>{line.quantity} {material?.stockUnit} · {material?.stockName}</li>;
    })}</ul>
  </>;
}

export function TransferTrips({ record,busy,send }: {
  record:TransferRecord; busy:boolean; send:(command:Omit<TransferTripCommand,'requestId'>)=>Promise<void>;
}) {
  const [editor,setEditor]=useState<Editor|null>(null);
  const [error,setError]=useState('');
  const editorHeading=useRef<HTMLLegendElement>(null);
  const editingAction=editor?.type;
  useEffect(()=>{ if (editingAction) editorHeading.current?.focus(); },[editingAction]);
  const today=philippineToday();
  const booked=record.trips.filter(trip=>trip.state==='scheduled');
  const current=record.trips.find(trip=>trip.id===editor?.tripId);
  const stale=!!editor&&editor.version!==record.version;
  const planning=editor?.type==='scheduleTrip'||editor?.type==='reviseTrip';
  const dispatching=editor?.type==='dispatchTrip';
  const correcting=editor?.type==='correctTrip';
  const cancellingBalance=editor?.type==='cancelRemaining';
  const actionAvailable=editor && (cancellingBalance ? record.canCancelRemaining
    : record.canManageTrips && (editor.type==='scheduleTrip' || current?.state===(correcting?'dispatched':'scheduled')));
  function open(type:TripAction,trip?:TransferTrip) {
    const plan=trip ? { route:trip.route,plannedDate:trip.plannedDate,plannedTime:trip.plannedTime,directions:trip.directions,lines:trip.lines }
      : { route:'site-site' as const,plannedDate:today,plannedTime:'',directions:'',lines:[] };
    const initial=trip?.departure??{ at:new Date().toISOString(),carrier:'',driver:'',vehicle:'',reference:'',note:'' };
    setEditor({ type,version:record.version,tripId:trip?.id??crypto.randomUUID(),plan,
      quantities:Object.fromEntries(plan.lines.map(line=>[line.lineId,line.quantity])),
      departure:{ ...initial,at:manilaTime(initial.at) },reason:'',confirmed:false });
    setError('');
  }
  function update(patch:Partial<Editor>) {
    setEditor(value=>value&&{ ...value,...patch });
    setError('');
  }
  function save() {
    if (!editor||!actionAvailable||stale) return;
    const command={ type:editor.type,transferId:record.id,expectedVersion:editor.version,tripId:editor.tripId,reason:editor.reason };
    if (planning) {
      const lines=Object.entries(editor.quantities).filter(([,value])=>value.trim()).map(([lineId,value])=>({ lineId,quantity:value.trim() }));
      if (lines.some(line=>!quantity(line.quantity))) {
        setError('Enter each load quantity as a non-negative number.');
        return;
      }
      const selected=lines.filter(line=>positive(line.quantity));
      if (!selected.length) {
        setError('Enter a quantity for at least one material.');
        return;
      }
      void send({ ...command,plan:{ ...editor.plan,lines:selected } });
    } else if (dispatching||correcting) {
      const at=Date.parse(`${editor.departure.at}+08:00`);
      if (!Number.isFinite(at)) {
        setError('Enter the actual Philippine departure date and time.');
        return;
      }
      void send({ ...command,departure:{ ...editor.departure,at:new Date(at).toISOString() } });
    } else {
      void send(command);
    }
  }
  return <section className="panel transfer-trip-panel">
    <h2>Transfer trips</h2>
    {!record.ready && record.status==='approved' && <p role="status">Departure is paused until the current MRF archive is ready.</p>}
    <div className="table-scroll" role="region" aria-label="Transfer quantities" tabIndex={0}><table className="data-table">
      <thead><tr><th>Material</th><th>Approved</th><th>Available to book</th><th>Booked</th><th>Departed</th><th>Released</th></tr></thead>
      <tbody>{record.tripTotals.map(total=>{
        const line=record.lines.find(entry=>entry.id===total.lineId);
        return line&&<tr key={line.id}><th scope="row">{line.stockName}<small>{line.stockUnit}</small></th>
          <td>{total.approved}</td><td>{total.schedulable}</td><td>{total.booked}</td><td>{total.departed}</td><td>{total.released}</td></tr>;
      })}</tbody>
    </table></div>
    {!editor && <div className="form-actions">
      {record.canManageTrips && record.tripTotals.some(total=>positive(total.schedulable)) &&
        <button className="button primary" disabled={busy} onClick={()=>open('scheduleTrip')}>{labels.scheduleTrip}</button>}
      {record.canCancelRemaining && <button className="button secondary" disabled={busy} onClick={()=>open('cancelRemaining')}>{labels.cancelRemaining}</button>}
    </div>}
    {editor && <form className="stock-transfer-approval-form transfer-trip-editor" onSubmit={event=>{ event.preventDefault(); save(); }}>
      <fieldset disabled={busy||!actionAvailable}>
        <legend ref={editorHeading} tabIndex={-1}>{labels[editor.type]}{current&&` · ${current.ref}`}</legend>
        {planning && <>
          <div className="form-grid">
            <Field label="Route"><select value={editor.plan.route} disabled={editor.type==='reviseTrip'}
              onChange={event=>update({ plan:{ ...editor.plan,route:event.target.value as TransferRoute } })}>
              {Object.entries(routes).map(([route,label])=><option key={route} value={route}>{label}</option>)}
            </select></Field>
            <Field label="Planned date (PH)"><input required type="date"
              min={current?.plannedDate && current.plannedDate<today ? current.plannedDate : today}
              value={editor.plan.plannedDate} onChange={event=>update({ plan:{ ...editor.plan,plannedDate:event.target.value } })} /></Field>
            <Field label="Planned time (PH, optional)"><input type="time" value={editor.plan.plannedTime}
              onChange={event=>update({ plan:{ ...editor.plan,plannedTime:event.target.value } })} /></Field>
          </div>
          <Field label="Pickup and drop-off directions (optional)"><textarea maxLength={2000} value={editor.plan.directions}
            onChange={event=>update({ plan:{ ...editor.plan,directions:event.target.value } })} /></Field>
          <div className="form-grid">{record.tripTotals.map(total=>{
            const line=record.lines.find(entry=>entry.id===total.lineId);
            const saved=current?.lines.find(entry=>entry.lineId===total.lineId)?.quantity??'0';
            const available=exactQuantity(add(decimal(total.schedulable),decimal(saved)));
            return line && <Field key={line.id} label={`Load for ${line.stockName} (${line.stockUnit})`}>
              <input inputMode="decimal" maxLength={80} value={editor.quantities[line.id]??''}
                onChange={event=>update({ quantities:{ ...editor.quantities,[line.id]:event.target.value } })} />
              <small>{available} {line.stockUnit} available for this trip</small>
            </Field>;
          })}</div>
        </>}
        {dispatching && current && <TripFacts trip={current} record={record} />}
        {(dispatching||correcting) && <div className="form-grid">
          <Field label="Actual departure (PH)"><input required type="datetime-local" step=".001"
            value={editor.departure.at} onChange={event=>update({ departure:{ ...editor.departure,at:event.target.value } })} /></Field>
          {(Object.keys(transport) as (keyof typeof transport)[]).map(key=><Field key={key} label={`${transport[key]} (optional)`}>
            {key==='note' ? <textarea maxLength={2000} value={editor.departure[key]}
              onChange={event=>update({ departure:{ ...editor.departure,[key]:event.target.value } })} />
              : <input maxLength={200} value={editor.departure[key]}
                onChange={event=>update({ departure:{ ...editor.departure,[key]:event.target.value } })} />}
          </Field>)}
        </div>}
        {cancellingBalance && <>
          <p>The quantities that have yet to depart will be released and the remaining demand will reopen.</p>
          {booked.length>0 && <div><p>Trips that will be cancelled</p><ul>
            {booked.map(trip=><li key={trip.id}><strong>{trip.ref}</strong> · {routes[trip.route]} · {trip.plannedDate}
              <ul>{trip.lines.map(line=>{
                const material=record.lines.find(entry=>entry.id===line.lineId);
                return <li key={line.lineId}>{line.quantity} {material?.stockUnit} · {material?.stockName}</li>;
              })}</ul>
            </li>)}
          </ul></div>}
        </>}
        {(dispatching||cancellingBalance) && <label><input type="checkbox" required checked={editor.confirmed}
          onChange={event=>update({ confirmed:event.target.checked })} />
          {' '}{dispatching?'I confirm the full booked load departed.':'I confirm release of the entire undispatched balance.'}
        </label>}
        {editor.type!=='scheduleTrip'&&!dispatching && <Field label="Reason">
          <textarea required minLength={5} maxLength={2000} value={editor.reason} onChange={event=>update({ reason:event.target.value })} />
        </Field>}
      </fieldset>
      {error&&<p role="alert">{error}</p>}
      {!actionAvailable && <p role="status">This action is unavailable for the current trip or allocation.</p>}
      {stale && actionAvailable && <p role="status">The transfer changed. Review the current quantities and trips before saving.</p>}
      <div className="form-actions">
        {stale && actionAvailable && <button type="button" className="button secondary" disabled={busy}
          onClick={()=>update({ version:record.version,confirmed:false })}>Use current version after review</button>}
        <button className="button primary" disabled={busy||stale||!actionAvailable||(dispatching&&!record.ready)}>
          {planning?`Save ${editor.type==='reviseTrip'?'revision':'schedule'}`:labels[editor.type]}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={()=>setEditor(null)}>Close</button>
      </div>
    </form>}
    {!record.trips.length && <p>No trips have been scheduled.</p>}
    {record.trips.map(trip=><article className="transfer-trip" key={trip.id}>
      <div className="transfer-trip-heading">
        <h3>{trip.ref}</h3><span>{routes[trip.route]}</span>
        <Badge value={trip.state}>{states[trip.state]}</Badge>
        {trip.state==='scheduled'&&trip.plannedDate<today && <Badge value="Overdue" />}
      </div>
      <TripFacts trip={trip} record={record} />
      {record.canManageTrips && !editor && <div className="form-actions">
        {trip.state==='scheduled' && <>
          <button className="button primary" disabled={busy||!record.ready} onClick={()=>open('dispatchTrip',trip)}>{labels.dispatchTrip}</button>
          <button className="button secondary" disabled={busy} onClick={()=>open('reviseTrip',trip)}>{labels.reviseTrip}</button>
          <button className="button secondary" disabled={busy} onClick={()=>open('cancelTrip',trip)}>{labels.cancelTrip}</button>
        </>}
        {trip.state==='dispatched' && <button className="button secondary" disabled={busy} onClick={()=>open('correctTrip',trip)}>{labels.correctTrip}</button>}
      </div>}
      <details className="transfer-trip-history"><summary>Trip history</summary>
        <ol>{trip.history.map(event=><li key={event.id}>
          <strong>{historyLabels[event.action]??event.action}</strong> · {event.actorName} · {when(event.at)}
          {event.reason && <p>{event.reason}</p>}
          <details><summary>Saved details</summary><TripFacts trip={event.snapshot} record={record} /></details>
        </li>)}</ol>
      </details>
    </article>)}
  </section>;
}
