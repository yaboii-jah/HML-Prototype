import { requireWorkspaceSession } from '@/src/server/auth/session';
import { inventoryView } from '@/src/server/inventory/inventory';
import { InventoryWorkspace } from '@/src/features/inventory/InventoryWorkspace';
import { ConsumptionReport } from '@/src/features/monitoring/ConsumptionReport';
import { parseMonitoringFilters } from '@/src/domain/monitoring/contracts';
import { initialMonitoringView } from '@/src/server/monitoring/monitoring';

export default async function Page({ searchParams }: { searchParams:Promise<{ view?:string }> }) {
  const session=await requireWorkspaceSession();
  const { view:tab }=await searchParams;
  if (tab==='consumption') {
    const filters=parseMonitoringFilters('consumption',new URLSearchParams())!;
    return <ConsumptionReport initial={await initialMonitoringView('consumption',filters)} initialFilters={filters} />;
  }
  const view=await inventoryView({ mode:'stock' });
  return view&&<InventoryWorkspace initial={view} actorId={session.userId} initialUsage={tab==='usage'} />;
}
