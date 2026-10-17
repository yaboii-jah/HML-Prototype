import type { DemoSnapshot } from "./types.ts";

export type LocalArchiveFile = { id: string; name: string; ownerId: string; projectId: string; purchasingOnly: boolean };
/** Resolve only current record-owned artifacts, never arbitrary IndexedDB keys. */
export function localArchiveFiles(state: DemoSnapshot): LocalArchiveFile[] {
  if (!state.showcase) return [];
  const files = new Map<string, LocalArchiveFile>();
  const prefix = `local-${state.showcase.installationId}-`;
  const visit = (value: unknown, ownerId: string, projectId: string, name: string, purchasingOnly = false) => {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const label = typeof object.name === "string" ? object.name : typeof object.fileName === "string" ? object.fileName : name;
    for (const [key, child] of Object.entries(object)) {
      if (["fileId", "driveFileId", "localFileId", "formFileId", "supportFileId"].includes(key) && typeof child === "string" && child.startsWith(prefix)) files.set(child, { id: child, name: /\.(pdf|xlsx|png|jpe?g|webp)$/i.test(label) ? label : `${label}.pdf`, ownerId, projectId, purchasingOnly });
      // Frozen receipt/report inputs are context, not permission to browse the
      // embedded request's or quotation's separate documents.
      else if (key !== "data" && typeof child === "object") visit(child, ownerId, projectId, label, purchasingOnly);
    }
  };
  for (const request of state.requests) {
    visit(request, request.id, request.siteId, request.ref || "Supporting request");
    for (const quote of state.quotes.filter(q => q.mrfId === request.id)) visit(quote, request.id, request.siteId, quote.ref, true);
    for (const report of state.bidReports.filter(r => r.requestId === request.id)) visit(report, request.id, request.siteId, report.fileName, true);
    for (const po of state.pos.filter(p => p.mrfId === request.id)) {
      visit(po, po.id, request.siteId, po.ref);
      for (const record of state.accounting.filter(r => r.poId === po.id)) visit(record, po.id, request.siteId, po.ref);
      for (const batch of state.batches.filter(b => b.poId === po.id)) visit(batch, po.id, request.siteId, batch.ref);
    }
    for (const transfer of (state.stockTransfers || []).filter(t => t.requestId === request.id)) {
      visit(transfer, transfer.id, request.siteId, transfer.ref);
      for (const delivery of (state.transferDeliveries || []).filter(d => d.transferId === transfer.id)) visit(delivery, transfer.id, request.siteId, delivery.ref);
    }
  }
  return [...files.values()];
}
