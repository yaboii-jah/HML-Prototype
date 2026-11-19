import { object } from '../accounts/accounts.ts';
import { isAuthRole, type WorkspaceSession } from '../auth/session.ts';
import { id, version } from '../purchasing/contracts.ts';
import { quantity } from '../deliveries/contracts.ts';

export type InventoryMode = 'stock'|'new'|'material'|'entry';
export type InventoryQuery = { mode:InventoryMode; projectId?:string; target?:string };
export type UsageLine = { accountId:string; expectedVersion:string; quantity:string; note?:string };
export type OpeningLine = { accountId:string; description:string; unit:string; quantity:string };
type Submission = { operationId:string; projectId:string; reason:string };
export type InventoryCommand = Submission & (
  { kind:'usage'; lines:UsageLine[] }
  | { kind:'opening'; lines:[OpeningLine] }
  | { kind:'correction'; direction:'add'|'remove'; relatedMovementId?:string; lines:[UsageLine] }
);
export type InventoryAccount = { accountId:string; projectId:string; description:string; unit:string;
  version:string; onHand:string; available:string; reserved:string; scopeIds:string[] };
export type UsageSummary = { id:string; projectId:string; reason:string; actorName:string; at:string; materialCount:number };
export type StockMovement = { id:string; accountId:string; description:string; unit:string; kind:string;
  at:string; quantity:string; reason:string; actorName:string; actorRole:string; relatedMovementId:string|null;
  usageId:string|null; transferId:string|null; deliveryId:string|null };
export type InventoryView = { mode:InventoryMode; target:string|null; role:WorkspaceSession['activeRole']; found:boolean;
  projects:{ id:string; name:string }[]; scopes:{ id:string; name:string; projectId:string }[];
  accounts:InventoryAccount[]; usage:UsageSummary[]; movements:StockMovement[] };

const text = (value:unknown):value is string => typeof value==='string';
const bounded = (value:unknown,max:number,min=1):value is string =>
  text(value)&&value.trim().length>=min&&value.trim().length<=max;
const maybeId = (value:unknown):value is string|null => value===null||id(value);
const stockDate = (value:unknown):value is string => text(value)&&Number.isFinite(Date.parse(value));
const stockBalance = (value:unknown):value is string => text(value)&&/^[0-9]+(?:\.[0-9]+)?$/.test(value);
export const positiveQuantity = (value:unknown):value is string => quantity(value)&&/[1-9]/.test(value);

export function parseInventoryQuery(mode:unknown, projectId:unknown, target:unknown):InventoryQuery|null {
  if (mode!=='stock'&&mode!=='new'&&mode!=='material'&&mode!=='entry') return null;
  if (projectId!=null&&!id(projectId) || target!=null&&!id(target)) return null;
  if ((mode==='material'&&(!id(projectId)||!id(target))) || (mode==='entry'&&!id(target))
    || ((mode==='stock'||mode==='new')&&target!=null)) return null;
  return { mode,projectId:id(projectId)?projectId:undefined,target:id(target)?target:undefined };
}

export function parseInventoryCommand(raw:unknown):InventoryCommand|null {
  const c=object(raw);
  if (!c||!id(c.operationId)||!id(c.projectId)||!bounded(c.reason,2000,5)
    ||!Array.isArray(c.lines)||c.lines.length<1||c.lines.length>100) return null;
  const base={ operationId:c.operationId,projectId:c.projectId,reason:c.reason.trim() };
  if (c.kind==='opening') {
    const row=object(c.lines[0]);
    if (c.lines.length!==1||!row||!id(row.accountId)||!positiveQuantity(row.quantity)
      ||!bounded(row.description,4000)||!bounded(row.unit,4000)) return null;
    return { ...base,kind:c.kind,lines:[{ accountId:row.accountId,description:row.description.trim(),unit:row.unit.trim(),quantity:row.quantity }] };
  }
  const lines:UsageLine[]=[];
  for (const value of c.lines) {
    const row=object(value);
    if (!row||!id(row.accountId)||!version(row.expectedVersion)||!positiveQuantity(row.quantity)) return null;
    const note=text(row.note)?row.note.trim():'';
    if ((note&&!bounded(note,2000,5))||(row.note!=null&&!text(row.note))) return null;
    lines.push({ accountId:row.accountId,expectedVersion:row.expectedVersion,quantity:row.quantity,...(note?{ note }:{}) });
  }
  if (c.kind==='usage'&&new Set(lines.map(line=>line.accountId)).size===lines.length) return { ...base,kind:c.kind,lines };
  if (c.kind==='correction'&&lines.length===1&&!lines[0].note&&(c.direction==='add'||c.direction==='remove')
    &&(c.relatedMovementId==null||id(c.relatedMovementId))) {
    return { ...base,kind:c.kind,direction:c.direction,relatedMovementId:id(c.relatedMovementId)?c.relatedMovementId:undefined,lines:[lines[0]] };
  }
  return null;
}

