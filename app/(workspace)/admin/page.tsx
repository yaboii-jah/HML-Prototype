import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { accountDirectory } from "@/src/server/accounts/accounts";
import { AccountAdministration } from "@/src/features/accounts/AccountAdministration";

export default async function Page() {
  const session = await requireWorkspaceSession();
  if (session.activeRole !== "Administrator") redirect("/projects");
  const directory = await accountDirectory();
  if (!directory) redirect("/sign-in");
  return <AccountAdministration directory={directory} />;
}
