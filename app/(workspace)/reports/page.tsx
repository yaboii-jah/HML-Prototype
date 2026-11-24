import { notFound } from "next/navigation";
import { OperationsReports } from "@/src/features/monitoring/OperationsReports";
import { initialMonitoringView } from "@/src/server/monitoring/monitoring";
import { requireWorkspaceSession } from "@/src/server/auth/session";

export default async function Page() {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") notFound();
  return <OperationsReports initial={await initialMonitoringView("reports")} />;
}
