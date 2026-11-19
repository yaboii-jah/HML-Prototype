import { redirect } from "next/navigation";
import { RoleChooser } from "@/src/features/auth/RoleChooser";
import { readSession } from "@/src/server/auth/session";
import { safeWorkspaceDestination, workspaceEntry } from "@/src/domain/auth/session";

export default async function Page({ searchParams }: PageProps<"/choose-role">) {
  const next = safeWorkspaceDestination((await searchParams).next);
  const session = await readSession();
  if (!session) redirect(workspaceEntry("/sign-in", next));
  return <RoleChooser session={session.context} next={next}/>;
}
