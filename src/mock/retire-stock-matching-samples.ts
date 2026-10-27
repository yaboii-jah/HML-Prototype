import type { DemoSnapshot } from "../domain/types.ts";

const projectIds = new Set(["stock-matching-samples-v1-source", "stock-matching-samples-v1-destination"]);
const currentKey = "hml-constructsync-demo-v12";
const usersKey = "hml-constructsync-users-v1";
const pendingFilesKey = "hml-constructsync-retired-stock-samples-files-v1";
const fileKeys = new Set(["fileId", "driveFileId", "localFileId", "formFileId", "supportFileId"]);

function references(value: unknown, field: (key: string) => boolean, result = new Set<string>()) {
  if (!value || typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && field(key)) result.add(child);
    else if (child && typeof child === "object") references(child, field, result);
  }
  return result;
}

/** Remove only the retired two-project sample pack, including later test activity. */
export function withoutStockMatchingSamples(state: DemoSnapshot) {
  const requests = new Set(state.requests.filter(request => projectIds.has(request.siteId)).map(request => request.id));
  const present = state.sites.some(site => projectIds.has(site.id)) || requests.size > 0;
  if (!present) return { snapshot: state, fileIds: [] as string[], requestIds: [] as string[], changed: false };
  if (state.stockTransfers?.some(transfer => (projectIds.has(transfer.sourceSiteId) || projectIds.has(transfer.destinationSiteId)) && (!projectIds.has(transfer.sourceSiteId) || !projectIds.has(transfer.destinationSiteId))) || state.stockSuitabilityReviews?.some(review => (projectIds.has(review.sourceSiteId) || projectIds.has(review.destinationSiteId)) && (!projectIds.has(review.sourceSiteId) || !projectIds.has(review.destinationSiteId)))) {
    throw new Error("The stock-transfer samples are linked to another project. Existing records have been preserved; remove those test links before retrying cleanup.");
  }
  const pos = new Set(state.pos.filter(po => requests.has(po.mrfId)).map(po => po.id));
  const batches = new Set(state.batches.filter(batch => pos.has(batch.poId)).map(batch => batch.id));
  const transfers = new Set((state.stockTransfers || []).filter(transfer => requests.has(transfer.requestId)).map(transfer => transfer.id));
  const removed: unknown[] = [];
  const keep = <T,>(values: T[], drop: (value: T) => boolean) => values.filter(value => { if (!drop(value)) return true; removed.push(value); return false; });
  const next: DemoSnapshot = {
    ...state,
    sites: keep(state.sites, site => projectIds.has(site.id)),
    scopes: keep(state.scopes, scope => projectIds.has(scope.siteId)),
    requests: keep(state.requests, request => requests.has(request.id)),
    quotes: keep(state.quotes, quote => requests.has(quote.mrfId)),
    pos: keep(state.pos, po => pos.has(po.id)),
    batches: keep(state.batches, batch => batches.has(batch.id)),
    paymentRequests: keep(state.paymentRequests, payment => pos.has(payment.poId)),
    payments: keep(state.payments, payment => pos.has(payment.poId)),
    accounting: keep(state.accounting, record => pos.has(record.poId)),
    pendingAwards: keep(state.pendingAwards, award => requests.has(award.requestId)),
    bidReports: keep(state.bidReports, report => requests.has(report.requestId)),
    movements: keep(state.movements, movement => projectIds.has(movement.siteId) || transfers.has(movement.transferId || "") || batches.has(movement.batchId || "")),
  };
  if (state.stockTransfers) next.stockTransfers = keep(state.stockTransfers, transfer => transfers.has(transfer.id));
  if (state.transferDeliveries) next.transferDeliveries = keep(state.transferDeliveries, delivery => transfers.has(delivery.transferId));
  if (state.stockSuitabilityReviews) next.stockSuitabilityReviews = keep(state.stockSuitabilityReviews, review => requests.has(review.requestId));
  if (state.usageEntries) next.usageEntries = keep(state.usageEntries, entry => projectIds.has(entry.siteId));
  const removedIds = references(removed, key => key === "id");
  next.activity = state.activity.filter(event => !event.id.startsWith("stock-matching-samples-v1-") && !removedIds.has(event.entity) && !projectIds.has(event.projectId || "") && !requests.has(event.requestId || "") && !pos.has(event.poId || "") && !event.relatedProjectIds?.some(id => projectIds.has(id)));
  if (projectIds.has(next.siteFilter)) next.siteFilter = "all";
  const remainingFiles = references(next, key => fileKeys.has(key));
  if (next.showcase?.installationId === "stock-matching-samples-v1" && !next.sites.some(site => site.localArchiveId === next.showcase!.installationId) && ![...remainingFiles].some(id => id.startsWith("local-stock-matching-samples-v1-"))) delete next.showcase;
  return { snapshot: next, fileIds: [...references(removed, key => fileKeys.has(key))].filter(id => !remainingFiles.has(id)), requestIds: [...requests], changed: true };
}

