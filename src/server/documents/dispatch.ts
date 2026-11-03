import "server-only";
import { start } from "workflow/api";
import { documentWorkflow } from "@/src/server/workflows/documents";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { uuid } from "@/src/domain/requests/drafts";

/** Intent is already committed. Uncertain dispatch stays eligible for reconciliation.
 * Duplicate runs are harmless: the database grants one expiring processing lease.
 */
export async function dispatchDocumentJobs(projectId?: string) {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const jobs = await serviceRpc("document_dispatch", { target_project: projectId ?? null });
  if (!Array.isArray(jobs) || jobs.some(id => !uuid(id))) throw Error("Invalid document outbox");
  await Promise.allSettled(jobs.map(id => start(documentWorkflow, [id])));
}
