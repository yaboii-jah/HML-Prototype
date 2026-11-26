import "server-only";
import { start } from "workflow/api";
import { quotationFileWorkflow } from "@/src/server/workflows/quotations";
import { quotationIntakeCleanupWorkflow } from "@/src/server/workflows/quotation-intake";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import {
  documentActor,
  DocumentHttpError,
} from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { requestDriveParent } from "@/src/server/documents/request-folders";
import { rowValue, textValue } from "@/src/server/documents/state";
import { record } from "@/src/domain/projects/projects";
import {
  QUOTE_GROUP_LIMIT,
  quoteUuid,
  validQuoteFile,
} from "@/src/domain/quotations/drafts";
import {
  validateQuotationOriginal,
  InvalidQuotationOriginal,
} from "./original-validation";
import { optionalOriginalText, quotationIntakeTags, resumeOriginal } from "./resumable-original";

export const quotationOriginalTags = (fileId: string, quoteId: string) => ({
  hmlQuotationFile: fileId,
  hmlQuotation: quoteId,
  hmlKind: "quotation-original",
});
export async function dispatchQuotationJobs() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const jobs = await serviceRpc("quotation_dispatch", {});
  if (!Array.isArray(jobs) || !jobs.every(quoteUuid))
    throw Error("Invalid quotation outbox");
  await Promise.allSettled(
    jobs.map((id) => start(quotationFileWorkflow, [id])),
  );
}
export async function quotationFileCommand(input: unknown) {
  const actor = await documentActor(),
    raw = record(input);
  if (actor.activeRole !== "Procurement")
    throw new DocumentHttpError(
      403,
      "Use Procurement to manage quotation originals.",
    );
  if (
    !raw ||
    !quoteUuid(raw.requestId) ||
    !quoteUuid(raw.quoteId) ||
    JSON.stringify(raw).length > 16384
  )
    throw new DocumentHttpError(400, "Invalid original-file action.");
  let command: Record<string, unknown>;
  if (raw.type === "beginGroup") {
    if (
      typeof raw.expectedFiles !== "string" ||
      !/^[1-9]\d*$/.test(raw.expectedFiles) ||
      !Array.isArray(raw.keep) ||
      !raw.keep.every(quoteUuid) ||
      new Set(raw.keep).size !== raw.keep.length ||
      !Array.isArray(raw.uploads) ||
      !raw.uploads.every(validQuoteFile) ||
      raw.keep.length + raw.uploads.length > 12 ||
      raw.uploads.reduce((sum, f) => sum + f.size, 0) > QUOTE_GROUP_LIMIT
    )
      throw new DocumentHttpError(
        400,
        "Choose up to 12 valid originals within the group limits.",
      );
    command = {
      type: raw.type,
      requestId: raw.requestId,
      quoteId: raw.quoteId,
      expectedFiles: raw.expectedFiles,
      keep: raw.keep,
      uploads: raw.uploads.map((f) => ({
        name: f.name,
        mime: f.mime,
        size: f.size,
        sha256: f.sha256,
      })),
    };
  } else if (raw.type === "cancelGroup" && quoteUuid(raw.groupId))
    command = {
      type: raw.type,
      requestId: raw.requestId,
      quoteId: raw.quoteId,
      groupId: raw.groupId,
    };
  else if (raw.type === "retryJob" && quoteUuid(raw.jobId))
    command = {
      type: raw.type,
      requestId: raw.requestId,
      quoteId: raw.quoteId,
      jobId: raw.jobId,
    };
  else throw new DocumentHttpError(400, "Unsupported original-file action.");
  const result = await serviceRpc("quotation_files_command", {
    actor,
    command,
  });
  await dispatchQuotationJobs().catch(() => {});
  return result;
}
export async function transferQuotationOriginal(
  fileId: string,
  bytes?: Uint8Array,
  requestedOffset?: number,
) {
  const actor = await documentActor();
  let file = rowValue(
    await serviceRpc("quotation_transfer", {
      actor,
      file_id: fileId,
      action: "claim",
    }),
  );
  if (file.complete === true)
    return { complete: true, offset: Number(file.offset) };
  const lease = textValue(file.lease),
    drive = documentDrive(),
    folder = rowValue(file.folder);
  const total = Number(file.size),
    mime = textValue(file.mime),
    identity = quotationOriginalTags(fileId, textValue(file.quote_id));
  const update = async (patch: Record<string, unknown>) => {
    file = rowValue(
      await serviceRpc("quotation_transfer", {
        actor,
        file_id: fileId,
        action: "checkpoint",
        lease_id: lease,
        patch,
      }),
    );
  };
  const finish = async () => {
    await serviceRpc("quotation_transfer", {
      actor,
      file_id: fileId,
      action: "finish",
      lease_id: lease,
    });
    await dispatchQuotationJobs().catch(() => {});
    return { validating: true, offset: total };
  };
  try {
    const projectFolder = textValue(folder.folder_id);
    const parent = await requestDriveParent(
      drive, "quotation-original", fileId, projectFolder, textValue(folder.root_id),
    ) ?? projectFolder;
    return await resumeOriginal(drive, { id: fileId, name: textValue(file.name), mime, size: total,
      offset: Number(file.offset_bytes), driveId: optionalOriginalText(file.drive_file_id), session: optionalOriginalText(file.encrypted_session) },
    parent, identity, update, finish, bytes, requestedOffset);
  } finally {
    await serviceRpc("quotation_transfer", {
      actor,
      file_id: fileId,
      action: "release",
      lease_id: lease,
    }).catch(() => {});
  }
}
export async function processQuotationFileJob(jobId: string) {
  let job = record(
    await serviceRpc("quotation_worker", { job_id: jobId, action: "claim" }),
  );
  if (!job) return;
  const lease = textValue(job.lease);
  const checkpoint = async (patch: Record<string, unknown>) => {
    const next = record(
      await serviceRpc("quotation_worker", {
        job_id: jobId,
        action: "checkpoint",
        lease_id: lease,
        patch,
      }),
    );
    if (!next) throw Error("Quotation processing authority changed");
    job = next;
  };
  try {
    const file = rowValue(job.file),
      folder = rowValue(job.folder),
      drive = documentDrive();
    const identity = quotationOriginalTags(textValue(file.id), textValue(file.quote_id));
    if (job.kind === "validate") {
      const projectFolder = textValue(folder.folder_id);
      const parent = await requestDriveParent(
        drive, "quotation-original", textValue(file.id), projectFolder, textValue(folder.root_id),
      ) ?? projectFolder;
      const intake = record(job.intake);
      let driveId = optionalOriginalText(file.drive_file_id);
      if (intake) {
        if (!driveId) {
          await checkpoint({ intakeDestination: await drive.generateId() });
          driveId = textValue(rowValue(job.file).drive_file_id);
        }
        if (!await drive.find(driveId)) {
          if (intake.trashed === true || Date.parse(textValue(intake.expiresAt)) <= Date.now()) throw new InvalidQuotationOriginal();
          const source = textValue(intake.driveId);
          drive.verifyIdentity(await drive.get(source), textValue(intake.folderId),
            quotationIntakeTags(textValue(intake.intakeId), textValue(file.id)), textValue(file.mime));
          await checkpoint({});
          await drive.copy(source, driveId, parent, textValue(file.name), identity);
        }
      }
      const bytes = await drive.verifyFile(
        driveId,
        parent,
        identity,
        Number(file.size),
        textValue(file.sha256),
        textValue(file.mime),
      );
      await validateQuotationOriginal(bytes, textValue(file.mime));
      await checkpoint({ verified: true });
    } else if (job.kind === "cleanup") {
      if (file.drive_file_id)
        await drive.trash(textValue(file.drive_file_id), identity);
      await checkpoint({ trashed: true });
    } else throw Error("Unknown quotation processing job");
    const result = record(await serviceRpc("quotation_worker", {
      job_id: jobId,
      action: "complete",
      lease_id: lease,
    }));
    if (quoteUuid(result?.intakeCleanup)) await start(quotationIntakeCleanupWorkflow, [result.intakeCleanup]).catch(() => {});
  } catch (error) {
    await serviceRpc("quotation_worker", {
      job_id: jobId,
      action: "fail",
      lease_id: lease,
      patch: { invalid: error instanceof InvalidQuotationOriginal },
    });
  }
}
export function quotationFileError(error: unknown) {
  let status = 503,
    message =
      "Original-file processing is unavailable. Your saved quotation and previous originals are retained. Retry.";
  if (error instanceof DocumentHttpError) {
    status = error.status;
    message = error.message;
  }
  if (error instanceof ServiceCommandError) {
    const errors: Record<string, [number, string]> = {
      "42501": [
        403,
        "Your quotation access changed. Refresh and sign in again if needed.",
      ],
      "40001": [
        409,
        "The original group changed. Review the saved group before retrying.",
      ],
      "55P03": [
        409,
        "This original is still transferring. Wait briefly and retry.",
      ],
      "23505": [
        409,
        "An unfinished original group already exists. Resume or cancel it first.",
      ],
      "23514": [400, "Check the selected originals and group limits."],
      "22P02": [400, "Invalid original-file action."],
      P4201: [
        409,
        "An Administrator or Project Manager must set up the project document folder first.",
      ],
      P4202: [410, "This upload expired. Cancel its group and start again."],
      P4502: [
        409,
        "Reopen the draft and wait for the current MRF approval/archive before changing originals.",
      ],
      P4503: [409, "This retry identity was used for different input."],
      P4551: [409, "An unfinished quotation upload exists. Check its status or cancel it before choosing different originals."],
    };
    if (errors[error.code]) [status, message] = errors[error.code];
  }
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Origin",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
