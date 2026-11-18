import { UUID_PATTERN, isAuthRole, type AuthRole } from '../auth/session.ts';
import { record } from '../projects/projects.ts';
import { paymentDate } from '../payments/payments.ts';
import { decimal, multiply } from '../quotations/decimal.ts';
import { exactQuantity } from '../purchasing/pricing.ts';

export type LoadLine = { lineId: string; quantity: string };
export type DeliveryPlan = {
  route: 'site' | 'warehouse'; plannedDate: string; plannedTime: string;
  pickup: string; destination: string; address: string; note: string; lines: LoadLine[];
};
export type Departure = { at: string; carrier: string; driver: string; vehicle: string; reference: string; note: string };
export type DeliveryCommand = {
  type: 'schedule' | 'scheduleForward' | 'revise' | 'cancel' | 'dispatch' | 'correct'
    | 'receive' | 'recount' | 'post' | 'approveEvidence' | 'requestEvidence';
  requestId: string; deliveryId: string; poId: string; expectedVersion: string;
  reason: string; plan?: DeliveryPlan; departure?: Departure;
  parentDeliveryId?: string; arrivalAt?: string; extraGoods?: string; receiptLines?: ReceiptCount[]; receiptVersionId?: string;
};
export type ReceiptCount = { lineId: string; accepted: string; missing: string; rejected: string; issue: string };
export type ReceiptLine = ReceiptCount & { expected: string; description: string; unit: string; stockDescription: string; stockUnit: string; stockQuantity: string };
export type ReceiptSnapshot = { ref: string; revision: number; arrivalAt: string; extraGoods: string; lines: ReceiptLine[] };
type ReceiptFile = { id: string | null; state: 'pending' | 'uploading' | 'processing' | 'failed' | 'complete' };
export type DeliveryReceipt = ReceiptSnapshot & {
  id: string; postedAt: string | null; reviewState: 'pending' | 'needs_evidence' | 'approved'; reviewReason: string;
  canRecount: boolean; generated: ReceiptFile; signed: ReceiptFile | null; signedUploadState: ReceiptFile['state'] | null;
  historicalFiles: { id: string; kind: 'generated' | 'signed'; revision: number; name: string }[];
};
export type DeliveryEvent = { action: string; reason: string; at: string; actorName: string; snapshot: { plan: DeliveryPlan; departure: Departure | null; receipt?: ReceiptSnapshot } };
export type Delivery = {
  id: string; poId: string; ref: string; version: string; state: 'scheduled' | 'dispatched' | 'cancelled';
  createdAt: string; plan: DeliveryPlan; departure: Departure | null; history: DeliveryEvent[];
  parentDeliveryId: string | null; receipt: DeliveryReceipt | null; warehouseRemaining: Record<string, string>;
};
export type DeliveryOrder = {
  id: string; ref: string; projectId: string; project: string; vendor: string;
  pickup: string; destination: string; address: string; cleared: boolean; version: string;
  lines: { id: string; description: string; unit: string; requestedUnit: string; quantity: string; factor: string; allocated: string }[];
};
export type DeliveriesView = { role: AuthRole; orders: DeliveryOrder[]; deliveries: Delivery[] };
const id = (v: unknown): v is string => typeof v === 'string' && UUID_PATTERN.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000;
const version = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,18})$/.test(v);
export const quantity = (v: unknown): v is string => typeof v === 'string' && v.length <= 80 && /^(0|[1-9]\d*)(\.\d+)?$/.test(v);
const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
export function requestedQuantity(offered: string, factor: string) {
  return exactQuantity(multiply(decimal(offered), decimal(factor)));
}
export function parseDeliveryPlan(value: unknown): DeliveryPlan | null {
  const p = record(value);
  if (!p || !['site', 'warehouse'].includes(String(p.route)) || !paymentDate(p.plannedDate)
    || typeof p.plannedTime !== 'string' || !/^(|([01]\d|2[0-3]):[0-5]\d)$/.test(p.plannedTime)
    || !text(p.pickup) || !p.pickup.trim() || !text(p.destination) || !p.destination.trim()
    || !text(p.address) || !p.address.trim() || !text(p.note) || !Array.isArray(p.lines) || !p.lines.length || p.lines.length > 500) return null;
  const lines: LoadLine[] = [];
  for (const raw of p.lines) {
    const l = record(raw);
    if (!l || !id(l.lineId) || !quantity(l.quantity) || !/[1-9]/.test(l.quantity) || lines.some(x => x.lineId === l.lineId)) return null;
    lines.push({ lineId: l.lineId, quantity: l.quantity });
  }
  return { route: p.route === 'site' ? 'site' : 'warehouse', plannedDate: p.plannedDate, plannedTime: p.plannedTime,
    pickup: p.pickup.trim(), destination: p.destination.trim(), address: p.address.trim(), note: p.note, lines };
}
export function parseDeparture(value: unknown): Departure | null {
  const d = record(value);
  return d && instant(d.at) && text(d.carrier) && text(d.driver) && text(d.vehicle) && text(d.reference) && text(d.note)
    ? { at: d.at, carrier: d.carrier, driver: d.driver, vehicle: d.vehicle, reference: d.reference, note: d.note } : null;
}
export function parseDeliveryCommand(value: unknown): DeliveryCommand | null {
  const c = record(value);
  if (!c || !id(c.requestId) || !id(c.deliveryId) || !id(c.poId) || !version(c.expectedVersion) || !text(c.reason)
    || !['schedule','scheduleForward','revise','cancel','dispatch','correct','receive','recount','post','approveEvidence','requestEvidence'].includes(String(c.type))) return null;
  const type = c.type as DeliveryCommand['type'];
  if (['revise','cancel','correct','recount','requestEvidence'].includes(type) && c.reason.trim().length < 5) return null;
  const result: DeliveryCommand = { type, requestId: c.requestId, deliveryId: c.deliveryId, poId: c.poId, expectedVersion: c.expectedVersion, reason: c.reason };
  if (type === 'schedule' || type === 'scheduleForward' || type === 'revise') {
    const plan = parseDeliveryPlan(c.plan);
    if (!plan) return null;
    result.plan = plan;
  }
  if (type === 'dispatch' || type === 'correct') {
    const departure = parseDeparture(c.departure);
    if (!departure) return null;
    result.departure = departure;
  }
  if (type === 'scheduleForward') {
    if (!id(c.parentDeliveryId)) return null;
    result.parentDeliveryId = c.parentDeliveryId;
  }
  if (type === 'receive' || type === 'recount') {
    if (!text(c.extraGoods) || !Array.isArray(c.receiptLines) || c.receiptLines.length < 1 || c.receiptLines.length > 500) return null;
    const counts: ReceiptCount[] = [];
    for (const raw of c.receiptLines) {
      const count = parseReceiptCount(raw);
      if (!count || counts.some(line => line.lineId === count.lineId)) return null;
      counts.push(count);
    }
    result.receiptLines = counts;
    result.extraGoods = c.extraGoods;
    if (type === 'receive') {
      if (!instant(c.arrivalAt)) return null;
      result.arrivalAt = c.arrivalAt;
    }
  }
  if (type === 'approveEvidence' || type === 'requestEvidence') {
    if (!id(c.receiptVersionId)) return null;
    result.receiptVersionId = c.receiptVersionId;
  }
  return result;
}

