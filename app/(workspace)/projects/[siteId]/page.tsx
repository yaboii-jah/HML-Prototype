import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { projectDetail } from "@/src/server/projects/projects";
import { ProjectDetailScreen } from "@/src/features/projects/ProjectWorkspace";
import { UUID_PATTERN } from "@/src/domain/auth/session";

export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  await requireWorkspaceSession();
  const { siteId } = await params;
  if (!UUID_PATTERN.test(siteId)) notFound();
  const detail = await projectDetail(siteId);
  if (!detail) redirect("/sign-in");
  if (!detail.project) notFound();
  return (
    <ProjectDetailScreen
      project={detail.project}
      history={detail.history}
      role={detail.role}
    />
  );
}
