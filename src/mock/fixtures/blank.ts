import type { DemoSnapshot } from "../../domain/types.ts";

export function blankWorkspace(): DemoSnapshot {
  return {
    version: 10,
    bidReports: [],
    role: "Site Personnel",
    siteFilter: "all",
    sites: [],
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
