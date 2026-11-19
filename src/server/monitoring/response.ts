import "server-only";
import { consumptionCsv, monitoringMode, parseMonitoringFilters } from "@/src/domain/monitoring/contracts";
import { readSession } from "@/src/server/auth/session";
import { ServiceCommandError } from "@/src/server/auth/service-rpc";
import { sameApplicationOrigin } from "@/src/server/request-origin";
import { monitoringView } from "./monitoring";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "Referrer-Policy": "no-referrer" };
const errorResponse = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function monitoringResponse(request: Request, download = false) {
  if (!sameApplicationOrigin(request)) return errorResponse(403, "Same-origin access required.");
  try {
    const current = await readSession();
    if (!current) return errorResponse(401, "Sign in again to continue.");
    if (!current.activeRole) return errorResponse(409, "Choose a current role.");
    const query = new URL(request.url).searchParams;
    const mode = download ? "consumption" : monitoringMode(query.get("mode"));
    const filters = mode && parseMonitoringFilters(mode, query);
    if (!mode || !filters) return errorResponse(400, "Check the selected filters.");
    if (download) {
      const result = await monitoringView(current, "consumption", filters);
      if (!result) return errorResponse(404, "Consumption is unavailable.");
      return new Response(consumptionCsv(result.rows), { headers: {
        ...headers, "Content-Type": "text/csv; charset=utf-8; header=present",
        "Content-Disposition": `attachment; filename="consumption-${filters.from}-to-${filters.to}.csv"`,
        "X-Content-Type-Options": "nosniff",
      }});
    }
    const view = await monitoringView(current, mode, filters);
    if (!view) return errorResponse(404, "This record is unavailable.");
    const { userId, revision } = current.context;
    return Response.json({ view, userId, revision, role: current.activeRole }, { headers });
  } catch (error) {
    if (error instanceof ServiceCommandError && error.code === "42501") {
      return errorResponse(403, "This view is unavailable for your current role or project assignment.");
    }
    return errorResponse(503, "Updates could not be checked. Try again.");
  }
}
