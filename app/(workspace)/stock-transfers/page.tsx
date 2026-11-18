import { requireWorkspaceSession } from '@/src/server/auth/session';
import { transferView } from '@/src/server/transfers/transfers';
import { TransfersWorkspace } from '@/src/features/transfers/TransfersWorkspace';

export default async function Page() {
  await requireWorkspaceSession();
  const view=await transferView();
  return <TransfersWorkspace initial={view ?? { records:[],sourcing:null }} />;
}
