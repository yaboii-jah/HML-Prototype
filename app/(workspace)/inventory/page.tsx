import { requireWorkspaceSession } from '@/src/server/auth/session';
import { inventoryView } from '@/src/server/inventory/inventory';
import { InventoryWorkspace } from '@/src/features/inventory/InventoryWorkspace';

export default async function Page({ searchParams }: { searchParams:Promise<{ view?:string }> }) {
  const session=await requireWorkspaceSession();
  const view=await inventoryView({ mode:'stock' });
  const { view:tab }=await searchParams;
  return view&&<InventoryWorkspace initial={view} actorId={session.userId} initialUsage={tab==='usage'} />;
}
