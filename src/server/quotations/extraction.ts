import "server-only";
import { start } from "workflow/api";
import { record } from "@/src/domain/projects/projects";
import { QUOTE_GROUP_LIMIT, quoteUuid, validQuoteFile } from "@/src/domain/quotations/drafts";
import { parseQuoteExtractionStatus, QUOTE_EXTRACTION_FILES, QUOTE_EXTRACTION_PAGES } from "@/src/domain/quotations/extraction";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentActor, DocumentHttpError } from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { recordedRequestDriveParent } from "@/src/server/documents/request-folders";
import { quotationExtractionWorkflow } from "@/src/server/workflows/quotation-extraction";
import { quotationOriginalTags } from "./files";
import { InvalidQuotationOriginal, validateQuotationOriginal } from "./original-validation";
import { quotationSourceValues } from "./extraction-provider";

export const quotationExtractionEnabled = () => process.env.QUOTATION_EXTRACTION_ENABLED === "true"
  && process.env.GOOGLE_DRIVE_ENABLED === "true" && !!process.env.GEMINI_API_KEY;
const version = (value: unknown) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);

export async function quotationExtractionCommand(input: unknown, actor?: Awaited<ReturnType<typeof documentActor>>) {
  const caller = actor ?? await documentActor();
  if (caller.activeRole !== "Procurement") throw new DocumentHttpError(403, "Procurement access is required.");
  const command = record(input);
  if (!command || !quoteUuid(command.quoteId) || !version(command.version) || !version(command.fileVersion)
    || !["status", "start", "retry", "apply"].some(action => action === command.type)
    || (command.type === "start" && !quoteUuid(command.operationId))
    || (command.type === "apply" && !quoteUuid(command.proposalId))
    || (command.type === "retry" && (!quoteUuid(command.proposalId) || !quoteUuid(command.operationId) || !quoteUuid(command.attemptId)))) {
    throw new DocumentHttpError(400, "Open the saved quotation and its current originals before extracting.");
  }
  if (!quotationExtractionEnabled()) return { state: "disabled" };
  const raw = record(await serviceRpc("quotation_extraction_command", { actor: caller, command }));
  const status = parseQuoteExtractionStatus(raw);
  if (!status || (command.type === "apply" && status.state === "ready" && !status.proposal)) {
    throw Error("Invalid quotation extraction status");
  }
  if (status.id && raw?.dispatch === true) await start(quotationExtractionWorkflow, [status.id]).catch(() => {});
  return status;
}

export function quotationExtractionWorker(jobId: string, action: string, leaseId: string | null = null, patch = {}) {
  return serviceRpc("quotation_extraction_worker", { job_id: jobId, action, lease_id: leaseId, patch });
}

function expiry(value: unknown): string | null {
  const expiresAt = record(value)?.expiresAt;
  return typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null;
}

export async function processQuotationExtraction(jobId: string): Promise<string | null> {
  if (!quoteUuid(jobId)) return null;
  const job = record(await quotationExtractionWorker(jobId, "claim"));
  if (!job || !quoteUuid(job.lease)) return expiry(job);
  const lease = job.lease;
  const fail = async (reason: string) => { await quotationExtractionWorker(jobId, "fail", lease, { reason }); return null; };
  if (!quotationExtractionEnabled()) return fail("provider");
  if (!Array.isArray(job.files) || !job.files.length || job.files.length > QUOTE_EXTRACTION_FILES) return fail("limit");

  const originals: { id: string; bytes: Uint8Array; mime: string; pages: number }[] = [];
  let size = 0, pages = 0;
  try {
    const drive = documentDrive();
    for (const value of job.files) {
      const file = record(value);
      if (!file || !quoteUuid(file.id) || !quoteUuid(file.quoteId) || typeof file.driveId !== "string" || typeof file.folderId !== "string"
        || typeof file.mime !== "string" || typeof file.size !== "number" || typeof file.sha256 !== "string"
        || !validQuoteFile({ name: "original", mime: file.mime, size: file.size, sha256: file.sha256 })) return fail("source");
      size += file.size;
      if (size > QUOTE_GROUP_LIMIT) return fail("limit");
      const parent = await recordedRequestDriveParent("quotation-original", file.id, file.folderId);
      const bytes = await drive.verifyFile(file.driveId, parent, quotationOriginalTags(file.id, file.quoteId), file.size, file.sha256, file.mime);
      const count = await validateQuotationOriginal(bytes, file.mime);
      pages += count;
      if (pages > QUOTE_EXTRACTION_PAGES) return fail("limit");
      originals.push({ id: file.id, bytes, mime: file.mime, pages: count });
    }
  } catch (error) {
    return fail(error instanceof InvalidQuotationOriginal ? "source" : "provider");
  }
  if (!await quotationExtractionWorker(jobId, "check", lease)) return null;
  const result = await quotationSourceValues(originals);
  if ("reason" in result) return fail(result.reason);
  return expiry(await quotationExtractionWorker(jobId, "complete", lease, result.proposal));
}
