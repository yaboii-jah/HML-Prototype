import "server-only";
import { readSession } from "@/src/server/auth/session";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { dispatchDocumentJobs } from "@/src/server/documents/dispatch";
import {
  parseProject,
  parseProjectCommand,
  parseProjectHistory,
  record,
  type ProjectResult,
} from "@/src/domain/projects/projects";

async function actorContext() {
  const session = await readSession();
  if (
    !session?.activeRole ||
    !session.context.roles.includes(session.activeRole)
  )
    return null;
  return {
    userId: session.context.userId,
    sessionId: session.sessionId,
    revision: session.context.revision,
    activeRole: session.activeRole,
  };
}
export async function projectDirectory() {
  const actor = await actorContext();
  if (!actor) return null;
  const raw = record(await serviceRpc("projects_read", { actor }));
  if (!raw || !Array.isArray(raw.projects))
    throw Error("Projects could not be loaded.");
  const financial = actor.activeRole !== "Site Personnel";
  const projects = raw.projects.map((p) => parseProject(p, financial));
  const history = parseProjectHistory(raw.history, financial);
  if (projects.some((p) => p === null) || !history)
    throw Error("Projects could not be loaded.");
  return {
    role: actor.activeRole,
    projects: projects.filter((p) => p !== null),
    history,
  };
}
export async function projectDetail(id: string) {
  const actor = await actorContext();
  if (!actor) return null;
  const raw = record(
    await serviceRpc("projects_read", { actor, target_project: id }),
  );
  if (!raw) throw Error("Project could not be loaded.");
  if (raw.project === null)
    return { role: actor.activeRole, project: null, history: [] };
  const financial = actor.activeRole !== "Site Personnel";
  const project = parseProject(raw.project, financial, true, actor.activeRole),
    history = parseProjectHistory(raw.history, financial);
  if (!project || !history) throw Error("Project could not be loaded.");
  return { role: actor.activeRole, project, history };
}
export async function runProjectCommand(
  input: unknown,
): Promise<ProjectResult> {
  try {
    const actor = await actorContext();
    if (
      !actor ||
      !["Administrator", "Project Manager"].includes(actor.activeRole)
    )
      return {
        ok: false,
        message:
          "Use your Administrator or Project Manager role to manage projects.",
      };
    const command = parseProjectCommand(input);
    if (!command)
      return {
        ok: false,
        message:
          "Check the required project details, scope and exact PHP amount.",
      };
    const result = record(
      await serviceRpc("project_command", { actor, command }),
    );
    if (
      !result ||
      typeof result.projectId !== "string" ||
      typeof result.deleted !== "boolean" ||
      typeof result.changed !== "boolean"
    )
      throw Error("Invalid project result");
    await dispatchDocumentJobs(result.projectId).catch(() => {});
    return {
      ok: true,
      projectId: result.projectId,
      deleted: result.deleted,
      message: result.deleted
        ? "Project removed. Its history is retained."
        : result.changed
          ? "Changes saved."
          : "No changes to save.",
    };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "23503": "This project or scope is referenced by an MRF and cannot be deleted.",
        "40001":
          "The project changed. Your draft is preserved. Review the latest version and reapply your changes.",
        "42501":
          "Your access changed, or an Administrator must clear assignments before deletion. Refresh and sign in again if needed.",
        "23505":
          "That project name, document code or scope name is already in use.",
        "23514":
          "Check the required details, standard scope name and PHP amount.",
        P3401:
          "Scope allocations must fit within the project budget. Reduce allocations before lowering the budget.",
        P3402:
          "This project is referenced by pending account provisioning or document use and cannot be deleted.",
        P3403: "This document code is locked after use.",
        P3404:
          "Assignments changed. Review the current personnel before deleting.",
        P3405: "This project or scope was removed. Refresh before continuing.",
        P3406:
          "This request identity was used for different changes. Reopen the editor and review your input.",
      };
      if (messages[error.code])
        return {
          ok: false,
          message: messages[error.code],
          conflict: ["40001", "P3404"].includes(error.code),
        };
    }
    return {
      ok: false,
      message:
        "The operation could not finish. Retry the same request to check its saved outcome.",
    };
  }
}
