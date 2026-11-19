import { Dashboard } from "@/src/features/monitoring/Dashboard";
import { initialMonitoringView } from "@/src/server/monitoring/monitoring";
import { requireWorkspaceSession } from "@/src/server/auth/session";

export default async function Page() {
  await requireWorkspaceSession();
  return <Dashboard initial={await initialMonitoringView("dashboard")} />;
}
