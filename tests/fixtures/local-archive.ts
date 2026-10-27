import { seedDemo } from "./workspace.ts";
import { blankWorkspace } from "../../src/mock/blank-workspace.ts";
import { localArchiveUrl } from "../../src/domain/archive-destination.ts";
import { captureBidReport } from "../../src/domain/bid-reports.ts";
import type { BidReport } from "../../src/domain/types.ts";

/** One request is sufficient to exercise installation ownership and report source links. */
export function localArchiveFixture(installationId: string, now = new Date("2026-10-15T08:00:00Z")) {
  const seed = seedDemo(), snapshot = blankWorkspace();
  snapshot.showcase = { installationId, seededAt: now.toISOString(), revision: 1 };
  snapshot.sites = [{ ...seed.sites[0], localArchiveId: installationId }];
  snapshot.scopes = seed.scopes.filter(scope => scope.siteId === snapshot.sites[0].id);
  snapshot.categories = seed.categories;
  const request = structuredClone(seed.requests[0]);
  const form = `local-${installationId}-form`, support = `local-${installationId}-support`;
  request.documents = [{ name: "Synthetic supporting MRF.pdf", type: "Supporting PDF", fileId: support }];
  request.archive = { status: "complete", approvedAt: now.toISOString(), versions: [{ version: 1, formFileId: form, supportFileId: support, formUrl: localArchiveUrl(form), supportUrl: localArchiveUrl(support), archivedAt: now.toISOString() }] };
  snapshot.requests = [request];
  snapshot.quotes = seed.quotes.filter(quote => quote.mrfId === request.id).map((quote, index) => {
    const fileId = `local-${installationId}-quote-${index}`;
    return { ...quote, documents: [{ name: "Synthetic quotation.pdf", type: "application/pdf", fileId }], archive: { status: "complete" as const, files: [{ localFileId: fileId, driveFileId: fileId, url: localArchiveUrl(fileId), name: "Synthetic quotation.pdf" }] } };
  });
  snapshot.suppliers = seed.suppliers.filter(supplier => snapshot.quotes.some(quote => quote.supplierId === supplier.id));
  snapshot.pos = seed.pos.filter(po => po.mrfId === request.id).slice(0, 1);
  const report: BidReport = { id: "fixture-report", requestId: request.id, version: 1, generatedAt: now.toISOString(), fileName: "synthetic-comparison.xlsx", data: captureBidReport(snapshot, request.id), archive: { status: "pending" } };
  snapshot.bidReports = [report];
  return { snapshot, documents: [{ id: form }, { id: support }] };
}
