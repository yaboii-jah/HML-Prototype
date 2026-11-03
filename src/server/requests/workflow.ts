import "server-only";
import { documentActor } from "@/src/server/documents/access";
import { dispatchDocumentJobs } from "@/src/server/documents/dispatch";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { parseMrfDraft, parseSavedMrf, uuid, type DraftResult } from "@/src/domain/requests/drafts";

export async function runMrfWorkflow(input: unknown): Promise<DraftResult> {
  try {
    const actor = await documentActor(), command = record(input);
    if (command?.reason !== undefined && (typeof command.reason !== "string" || command.reason.length > 4000)) return { ok: false, message: "Enter a reason up to 4,000 characters." };
    if (!command || !uuid(command.requestId) || !uuid(command.mrfId) || typeof command.expectedVersion !== "string" || !/^[1-9]\d{0,18}$/.test(command.expectedVersion)) return { ok: false, message: "Open the current MRF before continuing." };
    if (command.type === "submitMrf") {
      if (actor.activeRole !== "Site Personnel" || !parseMrfDraft(command.draft) || typeof command.attachmentRevision !== "string" || !/^[1-9]\d*$/.test(command.attachmentRevision)) return { ok: false, message: "Check the form and supporting PDF before submitting." };
    } else if (command.type === "reviewMrf") {
      if (actor.activeRole !== "Project Manager" || !uuid(command.submissionId) || !["approve", "return", "reject"].includes(String(command.decision))) return { ok: false, message: "Use a Project Manager account to review this submission." };
    } else if (command.type !== "openCorrection" || actor.activeRole !== "Procurement") return { ok: false, message: "Use Procurement to open a correction." };
    if (JSON.stringify(command).length > 800000) return { ok: false, message: "This request is too large." };
    const result = record(await serviceRpc("request_command", { actor, command })), saved = parseSavedMrf(result?.record);
    if (!saved) throw Error("Invalid workflow response");
    await dispatchDocumentJobs(saved.projectId).catch(() => {});
    return { ok: true, record: saved, changed: true };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        P4301: "This MRF is locked. A PM must return a submitted request; Procurement must reopen an archived approval before correction.",
        P4302: "Complete the request date, four signatory names and every material’s name, unit, positive quantity, date needed and delivery location.",
        P4303: "Select a funded scope belonging to this project. Ask a PM to check scope setup.",
        P4304: "Finish or cancel every unfinished PDF upload before submitting.",
        P4305: "Enter a reason of at least five characters (up to 4,000).",
        P4306: "Anyone who has submitted this MRF cannot approve it. Another PM must approve.",
        P4307: "Wait for the current approved archive to complete before opening a correction.",
        "42501": "Your current role or project access does not permit this action. Refresh and sign in again if needed.",
        "23514": "Check the form and selected decision. Corrections may be approved or returned.",
        P3406: "This retry identity belongs to different input. Review the current record before continuing.",
      };
      if (error.code === "40001") return { ok: false, conflict: true, message: "The request, submission or PDF changed. Your input is preserved. Review the current record before trying again." };
      if (messages[error.code]) return { ok: false, message: messages[error.code] };
    }
    return { ok: false, uncertain: true, message: "The response was interrupted. Retry the same action to check its outcome before changing input." };
  }
}
