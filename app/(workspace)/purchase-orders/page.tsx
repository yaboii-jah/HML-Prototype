import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { purchasingDirectory } from "@/src/server/purchasing/purchasing";
import { PoDirectory } from "@/src/features/purchasing/PoDirectory";

export default async function Page() {
  await requireWorkspaceSession();
  const records = await purchasingDirectory();
  if (!records) redirect("/projects");
  return <PoDirectory initial={records} />;
}
