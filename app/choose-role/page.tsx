import { redirect } from "next/navigation";
import { RoleChooser } from "@/src/features/auth/RoleChooser";
import { readSession } from "@/src/server/auth/session";

export default async function Page() {
  const session = await readSession();
  if (!session) redirect("/sign-in");
  return <RoleChooser session={session.context}/>;
}