function rows<T>(data:unknown, parse:(value:Record<string,unknown>)=>T|null):T[]|null {
  if (!Array.isArray(data)) return null;
  const result:T[]=[];
  for (const value of data) {
    const record=object(value);
    const row=record&&parse(record);
    if (!row) return null;
    result.push(row);
  }
  return result;
}

export function parseInventoryView(raw:unknown):InventoryView|null {
  const v=object(raw);
  if (!v||!isAuthRole(v.role)||!maybeId(v.target)||typeof v.found!=='boolean') return null;
  const mode=v.mode;
  if (mode!=='stock'&&mode!=='new'&&mode!=='material'&&mode!=='entry') return null;
  if ((mode==='material'||mode==='entry')!==id(v.target)) return null;
  const projects=rows(v.projects,p=>id(p.id)&&text(p.name)?{ id:p.id,name:p.name }:null);
  const scopes=rows(v.scopes,s=>id(s.id)&&id(s.projectId)&&text(s.name)?{ id:s.id,projectId:s.projectId,name:s.name }:null);
  const accounts=rows(v.accounts,a=>id(a.accountId)&&id(a.projectId)&&version(a.version)&&text(a.description)&&text(a.unit)
    &&stockBalance(a.onHand)&&stockBalance(a.available)&&stockBalance(a.reserved)&&Array.isArray(a.scopeIds)&&a.scopeIds.every(id)
    ? { accountId:a.accountId,projectId:a.projectId,description:a.description,unit:a.unit,version:a.version,
      onHand:a.onHand,available:a.available,reserved:a.reserved,scopeIds:a.scopeIds } : null);
  const usage=rows(v.usage,e=>id(e.id)&&id(e.projectId)&&text(e.reason)&&text(e.actorName)&&stockDate(e.at)
    &&typeof e.materialCount==='number'&&Number.isSafeInteger(e.materialCount)
    ? { id:e.id,projectId:e.projectId,reason:e.reason,actorName:e.actorName,at:e.at,materialCount:e.materialCount } : null);
  const movements=rows(v.movements,m=>id(m.id)&&id(m.accountId)&&text(m.description)&&text(m.unit)&&text(m.kind)
    &&stockDate(m.at)&&text(m.quantity)&&quantity(m.quantity.replace(/^-/,''))
    &&text(m.reason)&&text(m.actorName)&&text(m.actorRole)&&maybeId(m.relatedMovementId)
    &&maybeId(m.usageId)&&maybeId(m.transferId)&&maybeId(m.deliveryId)
    ? { id:m.id,accountId:m.accountId,description:m.description,unit:m.unit,kind:m.kind,at:m.at,quantity:m.quantity,
      reason:m.reason,actorName:m.actorName,actorRole:m.actorRole,relatedMovementId:m.relatedMovementId,
      usageId:m.usageId,transferId:m.transferId,deliveryId:m.deliveryId } : null);
  return projects&&scopes&&accounts&&usage&&movements
    ? { mode,target:v.target,role:v.role,found:v.found,projects,scopes,accounts,usage,movements } : null;
}