function parseReceiptCount(raw: unknown): ReceiptCount | null {
  const line = record(raw);
  if (!line || !id(line.lineId) || !quantity(line.accepted) || !quantity(line.missing) || !quantity(line.rejected) || !text(line.issue)) return null;
  return { lineId:line.lineId, accepted:line.accepted, missing:line.missing, rejected:line.rejected, issue:line.issue };
}

export function parseReceiptSnapshot(raw: unknown): ReceiptSnapshot | null {
  const r = record(raw);
  if (!r || !text(r.ref) || typeof r.revision !== 'number' || !Number.isSafeInteger(r.revision)
    || r.revision < 1 || !instant(r.arrivalAt) || !text(r.extraGoods) || !Array.isArray(r.lines)) return null;
  const lines: ReceiptLine[] = [];
  for (const rawLine of r.lines) {
    const count = parseReceiptCount(rawLine), line = record(rawLine);
    if (!count || !line || !quantity(line.expected) || !text(line.description) || !text(line.unit)
      || typeof line.stockDescription !== 'string' || typeof line.stockUnit !== 'string' || !quantity(line.stockQuantity)) return null;
    lines.push({ ...count, expected:line.expected, description:line.description, unit:line.unit,
      stockDescription:line.stockDescription, stockUnit:line.stockUnit, stockQuantity:line.stockQuantity });
  }
  return { ref:r.ref, revision:r.revision, arrivalAt:r.arrivalAt, extraGoods:r.extraGoods, lines };
}

function parseReceiptFile(raw: unknown): ReceiptFile | null {
  const file = record(raw);
  if (!file || (file.id !== null && !id(file.id)) || !['pending','uploading','processing','failed','complete'].includes(String(file.state))) return null;
  return { id:file.id, state:file.state as ReceiptFile['state'] };
}

function parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
  const r = record(raw), snapshot = parseReceiptSnapshot(raw);
  const generated = parseReceiptFile(r?.generated), signed = parseReceiptFile(r?.signed);
  if (!r || !snapshot || !generated || !id(r.id) || (r.postedAt !== null && !instant(r.postedAt))
    || !['pending','needs_evidence','approved'].includes(String(r.reviewState)) || !text(r.reviewReason)
    || typeof r.canRecount !== 'boolean' || (r.signed !== null && !signed)
    || !Array.isArray(r.historicalFiles)
    || (r.signedUploadState !== null && !['uploading','processing','failed'].includes(String(r.signedUploadState)))) return null;
  const historicalFiles: DeliveryReceipt['historicalFiles'] = [];
  for (const raw of r.historicalFiles) {
    const file = record(raw);
    if (!file || !id(file.id) || !text(file.name) || (file.kind!=='generated' && file.kind!=='signed')
      || typeof file.revision!=='number' || !Number.isSafeInteger(file.revision) || file.revision<1) return null;
    historicalFiles.push({ id:file.id, name:file.name, kind:file.kind, revision:file.revision });
  }
  return { ...snapshot, id:r.id, postedAt:r.postedAt, reviewState:r.reviewState as DeliveryReceipt['reviewState'],
    reviewReason:r.reviewReason, canRecount:r.canRecount, generated, signed, historicalFiles, signedUploadState:r.signedUploadState as DeliveryReceipt['signedUploadState'] };
}
export function parseDeliveriesView(value: unknown): DeliveriesView | null {
  const v = record(value);
  if (!v || !isAuthRole(v.role) || !Array.isArray(v.orders) || !Array.isArray(v.deliveries)) return null;
  // Reject unexpected keys as well as malformed values: Site projections cannot smuggle financial payloads.
  if (Object.keys(v).some(k => !['role', 'orders', 'deliveries'].includes(k))) return null;
  const orders: DeliveryOrder[] = [], deliveries: Delivery[] = [];
  for (const raw of v.orders) {
    const o = record(raw);
    if (!o || Object.keys(o).some(k => !['id','ref','projectId','project','vendor','pickup','destination','address','cleared','version','lines'].includes(k))
      || !id(o.id) || !id(o.projectId) || !text(o.ref) || !text(o.project) || !text(o.vendor) || !text(o.pickup)
      || !text(o.destination) || !text(o.address) || typeof o.cleared !== 'boolean' || !version(o.version) || !Array.isArray(o.lines)) return null;
    const lines: DeliveryOrder['lines'] = [];
    for (const rawLine of o.lines) {
      const l = record(rawLine);
      if (!l || Object.keys(l).some(k => !['id','description','unit','requestedUnit','quantity','factor','allocated'].includes(k))
        || !id(l.id) || !text(l.description) || !text(l.unit) || !text(l.requestedUnit) || !quantity(l.quantity) || !quantity(l.factor) || !quantity(l.allocated)) return null;
      lines.push({ id:l.id, description:l.description, unit:l.unit, requestedUnit:l.requestedUnit, quantity:l.quantity, factor:l.factor, allocated:l.allocated });
    }
    orders.push({ id:o.id, ref:o.ref, projectId:o.projectId, project:o.project, vendor:o.vendor, pickup:o.pickup, destination:o.destination, address:o.address, cleared:o.cleared, version:o.version, lines });
  }
  for (const raw of v.deliveries) {
    const d = record(raw), plan = parseDeliveryPlan(d?.plan);
    const departure = d?.departure === null ? null : parseDeparture(d?.departure);
    const receipt = parseDeliveryReceipt(d?.receipt), available = record(d?.warehouseRemaining ?? {});
    if (!d || Object.keys(d).some(k => !['id','poId','ref','version','state','createdAt','plan','departure','history','parentDeliveryId','receipt','warehouseRemaining'].includes(k))
      || !id(d.id) || !id(d.poId) || !text(d.ref) || !version(d.version) || !instant(d.createdAt) || !plan
      || !['scheduled','dispatched','cancelled'].includes(String(d.state)) || (d.departure !== null && !departure) || !Array.isArray(d.history)
      || (d.parentDeliveryId != null && !id(d.parentDeliveryId)) || (d.receipt != null && !receipt) || !available) return null;
    const warehouseRemaining: Record<string, string> = {};
    for (const [lineId, amount] of Object.entries(available)) {
      if (!id(lineId) || !quantity(amount)) return null;
      warehouseRemaining[lineId] = amount;
    }
    const history: DeliveryEvent[] = [];
    for (const rawEvent of d.history) {
      const e = record(rawEvent), s = record(e?.snapshot), p = parseDeliveryPlan(s?.plan), dep = s?.departure === null ? null : parseDeparture(s?.departure);
      if (!e || !s || !p || !text(e.action) || !text(e.reason) || !instant(e.at) || !text(e.actorName) || (s.departure !== null && !dep)) return null;
      const eventReceipt = parseReceiptSnapshot(s.receipt);
      if (s.receipt != null && !eventReceipt) return null;
      history.push({ action:e.action, reason:e.reason, at:e.at, actorName:e.actorName, snapshot:{ plan:p, departure:dep, ...(eventReceipt ? { receipt:eventReceipt } : {}) } });
    }
    deliveries.push({ id:d.id, poId:d.poId, ref:d.ref, version:d.version, state:d.state as Delivery['state'], createdAt:d.createdAt, plan, departure, history,
      parentDeliveryId:d.parentDeliveryId ?? null, receipt, warehouseRemaining });
  }
  return { role:v.role, orders, deliveries };
}
