import "server-only";
import { start } from "workflow/api";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentActor, DocumentHttpError } from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { InvalidSupportingPdf, validateSupportingPdf } from "@/src/server/documents/pdf-validation";
import { recordedRequestDriveParent } from "@/src/server/documents/request-folders";
import { textValue, uploadTags } from "@/src/server/documents/state";
import { record } from "@/src/domain/projects/projects";
import { uuid } from "@/src/domain/requests/drafts";
import { MAX_EXTRACTION_BYTES, MAX_EXTRACTION_PAGES, parseExtractionStatus, parseMrfProposal, suggestionFields } from "@/src/domain/requests/extraction";
import { mrfExtractionWorkflow } from "@/src/server/workflows/mrf-extraction";
import { extractMrfPdf } from "./extraction-provider";

const enabled = () => process.env.MRF_EXTRACTION_ENABLED === "true"
  && process.env.GOOGLE_DRIVE_ENABLED === "true" && !!process.env.GEMINI_API_KEY;
const version = (value: unknown) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);

export async function mrfExtractionCommand(input: unknown) {
  const actor = await documentActor();
  if (actor.activeRole !== "Site Personnel") throw new DocumentHttpError(403, "Assigned Site Personnel access is required.");
  const command = record(input);
  if (!command || !uuid(command.mrfId) || !version(command.version) || !version(command.attachmentRevision)
    || !["status", "start", "retry", "apply"].some(action => action === command.type)
    || (command.type === "start" && !uuid(command.operationId))
    || (command.type === "apply" && !uuid(command.proposalId))
    || (command.type === "retry" && (!uuid(command.proposalId) || !uuid(command.operationId) || !uuid(command.attemptId)))) {
    throw new DocumentHttpError(400, "Open the current MRF and supporting PDF before extracting.");
  }
  if (!enabled()) return { state: "disabled" };
  const raw = record(await serviceRpc("mrf_extraction_command", { actor, command }));
  const status = parseExtractionStatus(raw);
  if (!status) throw Error("Invalid extraction status");
  if (status.id && raw?.dispatch === true) {
    await start(mrfExtractionWorkflow, [status.id]).catch(() => {});
  }
  return status;
}

export function extractionWorker(jobId: string, action: string, leaseId: string | null = null, patch = {}) {
  return serviceRpc("mrf_extraction_worker", { job_id: jobId, action, lease_id: leaseId, patch });
}

function expiry(value: unknown): string | null {
  const expiresAt = record(value)?.expiresAt;
  return typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null;
}

export async function processMrfExtraction(jobId: string): Promise<string | null> {
  if (!uuid(jobId)) return null;
  const job = record(await extractionWorker(jobId, "claim"));
  if (!job || !uuid(job.lease)) return expiry(job);
  const lease = job.lease;
  const fail = async (reason: string) => { await extractionWorker(jobId, "fail", lease, { reason }); return null; };
  if (!enabled()) return fail("provider");
  const size = Number(job.size);
  if (!Number.isSafeInteger(size) || size < 5 || size > MAX_EXTRACTION_BYTES) return fail("limit");

  let bytes: Uint8Array;
  let pages: number;
  try {
    const documentId = textValue(job.documentId);
    const folder = await recordedRequestDriveParent("mrf-original", documentId, textValue(job.folderId));
    bytes = await documentDrive().verifyPdf(textValue(job.driveId), folder, uploadTags(documentId, textValue(job.requestId)), size, textValue(job.sha256));
    pages = await validateSupportingPdf(bytes);
  } catch (error) {
    return fail(error instanceof InvalidSupportingPdf ? "source" : "provider");
  }
  if (pages > MAX_EXTRACTION_PAGES) return fail("limit");
  if (!await extractionWorker(jobId, "check", lease)) return null;

  let result: Record<string, unknown> | null;
  try {
    result = record(await extractMrfPdf(bytes));
  } catch {
    return fail("provider");
  }
  if (result?.documentType === "other") return fail("no-mrf");
  if (result?.documentType === "multiple_mrfs") return fail("multiple-mrfs");
  const proposal = result?.documentType === "single_mrf" ? parseMrfProposal(result, pages) : null;
  if (!proposal || Buffer.byteLength(JSON.stringify(proposal)) > 475_000) return fail("provider");
  if (!proposal.rows.length && !suggestionFields.some(field => proposal.details[field].value)) return fail("empty");
  return expiry(await extractionWorker(jobId, "complete", lease, proposal));
}
