import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/src/server/auth/session';
import { transferView } from '@/src/server/transfers/transfers';
import { TransfersWorkspace } from '@/src/features/transfers/TransfersWorkspace';
import { id } from '@/src/domain/purchasing/contracts';

export default async function Page({ params }: { params:Promise<{ id:string }> }) {
  await requireWorkspaceSession();
  const route=await params;
  if (!id(route.id)) notFound();
  const view=await transferView(undefined,route.id);
  if (!view?.records.length) notFound();
  return <TransfersWorkspace initial={view} recordId={route.id} />;
}
