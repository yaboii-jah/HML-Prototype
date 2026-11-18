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
  type: 'schedule' | 'revise' | 'cancel' | 'dispatch' | 'correct';
  requestId: string; deliveryId: string; poId: string; expectedVersion: string;
  reason: string; plan?: DeliveryPlan; departure?: Departure;
};
export type DeliveryEvent = { action: string; reason: string; at: string; actorName: string; snapshot: { plan: DeliveryPlan; departure: Departure | null } };
export type Delivery = {
  id: string; poId: string; ref: string; version: string; state: 'scheduled' | 'dispatched' | 'cancelled';
  createdAt: string; plan: DeliveryPlan; departure: Departure | null; history: DeliveryEvent[];
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
    || !['schedule', 'revise', 'cancel', 'dispatch', 'correct'].includes(String(c.type))) return null;
  const type = c.type as DeliveryCommand['type'];
  if (['revise', 'cancel', 'correct'].includes(type) && c.reason.trim().length < 5) return null;
  const result: DeliveryCommand = { type, requestId: c.requestId, deliveryId: c.deliveryId, poId: c.poId, expectedVersion: c.expectedVersion, reason: c.reason };
  if (type === 'schedule' || type === 'revise') {
    const plan = parseDeliveryPlan(c.plan);
    if (!plan) return null;
    result.plan = plan;
  }
  if (type === 'dispatch' || type === 'correct') {
    const departure = parseDeparture(c.departure);
    if (!departure) return null;
    result.departure = departure;
  }
  return result;
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
    if (!d || Object.keys(d).some(k => !['id','poId','ref','version','state','createdAt','plan','departure','history'].includes(k))
      || !id(d.id) || !id(d.poId) || !text(d.ref) || !version(d.version) || !instant(d.createdAt) || !plan
      || !['scheduled','dispatched','cancelled'].includes(String(d.state)) || (d.departure !== null && !departure) || !Array.isArray(d.history)) return null;
    const history: DeliveryEvent[] = [];
    for (const rawEvent of d.history) {
      const e = record(rawEvent), s = record(e?.snapshot), p = parseDeliveryPlan(s?.plan), dep = s?.departure === null ? null : parseDeparture(s?.departure);
      if (!e || !s || !p || !text(e.action) || !text(e.reason) || !instant(e.at) || !text(e.actorName) || (s.departure !== null && !dep)) return null;
      history.push({ action:e.action, reason:e.reason, at:e.at, actorName:e.actorName, snapshot:{ plan:p, departure:dep } });
    }
    deliveries.push({ id:d.id, poId:d.poId, ref:d.ref, version:d.version, state:d.state as Delivery['state'], createdAt:d.createdAt, plan, departure, history });
  }
  return { role:v.role, orders, deliveries };
}
