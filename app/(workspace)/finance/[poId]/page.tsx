import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { paymentsView } from "@/src/server/payments/payments";
import { UUID_PATTERN } from "@/src/domain/auth/session";
import { PaymentWorkspace } from "@/src/features/payments/PaymentWorkspace";
export default async function Page({ params }: { params: Promise<{ poId: string }> }) {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") redirect("/projects");
  const { poId } = await params;
  if (!UUID_PATTERN.test(poId)) notFound();
  const view = await paymentsView(poId);
  if (!view?.records.length) notFound();
  return <PaymentWorkspace initial={view} poId={poId} />;
}
