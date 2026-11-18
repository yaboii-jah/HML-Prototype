import { object } from '../accounts/accounts.ts';
import { id, version, quantity } from '../purchasing/contracts.ts';
import { isAuthRole, type AuthRole } from '../auth/session.ts';

const states = ['review_pending','suitable','converted','release_pending','approved','rejected','cancelled'] as const;
export type TransferStatus = typeof states[number];
export type TransferSelection = { itemId:string; stockId:string; quantity:string; match:'direct'|'alternative'; verified:boolean; explanation:string };
export type TransferCommand =
  | { type:'submit'; requestId:string; mrfId:string; sourceId:string; expectedDemand:string; reason:string; selections:TransferSelection[] }
  | { type:'confirmSuitability'|'requestRelease'|'approveRelease'|'reject'|'cancel'; requestId:string; transferId:string;
      expectedVersion:string; reason:string; expectedDemand?:string; quantity?:string; specificationsConfirmed?:boolean; quantities?:Record<string,string> };
type TransferLine = { id:string; itemId:string; stockId:string; requestedName:string; requestedUnit:string;
  stockName:string; stockUnit:string; proposed:string; approved:string; explanation:string };
type TransferEvent = { id:string; action:string; reason:string; at:string; actorName:string; actorRole:AuthRole;
  snapshot:{ status:TransferStatus; lines:TransferLine[] } };
export type TransferRecord = { id:string; ref:string|null; requestId:string|null; requestRef:string;
  source:string; destination:string; status:TransferStatus; version:string; note:string; ready:boolean; demandVersion:string|null;
  canReview:boolean; canApprove:boolean; canCancel:boolean; canRequestRelease:boolean; lines:TransferLine[]; history:TransferEvent[] };
export type TransferSourcing = { requestId:string; requestRef:string; ready:boolean; demandVersion:string;
  items:{ id:string; name:string; unit:string; unassigned:string }[];
  candidates:{ id:string; projectId:string; project:string; name:string; unit:string; available:string }[] };
export type TransferView = { records:TransferRecord[]; sourcing:TransferSourcing|null };

const text = (value:unknown): value is string => typeof value==='string';
const bounded = (value:unknown): value is string => text(value) && value.length<=2000;
const flag = (value:unknown): value is boolean => typeof value==='boolean';
const status = (value:unknown): value is TransferStatus => states.some(state => state===value);
const positive = (value:unknown): value is string => quantity(value) && /[1-9]/.test(value);

function list<T>(value:unknown, parse:(entry:unknown)=>T|null):T[]|null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.every(entry => entry!==null) ? parsed : null;
}

export function parseTransferCommand(raw:unknown):TransferCommand|null {
  const c=object(raw);
  if (!c || !id(c.requestId) || !bounded(c.reason)) return null;
  const base={ requestId:c.requestId, reason:c.reason.trim() };
  if (c.type==='submit') {
    if (!id(c.mrfId)||!id(c.sourceId)||!version(c.expectedDemand)) return null;
    const selections=list<TransferSelection>(c.selections, rawLine => {
      const l=object(rawLine);
      if (!l || !id(l.itemId)||!id(l.stockId)||!positive(l.quantity)||!bounded(l.explanation)
        || (l.match!=='direct' && l.match!=='alternative') || !flag(l.verified)) return null;
      return { itemId:l.itemId, stockId:l.stockId, quantity:l.quantity, match:l.match, verified:l.verified, explanation:l.explanation.trim() };
    });
    if (!selections || selections.length<1 || selections.length>100) return null;
    return { ...base,type:c.type,mrfId:c.mrfId,sourceId:c.sourceId,expectedDemand:c.expectedDemand,selections };
  }
  if (!id(c.transferId)||!version(c.expectedVersion)) return null;
  const target={ ...base, transferId:c.transferId, expectedVersion:c.expectedVersion };
  switch(c.type) {
    case 'reject':
    case 'cancel':
      return base.reason.length>=5 ? { ...target,type:c.type } : null;
    case 'confirmSuitability':
      return positive(c.quantity) && c.specificationsConfirmed===true && base.reason.length>=5
        ? { ...target,type:c.type,quantity:c.quantity,specificationsConfirmed:true } : null;
    case 'requestRelease':
      return positive(c.quantity)&&version(c.expectedDemand)
        ? { ...target,type:c.type,quantity:c.quantity,expectedDemand:c.expectedDemand } : null;
    case 'approveRelease': {
      const values=object(c.quantities), quantities:Record<string,string>={};
      if (!values || Object.keys(values).length>100) return null;
      for (const [lineId,amount] of Object.entries(values)) {
        if (!id(lineId)||!quantity(amount)) return null;
        quantities[lineId]=amount;
      }
      return { ...target,type:c.type,quantities };
    }
    default:
      return null;
  }
}

