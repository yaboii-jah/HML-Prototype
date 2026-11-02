import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { projectDirectory } from "@/src/server/projects/projects";
import { ProjectDirectoryScreen } from "@/src/features/projects/ProjectWorkspace";

export default async function Page() {
  await requireWorkspaceSession();
  const directory = await projectDirectory();
  if (!directory) redirect("/sign-in");
  return <ProjectDirectoryScreen {...directory} />;
}
