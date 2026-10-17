import { localArchiveFiles } from "./local-files.ts";
import type { Activity, DemoSnapshot, OperationTarget, Role } from "./types.ts";

/** Presentation permissions. The full snapshot remains authoritative for commands and calculations. */
export function createReadAccess(state: DemoSnapshot | null | undefined, role: Role | null | undefined, assignments: readonly string[] = []) {
  const sitePersonnel = role === "Site Personnel";
  const projectIds = (state?.sites || []).filter(site => !sitePersonnel || assignments.includes(site.id)).map(site => site.id);
  const assigned = new Set(projectIds);
  const canReadProject = (id?: string) => !!role && !!id && assigned.has(id);
  const ownership = new Map<string, string[]>();
  const add = (id: string, ...projects: (string | undefined)[]) => ownership.set(id, projects.filter((value): value is string => !!value));
  const requestProject = (id?: string) => state?.requests.find(request => request.id === id)?.siteId;
  const poProject = (id?: string) => requestProject(state?.pos.find(po => po.id === id)?.mrfId);
  const transferProjects = (id?: string) => {
    const transfer = state?.stockTransfers?.find(value => value.id === id);
    return transfer ? [transfer.sourceSiteId, transfer.destinationSiteId] : [];
  };
  if (state) {
    for (const site of state.sites) add(site.id, site.id);
    for (const scope of state.scopes) add(scope.id, scope.siteId);
    for (const request of state.requests) add(request.id, request.siteId);
    for (const quote of state.quotes) add(quote.id, requestProject(quote.mrfId));
    for (const po of state.pos) {
      add(po.id, requestProject(po.mrfId));
      for (const proof of po.paymentProofs || []) add(proof.id, requestProject(po.mrfId));
    }
    for (const batch of state.batches) {
      add(batch.id, poProject(batch.poId));
      for (const receipt of batch.receiptVersions || []) add(receipt.id, poProject(batch.poId));
    }
    for (const record of state.accounting) for (const document of record.documents || []) add(document.id, poProject(record.poId));
    for (const payment of [...state.paymentRequests, ...state.payments]) add(payment.id, poProject(payment.poId));
    for (const report of state.bidReports) add(report.id, requestProject(report.requestId));
    for (const award of state.pendingAwards) add(award.id, requestProject(award.requestId));
    for (const review of state.stockSuitabilityReviews || []) add(review.id, review.destinationSiteId);
    for (const transfer of state.stockTransfers || []) {
      add(transfer.id, transfer.sourceSiteId, transfer.destinationSiteId);
      for (const document of transfer.documents || []) add(document.id, transfer.sourceSiteId, transfer.destinationSiteId);
    }
    for (const delivery of state.transferDeliveries || []) {
      add(delivery.id, ...transferProjects(delivery.transferId));
      for (const receipt of delivery.receiptVersions || []) add(receipt.id, ...transferProjects(delivery.transferId));
    }
    for (const entry of state.usageEntries || []) add(entry.id, entry.siteId);
    for (const movement of state.movements) add(movement.id, movement.siteId);
  }
  const canReadRecord = (id?: string) => !!role && (!sitePersonnel || !!id && (ownership.get(id) || []).some(canReadProject));
  const canReadActivity = (event: Activity) => !!role && (!sitePersonnel || canReadRecord(event.entity)
    || canReadProject(event.projectId) || event.relatedProjectIds?.some(canReadProject)
    || canReadProject(requestProject(event.requestId)) || canReadProject(poProject(event.poId)));
  const canReadTarget = (target?: OperationTarget) => {
    if (!role) return false;
    if (!sitePersonnel) return true;
    if (!target || target.kind === "report") return false;
    if ("id" in target) return canReadRecord(target.id);
    if ("transferId" in target) return canReadRecord(target.transferId);
    if ("deliveryId" in target) return canReadRecord(target.deliveryId);
    if ("poId" in target) return canReadProject(poProject(target.poId));
    return canReadRecord(target.batchId);
  };
  const canOpen = (href: string) => {
    if (!role) return false;
    let url: URL;
    try { url = new URL(href, "http://constructsync.local"); } catch { return false; }
    if (url.origin !== "http://constructsync.local") return false;
    let parts: string[];
    try { parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { return false; }
    const [section, id, subpage] = parts;
    if (section === "admin" && role !== "Administrator") return false;
    if (section === "reports" && !["Project Manager", "Administrator"].includes(role)) return false;
    if (!sitePersonnel) return true;
    if (section === "demo-files" && parts.length === 2 && state) { const file = localArchiveFiles(state).find(file => file.id === id); return !!file && !file.purchasingOnly && canReadRecord(file.ownerId); }
    if (parts.length === 1) return ["dashboard", "projects", "requests", "deliveries", "inventory"].includes(section);
    if (section === "projects" && parts.length === 2) return canReadProject(id);
    if (section === "requests") {
      if (id === "new") return parts.length === 2 && projectIds.length > 0;
      return (parts.length === 2 || parts.length === 3 && subpage === "edit") && canReadProject(requestProject(id));
    }
    if (section === "purchase-orders" && parts.length === 2) return canReadProject(poProject(id));
    if (section === "deliveries" && parts.length === 2 && id !== "new") return canReadProject(poProject(state?.batches.find(batch => batch.id === id)?.poId));
    if (section === "inventory" && id === "usage" && parts.length === 3) return subpage === "new" ? projectIds.length > 0 : canReadRecord(subpage);
    if (section === "inventory" && parts.length === 3) return canReadProject(id);
    if (section === "stock-transfers" && parts.length === 2) return transferProjects(id).some(canReadProject);
    return false;
  };
  return {
    sitePersonnel,
    showBudgets: !!role && !sitePersonnel,
    projectIds,
    siteFilter: !sitePersonnel || state?.siteFilter === "all" || canReadProject(state?.siteFilter) ? state?.siteFilter || "all" : "all",
    canReadProject, canReadRecord, canReadActivity, canReadTarget, canOpen,
  };
}

export type ReadAccess = ReturnType<typeof createReadAccess>;
