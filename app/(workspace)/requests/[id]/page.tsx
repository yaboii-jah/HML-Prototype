import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { requestView } from "@/src/server/requests/drafts";
import { SharedRequests } from "@/src/features/requests/SharedRequests";
import { initialMonitoringView } from "@/src/server/monitoring/monitoring";
export default async function Page({ params }: { params: Promise<{ id?: string }> }) {
  await requireWorkspaceSession();
  const { id } = await params;
  const initial = await requestView(id);
  if (!initial) redirect("/sign-in");
  const lifecycle = id && initial.requests.some(request => request.id === id)
    ? await initialMonitoringView("lifecycle", { target: id }) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <SharedRequests initial={initial} mode="detail" id={id} today={today} lifecycle={lifecycle} />;
}
