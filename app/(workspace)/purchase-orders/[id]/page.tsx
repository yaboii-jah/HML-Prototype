import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { quotationActor } from "@/src/server/quotations/drafts";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { id as uuid } from "@/src/domain/purchasing/contracts";
import { purchasingView } from "@/src/server/purchasing/purchasing";
import { PurchasingWorkspace } from "@/src/features/purchasing/PurchasingWorkspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") redirect("/projects");
  const { id } = await params;
  if (!uuid(id)) notFound();
  const mrfId = await serviceRpc("purchasing_po_request", { actor: await quotationActor(), po_id: id });
  if (!uuid(mrfId)) notFound();
  const view = await purchasingView(mrfId);
  if (!view?.records.some(r => r.id === id && r.kind === "po")) notFound();
  return <PurchasingWorkspace initial={view} poId={id} />;
}
