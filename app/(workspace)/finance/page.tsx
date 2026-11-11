import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { paymentsView } from "@/src/server/payments/payments";
import { PaymentsDirectory } from "@/src/features/payments/PaymentWorkspace";
export default async function Page() {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") redirect("/projects");
  const view = await paymentsView();
  if (!view) throw Error("Finance is unavailable.");
  return <PaymentsDirectory initial={view} />;
}
