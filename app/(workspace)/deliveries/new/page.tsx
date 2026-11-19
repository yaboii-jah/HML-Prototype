import { deliveriesView } from '@/src/server/deliveries/deliveries';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { DeliveryWorkspace } from '@/src/features/deliveries/DeliveryWorkspace';
export default async function Page({ searchParams }: PageProps<"/deliveries/new">) {
  await requireWorkspaceSession();
  const view = await deliveriesView();
  if (!view) throw Error('Delivery data is unavailable. Sign in again.');
  const { poId } = await searchParams;
  return <DeliveryWorkspace initial={view} create initialPoId={typeof poId === 'string' && view.orders.some(order => order.id === poId) ? poId : undefined} />;
}
