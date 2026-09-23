import { materialId } from "./ids.ts";

const area: Record<string, string> = {
  dashboard: "/dashboard", projects: "/projects", requests: "/requests",
  suppliers: "/suppliers", purchase: "/purchase-orders", finance: "/finance",
  deliveries: "/deliveries", inventory: "/inventory", accounting: "/accounting",
  reports: "/reports", admin: "/admin",
};

export function legacyDestination(params: URLSearchParams): string | null {
  const view = params.get("view");
  if (!view || !area[view]) return null;
  const kind = params.get("kind");
  const id = params.get("id");
  if (!kind || !id) return area[view];
  if (kind === "request") return `/requests/${encodeURIComponent(id)}`;
  if (kind === "po") return `${view === "finance" ? "/finance" : view === "accounting" ? "/accounting" : "/purchase-orders"}/${encodeURIComponent(id)}`;
  if (kind === "batch") return `/deliveries/${encodeURIComponent(id)}`;
  if (kind === "site") return `/projects/${encodeURIComponent(id)}`;
  if (kind === "material") {
    const [siteId, name, unit] = id.split("|");
    if (siteId && name && unit) return `/inventory/${encodeURIComponent(siteId)}/${materialId(name, unit)}`;
  }
  return area[view];
}
