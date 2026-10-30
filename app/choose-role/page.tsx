import { RoleChooser } from "@/src/features/auth/RoleChooser";
import { requireSession } from "@/src/server/auth/session";

export default async function Page() {
  const session = await requireSession();
  return <RoleChooser session={session.context}/>;
}
