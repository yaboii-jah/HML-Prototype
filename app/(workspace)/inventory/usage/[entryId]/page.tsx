import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { inventoryView } from '@/src/server/inventory/inventory';
import { id } from '@/src/domain/purchasing/contracts';
import { InventoryWorkspace } from '@/src/features/inventory/InventoryWorkspace';

export default async function Page({ params }: { params:Promise<{ entryId:string }> }) {
  const session=await requireWorkspaceSession();
  const { entryId }=await params;
  if (!id(entryId)) notFound();
  const view=await inventoryView({ mode:'entry',target:entryId });
  if (!view?.found) notFound();
  return <InventoryWorkspace initial={view} actorId={session.userId} />;
}
