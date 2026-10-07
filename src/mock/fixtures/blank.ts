import type { DemoSnapshot } from "../../domain/types.ts";

export function blankWorkspace(): DemoSnapshot {
  return {
    version: 12,
    paymentRequests: [],
    bidReports: [],
    role: "Site Personnel",
    siteFilter: "all",
    sites: [],
    scopes: [],
    suppliers: [],
    categories: [],
    requests: [],
    quotes: [],
    pendingAwards: [],
    pos: [],
    batches: [],
    movements: [],
    payments: [],
    accounting: [],
    activity: [],
  };
}
