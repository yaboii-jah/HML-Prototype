import { transferQuantityFor, transfersForRequest, deliveriesForTransfer } from "./stock-transfers.ts";
import { isSiteBatch, legFor, warehouseHeldFor } from "./delivery-flow.ts";
import { auditRecords, type AuditRecord } from "./audit.ts";
import { acceptedFor, outstandingFor, paidTotal, poItems, poTotal } from "./selectors.ts";
import type { Activity, DemoSnapshot } from "./types.ts";

export type LifecycleStage = { name: string; progress: string; records: AuditRecord[]; lastEvent?: Activity; recordedAt?: string };
const newest = (values: (string | undefined)[]) => values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
export function requestLifecycle(state: DemoSnapshot, requestId: string) {
  const records = auditRecords(state);
  const request = state.requests.find(value => value.id === requestId);
  if (!request) return { events: [] as Activity[], stages: [] as LifecycleStage[], records };
  const linkedIds = new Set([...records.values()].filter(value => value.requestId === requestId).map(value => value.id));
  const events = state.activity.filter(value => value.requestId ? value.requestId === requestId : linkedIds.has(value.entity)).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  const pos = state.pos.filter(value => value.mrfId === requestId);
  const active = pos.filter(value => value.status !== "rejected");
  const approved = active.filter(value => ["approved", "released"].includes(value.status));
  const batches = state.batches.filter(value => active.some(po => po.id === value.poId));
  const payments = state.paymentRequests.filter(value => pos.some(po => po.id === value.poId));
  const refs = (ids: string[]) => ids.map(id => records.get(id)).filter((value): value is AuditRecord => !!value);
  const typeFor = (value: Activity): AuditRecord["type"] | undefined => {
    if (value.eventType?.startsWith("proof")) return "payment";
    if (value.eventType?.startsWith("payment")) return "payment";
    if (value.eventType?.startsWith("quote")) return "quote";
    if (value.eventType?.startsWith("comparison")) return "comparison";
    if (value.eventType?.startsWith("allocation")) return "allocation";
    if (value.eventType === "evidence.attached") return "evidence";
    if (value.eventType === "documents.reviewed") return undefined;
    return value.entityType || records.get(value.entity)?.type;
  };
  const last = (types: AuditRecord["type"][]) => events.find(value => { const type = typeFor(value); return type && types.includes(type); });
  const counts = active.reduce<Record<string, number>>((result, po) => { result[po.status] = (result[po.status] || 0) + 1; return result; }, {});
  const statuses = Object.entries(counts).map(([status, count]) => `${count} ${status === "hold" ? "on hold" : status}`).join(" · ");
  const received = batches.filter(value => isSiteBatch(value) && value.status === "confirmed").length, posted = batches.filter(value => isSiteBatch(value) && value.status === "posted").length, scheduled = batches.filter(value => value.status === "expected").length;
  const inTransit = batches.filter(batch => batch.status === "dispatched").length, warehouseHeld = batches.filter(batch => legFor(batch) === "supplier-warehouse" && batch.lines.some(line => warehouseHeldFor(state,batch.id,line.itemId) > 0)).length;
  const openLines = active.filter(value => value.status === "released").reduce((total, po) => total + poItems(state, po).filter(item => outstandingFor(state, po, item.id) > 0).length, 0);
  const transfers = transfersForRequest(state, requestId), transferTrips = transfers.flatMap(transfer => deliveriesForTransfer(state, transfer.id));
  const transferScheduled = transferTrips.filter(value => value.status === "expected").length, transferTransit = transferTrips.filter(value => value.status === "dispatched").length, transferReceived = transferTrips.filter(value => value.status === "confirmed").length, transferPosted = transferTrips.filter(value => value.status === "posted").length;
  const transferOnly = !active.length && transfers.length > 0 && request.items.every(item => transferQuantityFor(state, request.id, item.id) + .000001 >= item.quantity);
  const allReceived = request.items.length > 0 && request.items.every(item => item.quantity > 0 && active.reduce((total, po) => total + acceptedFor(state, po.id, item.id), 0) + transferQuantityFor(state, requestId, item.id, "accepted") + .000001 >= item.quantity);
  const hasReceipts = transferTrips.some(delivery => ["confirmed", "posted"].includes(delivery.status)) || active.some(po => poItems(state, po).some(item => acceptedFor(state, po.id, item.id) > 0));
  const stages: LifecycleStage[] = [
    { name: "MRF", progress: request.correction ? `Approved · correction ${request.correction.status}` : request.status, records: refs([requestId]), lastEvent: last(["request"]), recordedAt: request.archive?.approvedAt || request.createdAt },
    { name: "Purchasing", progress: active.length ? statuses : `${state.quotes.filter(value => value.mrfId === requestId).length} quotations · no active POs`, records: refs(active.map(value => value.id)), lastEvent: last(["quote", "po", "allocation", "comparison"]), recordedAt: newest(pos.flatMap(value => [value.createdAt, value.reviewedAt, value.issuance?.at, value.releasedAt])) },
    ...(transfers.length ? [{ name: "Site stock transfers", progress: transfers.length + " proposals / " + transferTrips.filter(delivery => delivery.status === "dispatched").length + " in transit / " + transferTrips.filter(delivery => delivery.status === "posted").length + " trips posted", records: refs([...transfers.map(value => value.id), ...transferTrips.map(value => value.id)]), recordedAt: newest(transferTrips.map(value => value.updatedAt)) }] : []),
    { name: "Payment", progress: transferOnly ? "Not applicable / existing site stock" : `${paidTotalFor(approved.map(value => value.id), state).toLocaleString("en-PH")} PHP recorded / ${approved.reduce((total, po) => total + poTotal(state, po), 0).toLocaleString("en-PH")} PHP approved PO value`, records: refs([...payments.map(value => value.id), ...approved.filter(value => value.externalPayment || value.creditPayments?.length).map(value => value.id)]), lastEvent: events.find(value => value.eventType?.startsWith("payment") || value.eventType?.startsWith("proof") || value.eventType === "payment.recorded" || ["payment-request", "payment"].includes(value.entityType || records.get(value.entity)?.type || "")), recordedAt: newest([...payments.flatMap(value => [value.createdAt, value.reviewedAt, value.disbursedAt]), ...approved.flatMap(value => [value.externalPayment?.verifiedAt, ...(value.creditPayments || []).flatMap(payment => [payment.verifiedAt, payment.voided?.at])])]) },
    { name: "Delivery", progress: `${allReceived ? "Fully received" : hasReceipts ? "Partly received" : "Not received"} · ${scheduled + transferScheduled} scheduled · ${inTransit + transferTransit} in transit · ${warehouseHeld} receipts held at warehouse · ${received + transferReceived} awaiting stock posting · ${posted + transferPosted} posted${openLines ? ` · ${openLines} open material lines` : ""}`, records: refs([...batches, ...transferTrips].map(value => value.id)), lastEvent: last(["batch", "evidence", "movement"]), recordedAt: newest([...batches, ...transferTrips].flatMap(value => [value.createdAt,value.dispatchedAt,value.receivedAt,value.postedAt])) },
  ];
  return { events, stages, records };
}
function paidTotalFor(poIds: string[], state: DemoSnapshot) { return poIds.reduce((total, id) => total + paidTotal(state, id), 0); }

export type AuditGroup = { id: string; entries: Activity[] };
export function groupAuditEvents(events: Activity[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  for (const event of events) {
    const group = groups.at(-1), previous = group?.entries.at(-1);
    const gap = previous ? Date.parse(previous.at) - Date.parse(event.at) : NaN;
    const identity = event.actorIdentity, previousIdentity = previous?.actorIdentity;
    if (group && previous && event.eventType === "quote.draft.updated" && previous.eventType === event.eventType && event.entity === previous.entity && identity && previousIdentity && identity.email === previousIdentity.email && identity.role === previousIdentity.role && identity.name === previousIdentity.name && gap >= 0 && gap <= 60_000) group.entries.push(event);
    else groups.push({ id: event.id, entries: [event] });
  }
  return groups;
}
