import { object } from '../accounts/accounts.ts';
import { parseReceiptCount, parseReceiptSnapshot, quantity, type ReceiptCount, type ReceiptSnapshot } from '../deliveries/contracts.ts';
import { id, version } from '../purchasing/contracts.ts';

export type TransferReceiptCommand = {
  type:'receiveTrip'|'recountTrip'|'postTrip'|'approveTripEvidence'|'requestTripEvidence';
  requestId:string; transferId:string; tripId:string; expectedVersion:string; reason:string;
  arrivalAt?:string; receiptLines?:ReceiptCount[]; extraGoods?:string; receiptVersionId?:string;
};

export type TransferFileKind = 'generated'|'signed'|'supporting';
export type TransferFile = {
  id:string|null; kind:TransferFileKind; state:'pending'|'uploading'|'processing'|'failed'|'complete';
  name:string|null; readable:boolean; current:boolean; uploaded:boolean; resumable:boolean; revision:number;
};

export type TransferReceipt = ReceiptSnapshot & {
  id:string; postedAt:string|null; actorName:string; canPost:boolean; canRecount:boolean; canReview:boolean;
  canWriteEvidence:boolean; reviewState:'pending'|'needs_evidence'|'approved'; reviewReason:string;
  custody:{ lineId:string; available:string }[]; files:TransferFile[]; priorVersions:ReceiptSnapshot[];
};

const text = (value:unknown):value is string => typeof value==='string';
const instant = (value:unknown):value is string => text(value)&&/^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));

export function parseTransferReceiptCommand(raw:unknown):TransferReceiptCommand|null {
  const c=object(raw);
  if (!c||!id(c.requestId)||!id(c.transferId)||!id(c.tripId)||!version(c.expectedVersion)||!text(c.reason)||c.reason.length>2000) return null;
  const base={ requestId:c.requestId,transferId:c.transferId,tripId:c.tripId,expectedVersion:c.expectedVersion,reason:c.reason.trim() };
  if (c.type==='postTrip') return { ...base,type:c.type };
  if (c.type==='approveTripEvidence'||c.type==='requestTripEvidence') {
    return id(c.receiptVersionId)&&(c.type==='approveTripEvidence'||base.reason.length>=5)
      ? { ...base,type:c.type,receiptVersionId:c.receiptVersionId } : null;
  }
  if (c.type!=='receiveTrip'&&c.type!=='recountTrip') return null;
  if (c.type==='receiveTrip'&&!instant(c.arrivalAt)||c.type==='recountTrip'&&base.reason.length<5
    ||!text(c.extraGoods)||c.extraGoods.length>2000||!Array.isArray(c.receiptLines)
    ||c.receiptLines.length<1||c.receiptLines.length>100) return null;
  const receiptLines:ReceiptCount[]=[];
  for (const rawLine of c.receiptLines) {
    const line=parseReceiptCount(rawLine);
    if (!line||line.issue.length>2000) return null;
    receiptLines.push(line);
  }
  if (new Set(receiptLines.map(line=>line.lineId)).size!==receiptLines.length) return null;
  return { ...base,type:c.type,receiptLines,extraGoods:c.extraGoods,arrivalAt:c.type==='receiveTrip'?String(c.arrivalAt):undefined };
}

function parseTransferFile(raw:unknown):TransferFile|null {
  const f=object(raw);
  if (!f||(f.id!==null&&!id(f.id))||(f.name!==null&&!text(f.name))
    ||(f.kind!=='generated'&&f.kind!=='signed'&&f.kind!=='supporting')
    ||(f.state!=='pending'&&f.state!=='uploading'&&f.state!=='processing'&&f.state!=='failed'&&f.state!=='complete')
    ||typeof f.revision!=='number'||typeof f.current!=='boolean'||typeof f.readable!=='boolean'
    ||typeof f.resumable!=='boolean'||typeof f.uploaded!=='boolean') return null;
  return { id:f.id,name:f.name,kind:f.kind,state:f.state,revision:f.revision,current:f.current,
    readable:f.readable,resumable:f.resumable,uploaded:f.uploaded };
}

export function parseTransferReceipt(raw:unknown):TransferReceipt|null {
  const r=object(raw), snapshot=parseReceiptSnapshot(raw);
  if (!r||!snapshot||!id(r.id)||(r.postedAt!==null&&!instant(r.postedAt))||!text(r.actorName)
    ||(r.reviewState!=='pending'&&r.reviewState!=='needs_evidence'&&r.reviewState!=='approved')
    ||!text(r.reviewReason)||typeof r.canPost!=='boolean'||typeof r.canRecount!=='boolean'
    ||typeof r.canWriteEvidence!=='boolean'||typeof r.canReview!=='boolean'
    ||!Array.isArray(r.files)||!Array.isArray(r.custody)||!Array.isArray(r.priorVersions)) return null;
  const priorVersions:ReceiptSnapshot[]=[];
  for (const rawVersion of r.priorVersions) {
    const version=parseReceiptSnapshot(rawVersion);
    if (!version) return null;
    priorVersions.push(version);
  }
  const files:TransferFile[]=[];
  for (const rawFile of r.files) {
    const file=parseTransferFile(rawFile);
    if (!file) return null;
    files.push(file);
  }
  const custody:TransferReceipt['custody']=[];
  for (const rawLine of r.custody) {
    const line=object(rawLine);
    if (!line||!id(line.lineId)||!quantity(line.available)) return null;
    custody.push({ lineId:line.lineId,available:line.available });
  }
  return { ...snapshot,id:r.id,postedAt:r.postedAt,actorName:r.actorName,reviewState:r.reviewState,
    reviewReason:r.reviewReason,canPost:r.canPost,canRecount:r.canRecount,canWriteEvidence:r.canWriteEvidence,
    canReview:r.canReview,files,custody,priorVersions };
}
