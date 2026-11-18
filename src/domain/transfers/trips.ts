import { object } from '../accounts/accounts.ts';
import { id, version } from '../purchasing/contracts.ts';
import { paymentDate } from '../payments/payments.ts';
import { parseDeparture, quantity, type Departure, type LoadLine } from '../deliveries/contracts.ts';

export type TransferRoute = 'site-site'|'site-warehouse';
export type TripState = 'scheduled'|'dispatched'|'cancelled';
export type TripPlan = { route:TransferRoute; plannedDate:string; plannedTime:string; directions:string; lines:LoadLine[] };
export type TransferTripCommand = {
  type:'scheduleTrip'|'reviseTrip'|'cancelTrip'|'dispatchTrip'|'correctTrip'|'cancelRemaining';
  requestId:string; transferId:string; expectedVersion:string; reason:string;
  tripId?:string; plan?:TripPlan; departure?:Departure;
};
type TripSnapshot = TripPlan & { id:string; ref:string; state:TripState; pickupName:string; pickupAddress:string;
  destinationName:string; destinationAddress:string; departure:Departure|null };
export type TransferTrip = TripSnapshot & { history:{ id:string; action:string; reason:string; at:string; actorName:string; snapshot:TripSnapshot }[] };
export type TripTotals = { lineId:string; approved:string; released:string; booked:string; departed:string; schedulable:string };
export type TripCounts = Record<TripState,number>;

const text = (value:unknown):value is string => typeof value==='string';
const bounded = (value:unknown):value is string => text(value)&&value.length<=2000;
export function tripList<T>(value:unknown,parse:(entry:unknown)=>T|null):T[]|null {
  if (!Array.isArray(value)) return null;
  const result=value.map(parse);
  return result.every(entry=>entry!==null)?result:null;
}

function parsePlan(raw:unknown):TripPlan|null {
  const p=object(raw);
  if (!p || (p.route!=='site-site'&&p.route!=='site-warehouse')||!paymentDate(p.plannedDate)
    || !text(p.plannedTime)||!/^(|([01]\d|2[0-3]):[0-5]\d)$/.test(p.plannedTime)||!bounded(p.directions)) return null;
  const lines=tripList(p.lines,value=>{
    const line=object(value);
    return line&&id(line.lineId)&&quantity(line.quantity)&&/[1-9]/.test(line.quantity)
      ? { lineId:line.lineId,quantity:line.quantity } : null;
  });
  if (!lines||!lines.length||lines.length>100||new Set(lines.map(l=>l.lineId)).size!==lines.length) return null;
  return { route:p.route,plannedDate:p.plannedDate,plannedTime:p.plannedTime,directions:p.directions,lines };
}

export function parseTransferTripCommand(raw:unknown):TransferTripCommand|null {
  const c=object(raw);
  if (!c||!id(c.requestId)||!id(c.transferId)||!version(c.expectedVersion)||!bounded(c.reason)) return null;
  const base={ requestId:c.requestId,transferId:c.transferId,expectedVersion:c.expectedVersion,reason:c.reason.trim() };
  if (c.type==='cancelRemaining') return base.reason.length>=5?{ ...base,type:c.type }:null;
  if (!id(c.tripId)) return null;
  const target={ ...base,tripId:c.tripId };
  switch(c.type) {
    case 'scheduleTrip':
    case 'reviseTrip': {
      const plan=parsePlan(c.plan);
      return plan&&(c.type==='scheduleTrip'||base.reason.length>=5)?{ ...target,type:c.type,plan }:null;
    }
    case 'dispatchTrip':
    case 'correctTrip': {
      const departure=parseDeparture(c.departure);
      return departure&&(c.type==='dispatchTrip'||base.reason.length>=5)?{ ...target,type:c.type,departure }:null;
    }
    case 'cancelTrip':
      return base.reason.length>=5?{ ...target,type:c.type }:null;
    default:
      return null;
  }
}

function parseSnapshot(raw:unknown):TripSnapshot|null {
  const t=object(raw),plan=parsePlan(raw),departure=parseDeparture(t?.departure);
  if (!t||!plan||!id(t.id)||!text(t.ref)||!text(t.pickupName)||!text(t.pickupAddress)
    ||!text(t.destinationName)||!text(t.destinationAddress)
    ||(t.state!=='scheduled'&&t.state!=='dispatched'&&t.state!=='cancelled')
    ||(t.state==='dispatched'?!departure:t.departure!==null)) return null;
  return { ...plan,id:t.id,ref:t.ref,state:t.state,pickupName:t.pickupName,pickupAddress:t.pickupAddress,
    destinationName:t.destinationName,destinationAddress:t.destinationAddress,departure };
}

export function parseTrip(raw:unknown):TransferTrip|null {
  const snapshot=parseSnapshot(raw);
  const history=tripList(object(raw)?.history,entry=>{
    const e=object(entry), saved=parseSnapshot(e?.snapshot);
    return e&&saved&&id(e.id)&&text(e.action)&&text(e.reason)&&text(e.at)&&Number.isFinite(Date.parse(e.at))&&text(e.actorName)
      ? { id:e.id,action:e.action,reason:e.reason,at:e.at,actorName:e.actorName,snapshot:saved } : null;
  });
  return snapshot&&history?{ ...snapshot,history }:null;
}

export function parseTripTotals(raw:unknown):TripTotals|null {
  const t=object(raw);
  return t&&id(t.lineId)&&quantity(t.approved)&&quantity(t.released)&&quantity(t.booked)&&quantity(t.departed)&&quantity(t.schedulable)
    ? { lineId:t.lineId,approved:t.approved,released:t.released,booked:t.booked,departed:t.departed,schedulable:t.schedulable } : null;
}

export function parseTripCounts(raw:unknown):TripCounts|null {
  const t=object(raw),count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  return t&&count(t.scheduled)&&count(t.dispatched)&&count(t.cancelled)
    ? { scheduled:t.scheduled,dispatched:t.dispatched,cancelled:t.cancelled } : null;
}
