import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { supplierView } from "@/src/server/suppliers/suppliers";
import { SupplierWorkspace } from "@/src/features/suppliers/SupplierWorkspace";

export default async function Page() {
  await requireWorkspaceSession();
  const view = await supplierView();
  if (!view) redirect("/projects");
  return <SupplierWorkspace initial={view} />;
}
