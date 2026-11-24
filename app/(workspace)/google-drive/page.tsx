import { notFound, redirect } from "next/navigation";
import { Empty, PageHeader } from "@/src/components/ui/Primitives";
import { ProjectDriveLink } from "@/src/features/projects/ProjectDriveLink";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { ServiceCommandError } from "@/src/server/auth/service-rpc";
import { DocumentHttpError, projectDriveDirectory } from "@/src/server/documents/access";
import "./directory.css";

export default async function Page() {
  const session = await requireWorkspaceSession();
  if (session.activeRole === "Site Personnel") notFound();

  let projects;
  try {
    projects = await projectDriveDirectory();
  } catch (error) {
    if (error instanceof DocumentHttpError && error.status === 401) redirect("/sign-in");
    if (error instanceof ServiceCommandError && error.code === "42501") notFound();
    return <>
      <PageHeader title="Google Drive" />
      <section className="panel">
        <p>Project folders could not be loaded.</p>
        <a className="text-link" href="/google-drive">Try again</a>
      </section>
    </>;
  }

  return <>
    <PageHeader title="Google Drive" />
    {projects.length === 0 ? (
      <Empty title="No project folders are linked" detail="An Administrator or Project Manager can link a folder from the project page." />
    ) : (
      <div className="table-frame project-drive-directory">
        <table aria-label="Project Drive folders">
          <thead><tr><th scope="col">Project</th><th scope="col">Folder</th></tr></thead>
          <tbody>{projects.map(project => (
            <tr key={project.id}>
              <td>
                <strong>{project.name}</strong>
                {project.code && <small>{project.code}</small>}
              </td>
              <td><ProjectDriveLink projectId={project.id} projectName={project.name} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )}
  </>;
}
