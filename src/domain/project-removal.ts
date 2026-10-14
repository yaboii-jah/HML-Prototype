import type { DemoSnapshot } from "./types.ts";

export function projectRemovalReason(state: DemoSnapshot, siteId: string, now = Date.now()): string {
  const site = state.sites.find(value => value.id === siteId);
  if (!site) return "Project not found.";
  if (state.stockSuitabilityReviews?.some(value => value.sourceSiteId === siteId || value.destinationSiteId === siteId)) return "Projects referenced by stock suitability reviews cannot be deleted.";
  if (state.stockTransfers?.some(value => value.sourceSiteId === siteId || value.destinationSiteId === siteId)) return "Projects referenced by stock transfers cannot be deleted.";
  if (state.requests.some(value => value.siteId === siteId) || state.movements.some(value => value.siteId === siteId)) return "Projects with material requests or inventory movements cannot be deleted.";
  const folderEvent = state.activity.find(value => value.entity === siteId && (/^project folder/i.test(value.action) || /project.*folder/i.test(value.action)));
  // The request times out after 30 seconds. A reload can lose its acknowledgement;
  // expire that abandoned operation rather than permanently locking an unused project.
  if (folderEvent && ["operation.started", "operation.retried"].includes(folderEvent.eventType || "") && (!Number.isFinite(Date.parse(folderEvent.at)) || now - Date.parse(folderEvent.at) < 90_000)) return "Wait for project folder creation to finish before deleting this project.";
  return "";
}
