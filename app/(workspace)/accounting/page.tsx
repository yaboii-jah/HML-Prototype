import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { purchasingDirectory } from "@/src/server/purchasing/purchasing";
import { PoDirectory } from "@/src/features/purchasing/PoDirectory";

export default async function Page() {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") redirect("/projects");
  const records = await purchasingDirectory();
  if (!records) redirect("/projects");
  return <PoDirectory initial={records} accounting />;
}
