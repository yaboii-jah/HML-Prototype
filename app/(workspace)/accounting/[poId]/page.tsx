import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { quotationActor } from "@/src/server/quotations/drafts";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { id } from "@/src/domain/purchasing/contracts";
import { purchasingView } from "@/src/server/purchasing/purchasing";
import { PurchasingWorkspace } from "@/src/features/purchasing/PurchasingWorkspace";

export default async function Page({ params }: { params: Promise<{ poId: string }> }) {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") redirect("/projects");
  const { poId } = await params;
  if (!id(poId)) notFound();
  const mrfId = await serviceRpc("purchasing_po_request", { actor: await quotationActor(), po_id: poId });
  if (!id(mrfId)) notFound();
  const view = await purchasingView(mrfId);
  if (!view?.records.some((r) => r.id === poId && r.kind === "po")) notFound();
  return <PurchasingWorkspace initial={view} poId={poId} />;
}
