import { workflowActions } from "./workflow-actions.ts";
import { daysWaiting } from "./format.ts";
import { budgetFor, inventoryFor, outstandingFor, requestForPO } from "./selectors.ts";
import { coordinatedPOs } from "./payment-coordination.ts";
import { isExternalPayment } from "./full-disbursement.ts";
import { accountingNextAction } from "./workflow.ts";
import { transferUnscheduled } from "./stock-transfers.ts";
import type { DemoSnapshot } from "./types.ts";

export type Task = { title: string; detail: string; href: string; siteId?: string; waiting: number };
export function tasksFor(state: DemoSnapshot, siteIds?: readonly string[]): Task[] {
  const actions = workflowActions(state);
  const tasks: Task[] = actions.filter(a => a.department === state.role && a.state === "ready").map(a => ({ title: a.label.replace("Dispatch: ", "Dispatch ").replace("Forward: ", "Forward "), detail: a.detail, href: a.href, siteId: a.siteId, waiting: daysWaiting(a.since) }));
  if (["Administrator", "Project Manager"].includes(state.role)) {
    const seen = new Set<string>();
    for (const action of actions.filter(a => a.attention && a.department !== state.role)) {
      if (seen.has(action.recordId)) continue;
      seen.add(action.recordId);
      tasks.push({ title: `Exception: ${action.label}`, detail: action.blocker || action.detail, href: action.href, siteId: action.siteId, waiting: daysWaiting(action.since) });
    }
  }
  if (state.role === "Site Personnel") for (const site of state.sites) for (const item of inventoryFor(state, site.id)) {
    const reference = Math.max(0, ...state.requests.filter(r => r.siteId === site.id).flatMap(r => r.items.filter(i => i.name.toLowerCase() === item.name.toLowerCase() && i.unit.toLowerCase() === item.unit.toLowerCase()).map(i => i.quantity)));
    if (reference > 0 && item.onHand <= reference * .2) tasks.push({ title: `Low stock: ${item.name}`, detail: `${site.name} / ${item.onHand} ${item.unit} on hand`, href: `/inventory/${site.id}/${item.id}`, siteId: site.id, waiting: 0 });
  }
  return tasks.filter(task => state.role !== "Site Personnel" || siteIds === undefined || !!task.siteId && siteIds.includes(task.siteId)).filter(task => state.siteFilter === "all" || !task.siteId || task.siteId === state.siteFilter);
}
export function dashboardMetrics(state: DemoSnapshot, canReadProject: (id?: string) => boolean = () => true) {
  const matches = (siteId?: string) => canReadProject(siteId) && (state.siteFilter === "all" || siteId === state.siteFilter);
  const requests = state.requests.filter(r => matches(r.siteId));
  const pos = state.pos.filter(p => matches(requestForPO(state,p)?.siteId));
  return {
    procurementReviews: requests.filter(r => r.status === "submitted" || r.correction?.status === "submitted").length,
    externalVerifications: pos.filter(p => isExternalPayment(p) && ["approved","released"].includes(p.status) && !!p.issuance && (p.status === "approved" || accountingNextAction(state,p).toLowerCase().includes("payment"))).length,
    accountingReviews: pos.filter(p => ["submitted", "hold"].includes(p.status)).length,
    financeCoordination: coordinatedPOs(state).filter(po => pos.some(value => value.id === po.id)).length,
    financeReviews: state.paymentRequests.filter(p => !isExternalPayment(state.pos.find(po => po.id === p.poId)) && ["submitted", "hold", "approved"].includes(p.status) && pos.some(po => po.id === p.poId)).length,
    openDeliveryLines: (state.stockTransfers || []).filter(transfer => matches(transfer.destinationSiteId) && transfer.status === "approved").reduce((total, transfer) => total + transfer.lines.filter(line => transferUnscheduled(state, transfer, line.id) > 0 || (state.transferDeliveries || []).some(delivery => delivery.transferId === transfer.id && ["expected", "dispatched"].includes(delivery.status) && delivery.lines.some(value => value.transferLineId === line.id))).length, 0) + pos.filter(p => p.status === "released").reduce((sum,p) => sum + (requestForPO(state,p)?.items.filter(item => outstandingFor(state,p,item.id) > 0).length || 0), 0),
    commitment: state.sites.filter(s=>matches(s.id)).reduce((sum,s)=>sum+budgetFor(state,s.id).committed,0),
  };
}
