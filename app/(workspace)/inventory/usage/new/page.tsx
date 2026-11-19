import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { inventoryView } from '@/src/server/inventory/inventory';
import { InventoryWorkspace } from '@/src/features/inventory/InventoryWorkspace';

export default async function Page({ searchParams }: { searchParams:Promise<{ siteId?:string; materialId?:string }> }) {
  const session=await requireWorkspaceSession();
  const view=await inventoryView({ mode:'new' });
  if (view?.role!=='Site Personnel') notFound();
  const { siteId,materialId }=await searchParams;
  return <InventoryWorkspace initial={view} actorId={session.userId} initialProject={siteId} initialMaterial={materialId} />;
}
