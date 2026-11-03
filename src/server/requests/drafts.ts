import "server-only";
import { readSession } from "@/src/server/auth/session";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { parseDraftCommand, parseRequestView, parseSavedMrf, uuid, type DraftResult } from "@/src/domain/requests/drafts";
import { record } from "@/src/domain/projects/projects";

async function actorContext() {
  const session = await readSession();
  if (!session?.activeRole || !session.context.roles.includes(session.activeRole)) return null;
  return { userId: session.context.userId, sessionId: session.sessionId, revision: session.context.revision, activeRole: session.activeRole };
}
export async function requestView(id?: string) {
  const actor = await actorContext();
  if (!actor) return null;
  if (id !== undefined && !uuid(id)) return { role: actor.activeRole, requests: [], projects: [] };
  const view = parseRequestView(await serviceRpc("requests_read", { actor, target_request: id ?? null }));
  if (!view || view.role !== actor.activeRole) throw Error("Material requests could not be loaded.");
  return view;
}
export async function runDraftCommand(input: unknown): Promise<DraftResult> {
  try {
    const actor = await actorContext();
    if (actor?.activeRole !== "Site Personnel") return { ok: false, message: "Use an assigned Site Personnel account to save drafts." };
    const command = parseDraftCommand(input);
    if (!command) return { ok: false, message: "Check the project, dates and supplied quantities. Blank draft fields are allowed." };
    const result = record(await serviceRpc("request_command", { actor, command }));
    const saved = parseSavedMrf(result?.record);
    if (!result || !saved || typeof result.changed !== "boolean") throw Error("Invalid save response");
    return { ok: true, record: saved, changed: result.changed };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      if (error.code === "P4301") return { ok: false, conflict: true, message: "This MRF is now locked by submission or approval. Your input is preserved; review the current workflow state." };
      if (error.code === "40001") return { ok: false, conflict: true, message: "This MRF changed. Your input is preserved. Review the latest saved changes before saving." };
      if (error.code === "42501") return { ok: false, message: "Your project access changed. Refresh and sign in again." };
      if (["23514", "23503", "22P02", "22007", "22008", "23505"].includes(error.code)) return { ok: false, message: "Check the selected project/scope, material identities, dates and positive quantities." };
      if (error.code === "P3406") return { ok: false, message: "The retry identity belongs to different input. Reopen the saved record before continuing." };
    }
    return { ok: false, uncertain: true, message: "The save response was interrupted. Retry the same save to check its outcome before making more changes." };
  }
}
