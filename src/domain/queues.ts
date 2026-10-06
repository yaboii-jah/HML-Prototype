import { isSiteBatch, legFor, warehouseAvailableFor } from "./delivery-flow.ts";
import { accountingNextAction } from "./workflow.ts";
import { daysWaiting } from "./format.ts";
import { procurementReady } from "./request-archive.ts";
import { budgetFor, inventoryFor, orderedFor, outstandingFor, requestForPO, siteName } from "./selectors.ts";
import type { DemoSnapshot } from "./types.ts";

export type Task = { title: string; detail: string; href: string; siteId?: string; waiting: number };
export function tasksFor(state: DemoSnapshot): Task[] {
  const requestTasks = state.requests.filter(r => r.status === "submitted" || r.correction?.status === "submitted").map(r => ({ title: `Review ${r.ref}`, detail: siteName(state, r.siteId), href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) }));
  const stockTasks = state.sites.flatMap(site => inventoryFor(state, site.id).filter(item => {
    const reference = Math.max(0, ...state.requests.filter(r => r.siteId === site.id).flatMap(r => r.items.filter(i => i.name.toLowerCase() === item.name.toLowerCase() && i.unit.toLowerCase() === item.unit.toLowerCase()).map(i => i.quantity)));
    return reference > 0 && item.onHand <= reference * 0.2;
  }).map(item => ({ title: `Low stock: ${item.name}`, detail: `${site.name} / ${item.onHand} ${item.unit} on hand`, href: `/inventory/${site.id}/${item.id}`, siteId: site.id, waiting: 0 })));
  const role = state.role;
  const tasks: Task[] = role === "Site Personnel" ? [
    ...state.requests.filter(r => r.status === "draft").map(r => ({ title: `Complete ${r.ref || "unnumbered draft"}`, detail: siteName(state, r.siteId), href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.requests.filter(r => r.status === "returned" || r.correction?.status === "requested").map(r => ({ title: `Revise ${r.ref}`, detail: r.correction?.reason || r.reason || "Returned by Procurement", href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.batches.filter(b => isSiteBatch(b) && (b.status === "dispatched" || !b.leg && b.status === "expected" || b.status === "confirmed")).map(b => ({ title: `Receive ${b.ref}`, detail: b.status === "confirmed" ? "Review stock posting" : "Confirm quantities", href: `/deliveries/${b.id}`, siteId: requestForPO(state, state.pos.find(p => p.id === b.poId)!)?.siteId, waiting: daysWaiting(b.updatedAt) })),
    ...stockTasks,
  ] : role === "Procurement" ? [
    ...state.batches.filter(batch => legFor(batch) === "supplier-warehouse" && batch.status === "dispatched").map(batch => ({ title: `Receive ${batch.ref} at warehouse`, detail: batch.destination?.name || "Company Warehouse", href: `/deliveries/${batch.id}`, siteId: requestForPO(state, state.pos.find(po => po.id === batch.poId)!)?.siteId, waiting: daysWaiting(batch.dispatchedAt || batch.createdAt) })),
    ...requestTasks, ...state.requests.filter(r => r.archive?.status === "pending").map(r => ({ title: `Archive ${r.ref}`, detail: r.archive?.error || "Upload approved PDFs to Drive", href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.requests.filter(r => procurementReady(r) && r.items.some(item => state.pos.filter(po => po.mrfId === r.id && po.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, item.id), 0) < item.quantity)).map(r => ({ title: `Source ${r.ref}`, detail: "Compare supplier quotes and unawarded materials", href: `/requests/${r.id}/quotes`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.pos.filter(p => ["draft", "returned"].includes(p.status)).map(p => ({ title: `Prepare ${p.ref}`, detail: p.status, href: `/purchase-orders/${p.id}`, siteId: requestForPO(state, p)?.siteId, waiting: daysWaiting(p.updatedAt) })),
  ] : role === "Finance" ? state.paymentRequests.filter(p => ["submitted", "hold", "approved"].includes(p.status)).map(p => ({ title: `${p.status === "approved" ? "Disburse" : "Review"} ${p.ref}`, detail: `${p.amount.toLocaleString("en-PH")} / ${p.priority}`, href: `/finance/${p.poId}`, siteId: requestForPO(state, state.pos.find(po => po.id === p.poId)!)?.siteId, waiting: daysWaiting(p.updatedAt) })) : role === "Logistics" ? [
    ...state.pos.filter(po => po.status === "released" && requestForPO(state, po)?.items.some(item => outstandingFor(state,po,item.id) > 0)).map(po => ({ title: `Track ${po.ref}`, detail: "Schedule or monitor delivery", href: `/purchase-orders/${po.id}`, siteId: requestForPO(state,po)?.siteId, waiting: daysWaiting(po.updatedAt) })),
    ...state.batches.filter(batch => batch.status === "expected" || legFor(batch) === "supplier-warehouse" && batch.status === "confirmed" && batch.lines.some(line => warehouseAvailableFor(state,batch.id,line.itemId) > 0)).map(batch => ({ title: `${batch.status === "expected" ? "Dispatch" : "Forward"} ${batch.ref}`, detail: batch.destination?.name || "Delivery batch", href: `/deliveries/${batch.id}`, siteId: requestForPO(state,state.pos.find(po => po.id === batch.poId)!)?.siteId, waiting: daysWaiting(batch.updatedAt) })),
  ] : role === "Accounting / Auditing" ? state.pos.filter(p => ["submitted", "hold", "approved", "released"].includes(p.status) && accountingNextAction(state, p) !== "Up to date").map(p => ({ title: `${accountingNextAction(state, p)}: ${p.ref}`, detail: p.reviewReason || siteName(state, requestForPO(state,p)?.siteId || ""), href: `/accounting/${p.id}`, siteId: requestForPO(state,p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : role === "Management" ? state.pos.filter(p => ["hold", "returned"].includes(p.status)).map(p => ({ title: `Exception on ${p.ref}`, detail: p.reviewReason || p.status, href: `/purchase-orders/${p.id}`, siteId: requestForPO(state,p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : [{ title: "Review workspace settings", detail: "Projects, Drive folders and activity", href: "/admin", waiting: 0 }];
  return tasks.filter(task => state.siteFilter === "all" || !task.siteId || task.siteId === state.siteFilter);
}
export function dashboardMetrics(state: DemoSnapshot) {
  const matches = (siteId?: string) => state.siteFilter === "all" || siteId === state.siteFilter;
  const requests = state.requests.filter(r => matches(r.siteId));
  const pos = state.pos.filter(p => matches(requestForPO(state,p)?.siteId));
  return {
    procurementReviews: requests.filter(r => r.status === "submitted" || r.correction?.status === "submitted").length,
    accountingReviews: pos.filter(p => ["submitted", "hold"].includes(p.status)).length,
    financeReviews: state.paymentRequests.filter(p => ["submitted", "hold", "approved"].includes(p.status) && pos.some(po => po.id === p.poId)).length,
    openDeliveryLines: pos.filter(p => p.status === "released").reduce((sum,p) => sum + (requestForPO(state,p)?.items.filter(item => outstandingFor(state,p,item.id) > 0).length || 0), 0),
    commitment: state.sites.filter(s=>matches(s.id)).reduce((sum,s)=>sum+budgetFor(state,s.id).committed,0),
  };
}
