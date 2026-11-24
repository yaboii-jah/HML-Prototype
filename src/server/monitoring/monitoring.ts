import "server-only";
import { parseMonitoringView, type MonitoringFilters, type MonitoringMode } from "@/src/domain/monitoring/contracts";
import { readSession } from "@/src/server/auth/session";
import { ServiceCommandError, serviceRpc } from "@/src/server/auth/service-rpc";

type CurrentSession = NonNullable<Awaited<ReturnType<typeof readSession>>>;

export async function monitoringView<M extends MonitoringMode>(current: CurrentSession, mode: M, filters: MonitoringFilters = {}) {
  const { activeRole, context, sessionId } = current;
  if (!activeRole || mode === "reports" && activeRole === "Site Personnel") throw new ServiceCommandError("42501");
  const viewer = { userId: context.userId, revision: context.revision, sessionId, activeRole };
  const raw = await serviceRpc("monitoring_read", { viewer, mode, filters });
  if (raw === null && mode === "lifecycle") return null;
  const result = parseMonitoringView(mode, raw);
  if (!result) throw new Error("Monitoring data could not be checked.");
  return result;
}

export async function initialMonitoringView<M extends MonitoringMode>(mode: M, filters?: MonitoringFilters) {
  const current = await readSession();
  return current?.activeRole ? monitoringView(current, mode, filters).catch(() => null) : null;
}
