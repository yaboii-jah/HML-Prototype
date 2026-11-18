import { notFound } from 'next/navigation';
import { deliveriesView } from '@/src/server/deliveries/deliveries';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { DeliveryWorkspace } from '@/src/features/deliveries/DeliveryWorkspace';
export default async function Page({ params }: { params:Promise<{ id:string }> }) {
  const { id } = await params;
  await requireWorkspaceSession();
  const view = await deliveriesView();
  if (!view || !view.deliveries.some(d => d.id === id)) notFound();
  return <DeliveryWorkspace initial={view} deliveryId={id} />;
}
