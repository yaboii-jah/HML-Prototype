import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { purchasingView } from "@/src/server/purchasing/purchasing";
import { PurchasingWorkspace } from "@/src/features/purchasing/PurchasingWorkspace";
import { id as uuid } from "@/src/domain/purchasing/contracts";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceSession();
  const { id } = await params;
  if (!uuid(id)) notFound();
  const view = await purchasingView(id);
  if (!view) redirect("/projects");
  if (!view.quotations.request) notFound();
  return <PurchasingWorkspace initial={view} />;
}
