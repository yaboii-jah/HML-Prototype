import { daysWaiting } from "./format.ts";
import { procurementReady } from "./request-archive.ts";
import { budgetFor, inventoryFor, orderedFor, outstandingFor, poTotal, requestForPO, siteName } from "./selectors.ts";
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
    ...state.requests.filter(r => r.status === "returned" || r.correction?.status === "requested").map(r => ({ title: `Revise ${r.ref}`, detail: r.correction?.reason || r.reason || "Returned by PM", href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.batches.filter(b => b.status === "expected" || b.status === "confirmed").map(b => ({ title: `Receive ${b.ref}`, detail: b.status === "confirmed" ? "Review stock posting" : "Confirm quantities", href: `/deliveries/${b.id}`, siteId: requestForPO(state, state.pos.find(p => p.id === b.poId)!)?.siteId, waiting: daysWaiting(b.updatedAt) })),
    ...stockTasks,
  ] : role === "Project Manager" ? [...requestTasks, ...state.requests.filter(r => r.archive?.status === "pending").map(r => ({ title: `Archive ${r.ref}`, detail: r.archive?.error || "Upload approved PDFs to Drive", href: `/requests/${r.id}`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) }))] : role === "Procurement" ? [
    ...state.requests.filter(r => procurementReady(r) && r.items.some(item => state.pos.filter(po => po.mrfId === r.id && po.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, item.id), 0) < item.quantity)).map(r => ({ title: `Source ${r.ref}`, detail: "Compare supplier quotes and unawarded materials", href: `/requests/${r.id}/quotes`, siteId: r.siteId, waiting: daysWaiting(r.updatedAt) })),
    ...state.pos.filter(p => ["draft", "returned", "approved"].includes(p.status)).map(p => ({ title: `${p.status === "approved" ? "Serve" : "Prepare"} ${p.ref}`, detail: p.status, href: `/purchase-orders/${p.id}`, siteId: requestForPO(state, p)?.siteId, waiting: daysWaiting(p.updatedAt) })),
  ] : role === "Finance" ? state.pos.filter(p => ["finalized", "hold"].includes(p.status)).map(p => ({ title: `Review ${p.ref}`, detail: `${poTotal(state,p).toLocaleString("en-PH")} · ${p.priority}`, href: `/finance/${p.id}`, siteId: requestForPO(state, p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : role === "Logistics" ? state.pos.filter(p => p.status === "served" && requestForPO(state, p)?.items.some(item => outstandingFor(state,p,item.id) > 0)).map(p => ({ title: `Track ${p.ref}`, detail: "Schedule or monitor delivery", href: `/purchase-orders/${p.id}`, siteId: requestForPO(state,p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : role === "Accounting / Auditing" ? state.pos.filter(p => ["approved", "served"].includes(p.status)).map(p => ({ title: `Review ${p.ref}`, detail: state.accounting.find(a=>a.poId===p.id)?.review || "Missing documents", href: `/accounting/${p.id}`, siteId: requestForPO(state,p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : role === "Management" ? state.pos.filter(p => ["hold", "returned"].includes(p.status)).map(p => ({ title: `Exception on ${p.ref}`, detail: p.reviewReason || p.status, href: `/purchase-orders/${p.id}`, siteId: requestForPO(state,p)?.siteId, waiting: daysWaiting(p.updatedAt) })) : [{ title: "Review workspace settings", detail: "Assignments and activity", href: "/admin", waiting: 0 }];
  return tasks.filter(task => state.siteFilter === "all" || !task.siteId || task.siteId === state.siteFilter);
}
export function dashboardMetrics(state: DemoSnapshot) {
  const matches = (siteId?: string) => state.siteFilter === "all" || siteId === state.siteFilter;
  const requests = state.requests.filter(r => matches(r.siteId));
  const pos = state.pos.filter(p => matches(requestForPO(state,p)?.siteId));
  return {
    pmReviews: requests.filter(r => r.status === "submitted" || r.correction?.status === "submitted").length,
    financeReviews: pos.filter(p => ["finalized", "hold"].includes(p.status)).length,
    openDeliveryLines: pos.filter(p => p.status === "served").reduce((sum,p) => sum + (requestForPO(state,p)?.items.filter(item => outstandingFor(state,p,item.id) > 0).length || 0), 0),
    commitment: state.sites.filter(s=>matches(s.id)).reduce((sum,s)=>sum+budgetFor(state,s.id).committed,0),
  };
}
