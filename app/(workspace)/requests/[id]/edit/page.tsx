import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { requestView } from "@/src/server/requests/drafts";
import { SharedRequests } from "@/src/features/requests/SharedRequests";
export default async function Page({ params }: { params: Promise<{ id?: string }> }) {
  await requireWorkspaceSession();
  const { id } = await params;
  const initial = await requestView(id);
  if (!initial) redirect("/sign-in");
  return <SharedRequests initial={initial} mode="edit" id={id} />;
}
