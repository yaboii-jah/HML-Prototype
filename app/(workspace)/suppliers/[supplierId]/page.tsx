import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { UUID_PATTERN } from "@/src/domain/auth/session";
import { supplierView } from "@/src/server/suppliers/suppliers";
import { SupplierWorkspace } from "@/src/features/suppliers/SupplierWorkspace";

export default async function Page({ params }: { params: Promise<{ supplierId: string }> }) {
  await requireWorkspaceSession();
  const { supplierId } = await params;
  if (!UUID_PATTERN.test(supplierId)) notFound();
  const view = await supplierView(supplierId);
  if (!view) redirect("/projects");
  if (!view.suppliers.length) notFound();
  return <SupplierWorkspace initial={view} supplierId={supplierId} />;
}