export async function retireStockMatchingSamples(storage: Storage, removeFiles: (ids: string[]) => Promise<void>) {
  const raw = storage.getItem(currentKey), rawUsers = storage.getItem(usersKey), pending = storage.getItem(pendingFilesKey);
  if (!raw || !raw.includes("stock-matching-samples-v1") && !rawUsers?.includes("stock-matching-samples-v1") && !pending) return false;
  const { parseCurrent } = await import("./repository.ts");
  const state = parseCurrent(raw);
  if (!state) throw new Error("Saved workspace data could not be validated. Sample cleanup has preserved the existing records.");
  const cleaned = withoutStockMatchingSamples(state);
  if (!parseCurrent(JSON.stringify(cleaned.snapshot))) throw new Error("Sample cleanup would leave invalid records. Existing data has been preserved.");
  let directoryChanged = false;
  const directory = rawUsers ? JSON.parse(rawUsers) : null;
  if (directory) {
    if (!Array.isArray(directory.users)) throw new Error("User accounts could not be read. Sample cleanup has preserved the existing accounts.");
    directory.users = directory.users.map((user: { siteIds?: string[]; revision: number }) => {
      if (!user.siteIds?.some(id => projectIds.has(id))) return user;
      if (!Number.isInteger(user.revision)) throw new Error("The test user's account could not be validated.");
      directoryChanged = true;
      return { ...user, siteIds: user.siteIds.filter(id => !projectIds.has(id)), revision: user.revision + 1 };
    });
  }
  const previousPending: unknown = pending ? JSON.parse(pending) : [];
  if (!Array.isArray(previousPending) || previousPending.some(id => typeof id !== "string")) throw new Error("The pending sample-document cleanup could not be read.");
  const remainingFiles = references(cleaned.snapshot, key => fileKeys.has(key));
  const fileIds = [...new Set<string>([...previousPending, ...cleaned.fileIds])].filter(id => !remainingFiles.has(id));
  const changes: [string, string][] = [];
  if (fileIds.length) changes.push([pendingFilesKey, JSON.stringify(fileIds)]);
  if (cleaned.changed) changes.push([currentKey, JSON.stringify(cleaned.snapshot)]);
  if (directoryChanged) changes.push([usersKey, JSON.stringify(directory)]);
  if (storage.getItem(currentKey) !== raw || storage.getItem(usersKey) !== rawUsers || storage.getItem(pendingFilesKey) !== pending) throw new Error("The workspace changed during sample cleanup. Reload to preserve the latest records.");
  const previous = new Map(changes.map(([key]) => [key, storage.getItem(key)]));
  try { for (const [key, value] of changes) storage.setItem(key, value); }
  catch (cause) {
    for (const [key, value] of [...previous].reverse()) { try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Preserve the original write failure for retry. */ } }
    throw cause;
  }
  const sampleDraftIds = new Set([...projectIds, ...cleaned.requestIds]);
  for (const key of Array.from({ length: storage.length }, (_, index) => storage.key(index))) {
    if (key && (key.startsWith("constructsync-stock-draft-v1/") || key.startsWith("constructsync-usage-draft-v1/")) && (sampleDraftIds.has(key.split("/").at(-1)!) || key.split("/").at(-1)!.startsWith("stock-matching-samples-v1-"))) storage.removeItem(key);
  }
  if (fileIds.length) await removeFiles(fileIds);
  if (pending || fileIds.length) storage.removeItem(pendingFilesKey);
  return cleaned.changed || directoryChanged || !!pending;
}
