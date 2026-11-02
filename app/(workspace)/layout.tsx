import type { ReactNode } from "react";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { requireWorkspaceSession } from "@/src/server/auth/session";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireWorkspaceSession();
  return <WorkspaceShell key={`${session.userId}:${session.revision}:${session.activeRole}`} session={session}>{children}</WorkspaceShell>;
}