function parseLine(raw:unknown):TransferLine|null {
  const l=object(raw);
  if (!l || !id(l.id)||!id(l.itemId)||!id(l.stockId)||!text(l.requestedName)||!text(l.requestedUnit)
    || !text(l.stockName)||!text(l.stockUnit)||!quantity(l.proposed)||!quantity(l.approved)||!bounded(l.explanation)) return null;
  return { id:l.id,itemId:l.itemId,stockId:l.stockId,requestedName:l.requestedName,requestedUnit:l.requestedUnit,
    stockName:l.stockName,stockUnit:l.stockUnit,proposed:l.proposed,approved:l.approved,explanation:l.explanation };
}

function parseEvent(raw:unknown):TransferEvent|null {
  const e=object(raw), snapshot=object(e?.snapshot), lines=list(snapshot?.lines,parseLine);
  if (!e || !snapshot || !lines || !id(e.id)||!text(e.action)||!bounded(e.reason)||!text(e.at)
    || !Number.isFinite(Date.parse(e.at))||!text(e.actorName)||!isAuthRole(e.actorRole)||!status(snapshot.status)) return null;
  return { id:e.id,action:e.action,reason:e.reason,at:e.at,actorName:e.actorName,actorRole:e.actorRole,
    snapshot:{ status:snapshot.status, lines } };
}

function parseRecord(raw:unknown):TransferRecord|null {
  const r=object(raw), lines=list(r?.lines,parseLine), history=list(r?.history,parseEvent);
  if (!r || !lines || !history || !id(r.id)||(r.ref!==null&&!text(r.ref))||(r.requestId!==null&&!id(r.requestId))
    || !text(r.requestRef)||!text(r.source)||!text(r.destination)||!status(r.status)||!version(r.version)||!bounded(r.note)
    || !flag(r.ready)|| (r.demandVersion!==null&&!version(r.demandVersion))
    || !flag(r.canReview)||!flag(r.canApprove)||!flag(r.canCancel)||!flag(r.canRequestRelease)) return null;
  return { id:r.id,ref:r.ref,requestId:r.requestId,requestRef:r.requestRef,source:r.source,destination:r.destination,
    status:r.status,version:r.version,note:r.note,ready:r.ready,demandVersion:r.demandVersion,
    canReview:r.canReview,canApprove:r.canApprove,canCancel:r.canCancel,canRequestRelease:r.canRequestRelease,lines,history };
}

function parseSourcing(raw:unknown):TransferSourcing|null {
  const s=object(raw);
  if (!s || !id(s.requestId)||!text(s.requestRef)||!flag(s.ready)||!version(s.demandVersion)) return null;
  const items=list(s.items,rawItem=>{
    const i=object(rawItem);
    return i && id(i.id)&&text(i.name)&&text(i.unit)&&quantity(i.unassigned)
      ? { id:i.id,name:i.name,unit:i.unit,unassigned:i.unassigned } : null;
  });
  const candidates=list(s.candidates,rawCandidate=>{
    const c=object(rawCandidate);
    return c && id(c.id)&&id(c.projectId)&&text(c.project)&&text(c.name)&&text(c.unit)&&positive(c.available)
      ? { id:c.id,projectId:c.projectId,project:c.project,name:c.name,unit:c.unit,available:c.available } : null;
  });
  return items && candidates ? { requestId:s.requestId,requestRef:s.requestRef,ready:s.ready,demandVersion:s.demandVersion,items,candidates } : null;
}

export function parseTransferView(raw:unknown):TransferView|null {
  const v=object(raw), records=list(v?.records,parseRecord), sourcing=parseSourcing(v?.sourcing);
  return v && records && (v.sourcing===null||sourcing) ? { records,sourcing } : null;
}
