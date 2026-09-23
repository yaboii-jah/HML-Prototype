import type { ReactNode } from "react";
import { AppShell } from "@/src/components/shell/AppShell";
import { DataGate } from "@/src/components/ui/States";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <DataGate><AppShell>{children}</AppShell></DataGate>;
}
