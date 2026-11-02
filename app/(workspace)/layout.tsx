import type { ReactNode } from "react";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { FoundationRealtime } from "@/src/app-state/FoundationRealtime";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireWorkspaceSession();
  return <FoundationRealtime key={`${session.userId}:${session.revision}:${session.activeRole}`} session={session}><WorkspaceShell session={session}>{children}</WorkspaceShell></FoundationRealtime>;
}
