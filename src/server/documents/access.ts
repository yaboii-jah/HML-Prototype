import "server-only";
import { readSession } from "@/src/server/auth/session";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { parseDocumentsView } from "@/src/domain/requests/documents";
import { record } from "@/src/domain/projects/projects";
import { uuid } from "@/src/domain/requests/drafts";
import { dispatchDocumentJobs } from "./dispatch";

export class DocumentHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function documentActor() {
  const session = await readSession();
  if (!session?.activeRole || !session.context.roles.includes(session.activeRole)) throw new DocumentHttpError(401, "Sign in again to access documents.");
  return { userId: session.context.userId, sessionId: session.sessionId, revision: session.context.revision, activeRole: session.activeRole };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new DocumentHttpError(403, "Open this action from the application.");
}
export function privateDocumentRead(request: Request) {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(request.url).origin || site && !["same-origin", "none"].includes(site)) throw new DocumentHttpError(403, "Open documents from this application.");
}
export async function documentsView(mrfId?: string, projectId?: string) {
  const actor = await documentActor();
  if ((!mrfId || !uuid(mrfId)) && (!projectId || !uuid(projectId))) throw new DocumentHttpError(400, "Choose a saved MRF or project.");
  const raw = await serviceRpc("documents_read", { actor, target_request: mrfId ?? null, target_project: projectId ?? null });
  const view = parseDocumentsView(raw);
  if (!view) throw Error("Invalid document view");
  // A reopened screen reconciles durable intent left by an interrupted dispatch.
  const scopedProject = record(raw)?.projectId;
  if (uuid(scopedProject)) await dispatchDocumentJobs(scopedProject).catch(() => {});
  return view;
}
export async function documentCommand(input: unknown) {
  const actor = await documentActor(), raw = record(input);
  if (!raw || !uuid(raw.operationId) || typeof raw.type !== "string" || (!uuid(raw.mrfId) && !uuid(raw.projectId)) || JSON.stringify(raw).length > 4096) throw new DocumentHttpError(400, "Invalid document action.");
  const result = await serviceRpc("document_command", { actor, command: raw });
  await dispatchDocumentJobs(uuid(raw.projectId) ? raw.projectId : undefined).catch(() => {});
  return result;
}
export function documentError(error: unknown) {
  let status = 503, message = "Document storage is unavailable. Your saved MRF and current file are retained. Retry shortly.";
  if (error instanceof DocumentHttpError) { status = error.status; message = error.message; }
  if (error instanceof ServiceCommandError) {
    const errors: Record<string, [number, string]> = {
      "42501": [403, "Your document access changed. Refresh and sign in again if needed."],
      "40001": [409, "The attachment or folder changed. Review its current state before trying again."],
      "55P03": [409, "This operation is still processing. Wait briefly, then refresh its status."],
      "23505": [409, "That Drive folder already belongs to another project."],
      "23514": [400, "Check the PDF, saved record and selected operation. Reselect the same PDF when resuming."],
      "22P02": [400, "Invalid document action."],
      P3406: [409, "This operation identity was used for different input. Refresh before continuing."],
      P4201: [409, "An Administrator or Project Manager must set up the project document folder first."],
      P4202: [410, "This upload expired. Cancel it and start a new upload."],
    };
    if (errors[error.code]) [status, message] = errors[error.code];
  }
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Origin" } });
}
