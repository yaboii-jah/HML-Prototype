import "server-only";
import { start } from "workflow/api";
import { record } from "@/src/domain/projects/projects";
import { QUOTE_GROUP_LIMIT, quoteUuid, validQuoteFile } from "@/src/domain/quotations/drafts";
import { QUOTE_EXTRACTION_FILES, QUOTE_EXTRACTION_PAGES } from "@/src/domain/quotations/extraction";
import { parseIntakeStatus } from "@/src/domain/quotations/intake";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentActor, DocumentHttpError } from "@/src/server/documents/access";
import { documentDrive, documentRoot } from "@/src/server/documents/config";
import { rowValue, textValue } from "@/src/server/documents/state";
import { quotationIntakeCleanupWorkflow, quotationIntakeExtractionWorkflow } from "@/src/server/workflows/quotation-intake";
import { quotationExtractionEnabled } from "./extraction";
import { quotationSourceValues } from "./extraction-provider";
import { InvalidQuotationOriginal, validateQuotationOriginal } from "./original-validation";
import { optionalOriginalText, quotationIntakeTags, resumeOriginal } from "./resumable-original";

export function quotationIntakeWorker(target: string, action: string, leaseId: string | null = null, patch = {}) {
  return serviceRpc("quotation_intake_worker", { target, action, lease_id: leaseId, patch });
}

export async function quotationIntakeCommand(value: unknown, actor: Awaited<ReturnType<typeof documentActor>>) {
  if (actor.activeRole !== "Procurement") throw new DocumentHttpError(403, "Procurement access is required.");
  const raw = record(value);
  if (!raw || !quoteUuid(raw.mrfId) || !["status", "begin", "start", "cancel"].some(type => type === raw.type)
    || (raw.intakeId !== undefined && !quoteUuid(raw.intakeId))) throw new DocumentHttpError(400, "Choose the current material request.");
  const folderId = process.env.QUOTATION_INTAKE_DRIVE_FOLDER_ID;
  if (raw.type === "begin" && (!folderId || !quotationExtractionEnabled())) return { state: "disabled" };
  // Status remains recoverable after an intake is started even if the provider is turned off.
  if (raw.type === "status" && !folderId) return { state: "disabled" };
  const command: Record<string, unknown> = { type: raw.type, mrfId: raw.mrfId, intakeId: raw.intakeId };
  if (raw.type === "begin") {
    if (!folderId || !quoteUuid(raw.operationId) || !Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > QUOTE_EXTRACTION_FILES
      || !raw.files.every(validQuoteFile) || raw.files.reduce((sum, file) => sum + file.size, 0) > QUOTE_GROUP_LIMIT) {
      throw new DocumentHttpError(400, "Choose up to 12 PDF/JPEG/PNG/WebP originals, 20 MiB each and 45 MiB total.");
    }
    await documentDrive().validatePrivateFolder(folderId, documentRoot());
    command.operationId = raw.operationId;
    command.files = raw.files.map(({ name, mime, size, sha256 }) => ({ name, mime, size, sha256 }));
    command.folderId = folderId;
  }
  const response = record(await serviceRpc("quotation_intake_command", { actor, command }));
  const status = parseIntakeStatus(response);
  if (!response || !status) throw Error("Invalid quotation intake status");
  if (quoteUuid(response.cleanupId)) await start(quotationIntakeCleanupWorkflow, [response.cleanupId]).catch(() => {});
  if (status.id && response.schedule === true) {
    // Admit bytes only when delayed cleanup can recover this intake after navigation.
    await start(quotationIntakeCleanupWorkflow, [status.id]);
    await quotationIntakeWorker(status.id, "schedule");
  }
  if (status.id && response.dispatch === true) await start(quotationIntakeExtractionWorkflow, [status.id]).catch(() => {});
  return status.state === "idle" && !quotationExtractionEnabled() ? { state: "disabled" } : status;
}

export async function transferIntakeOriginal(fileId: string, bytes?: Uint8Array, offset?: number) {
  const actor = await documentActor();
  const call = (action: string, lease: string | null = null, patch = {}) => serviceRpc("quotation_intake_transfer", { actor, file_id: fileId, action, lease_id: lease, patch });
  const file = rowValue(await call("claim"));
  if (file.complete === true) return { complete: true, offset: Number(file.offset) };
  const lease = textValue(file.lease), parent = textValue(file.folderId), drive = documentDrive();
  try {
    if (!file.drive_id) await drive.validatePrivateFolder(parent, documentRoot());
    return await resumeOriginal(drive, { id: fileId, name: textValue(file.name), mime: textValue(file.mime), size: Number(file.size),
      offset: Number(file.offset_bytes), driveId: optionalOriginalText(file.drive_id), session: optionalOriginalText(file.session) },
    parent, quotationIntakeTags(textValue(file.intake_id), fileId), async patch => { await call("checkpoint", lease, patch); },
    async () => await call("finish", lease), bytes, offset);
  } finally {
    await call("release", lease).catch(() => {});
  }
}

export async function processIntakeExtraction(id: string) {
  const job = record(await quotationIntakeWorker(id, "claim"));
  if (!job || !quoteUuid(job.lease) || !Array.isArray(job.files)) return;
  const lease = job.lease;
  const fail = (reason: string) => quotationIntakeWorker(id, "fail", lease, { reason });
  const originals: { id: string; bytes: Uint8Array; mime: string; pages: number }[] = [];
  let pages = 0;
  try {
    const drive = documentDrive(), parent = textValue(job.folderId);
    await drive.validatePrivateFolder(parent, documentRoot());
    for (const value of job.files) {
      const file = rowValue(value), mime = textValue(file.mime), fileId = textValue(file.id);
      const bytes = await drive.verifyFile(textValue(file.drive_id), parent, quotationIntakeTags(id, fileId), Number(file.size), textValue(file.sha256), mime);
      const count = await validateQuotationOriginal(bytes, mime);
      pages += count;
      originals.push({ id: fileId, bytes, mime, pages: count });
    }
  } catch (error) { await fail(error instanceof InvalidQuotationOriginal ? "source" : "provider"); return; }
  if (!await quotationIntakeWorker(id, "verified", lease)) return;
  if (pages > QUOTE_EXTRACTION_PAGES) { await fail("limit"); return; }
  if (!quotationExtractionEnabled()) { await fail("provider"); return; }
  const result = await quotationSourceValues(originals);
  if ("reason" in result) await fail(result.reason);
  else await quotationIntakeWorker(id, "complete", lease, result.proposal);
}

export async function cleanupQuotationIntake(id: string): Promise<string | null> {
  const job = record(await quotationIntakeWorker(id, "cleanup"));
  const retryAt = typeof job?.retryAt === "string" && Number.isFinite(Date.parse(job.retryAt)) ? job.retryAt : null;
  if (!job || !Array.isArray(job.files) || !job.files.length) return retryAt;
  const drive = documentDrive();
  for (const value of job.files) {
    const file = rowValue(value), fileId = textValue(file.id), driveId = textValue(file.driveId);
    const item = await drive.find(driveId);
    const tags = quotationIntakeTags(id, fileId);
    if (item && !item.trashed) drive.verifyIdentity(item, textValue(job.folderId), tags, textValue(file.mime));
    await drive.trash(driveId, tags);
    await quotationIntakeWorker(id, "trashed", null, { fileId });
  }
  return retryAt;
}
