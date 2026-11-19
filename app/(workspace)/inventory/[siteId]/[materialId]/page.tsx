import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { inventoryView } from '@/src/server/inventory/inventory';
import { id } from '@/src/domain/purchasing/contracts';
import { InventoryWorkspace } from '@/src/features/inventory/InventoryWorkspace';

export default async function Page({ params }: { params:Promise<{ siteId:string; materialId:string }> }) {
  const session=await requireWorkspaceSession();
  const { siteId,materialId }=await params;
  if (!id(siteId)||!id(materialId)) notFound();
  const view=await inventoryView({ mode:'material',projectId:siteId,target:materialId });
  if (!view?.found) notFound();
  return <InventoryWorkspace initial={view} actorId={session.userId} />;
}
