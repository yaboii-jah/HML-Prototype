import { deliveriesView } from '@/src/server/deliveries/deliveries';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { DeliveryWorkspace } from '@/src/features/deliveries/DeliveryWorkspace';
export default async function Page() {
  await requireWorkspaceSession();
  const view = await deliveriesView();
  if (!view) throw Error('Delivery data is unavailable. Sign in again.');
  return <DeliveryWorkspace initial={view} create />;
}
