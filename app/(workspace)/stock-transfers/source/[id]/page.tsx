import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { transferView } from '@/src/server/transfers/transfers';
import { TransfersWorkspace } from '@/src/features/transfers/TransfersWorkspace';
import { id } from '@/src/domain/purchasing/contracts';

export default async function Page({ params }: { params:Promise<{ id:string }> }) {
  const session=await requireWorkspaceSession();
  const route=await params;
  if (!id(route.id) || session.activeRole!=='Procurement') notFound();
  const view=await transferView(route.id);
  if (!view?.sourcing) notFound();
  return <TransfersWorkspace initial={view} sourcingPage />;
}
