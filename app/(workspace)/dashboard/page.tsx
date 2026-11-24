import { Dashboard } from "@/src/features/monitoring/Dashboard";
import { initialMonitoringView } from "@/src/server/monitoring/monitoring";
import { requireWorkspaceSession } from "@/src/server/auth/session";

export default async function Page() {
  await requireWorkspaceSession();
  const [initial, progress] = await Promise.all([
    initialMonitoringView("dashboard"), initialMonitoringView("dashboardProgress"),
  ]);
  return <Dashboard initial={initial} progress={progress} />;
}
