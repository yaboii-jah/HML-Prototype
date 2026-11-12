import "server-only";
import { start } from "workflow/api";
import { paymentFileWorkflow } from "@/src/server/workflows/payments";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import {
  documentActor,
  DocumentHttpError,
} from "@/src/server/documents/access";
import { documentDrive } from "@/src/server/documents/config";
import { rowValue, textValue } from "@/src/server/documents/state";
import {
  sealUploadTicket,
  openUploadTicket,
} from "@/src/server/upload-ticket-codec";
import { record } from "@/src/domain/projects/projects";
import {
  QUOTE_CHUNK_SIZE,
  QUOTE_GROUP_LIMIT,
  quoteUuid,
  validQuoteFile,
} from "@/src/domain/quotations/drafts";
import {
  validateQuotationOriginal,
  InvalidQuotationOriginal,
} from "../quotations/original-validation";

const tags = (fileId: string, draftId: string) => ({
  hmlPaymentFile: fileId,
  hmlPayment: draftId,
  hmlKind: "payment-proof",
});
export async function dispatchPaymentJobs() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const jobs = await serviceRpc("payment_dispatch", {});
  if (!Array.isArray(jobs) || !jobs.every(quoteUuid))
    throw Error("Invalid quotation outbox");
  await Promise.allSettled(
    jobs.map((id) => start(paymentFileWorkflow, [id])),
  );
}
export async function paymentFileCommand(input: unknown) {
  const actor = await documentActor(),
    raw = record(input);
  if (actor.activeRole !== "Accounting")
    throw new DocumentHttpError(
      403,
      "Use Accounting to manage payment proof.",
    );
  if (
    !raw ||
    !quoteUuid(raw.requestId) ||
    !quoteUuid(raw.draftId) ||
    JSON.stringify(raw).length > 16384
  )
    throw new DocumentHttpError(400, "Invalid payment-proof action.");
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
        "Choose up to 12 valid proofs within the group limits.",
      );
    command = {
      type: raw.type,
      requestId: raw.requestId,
      draftId: raw.draftId,
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
      draftId: raw.draftId,
      groupId: raw.groupId,
    };
  else if (raw.type === "retryJob" && quoteUuid(raw.jobId))
    command = {
      type: raw.type,
      requestId: raw.requestId,
      draftId: raw.draftId,
      jobId: raw.jobId,
    };
  else throw new DocumentHttpError(400, "Unsupported payment-proof action.");
  const result = await serviceRpc("payment_files_command", {
    actor,
    command,
  });
  await dispatchPaymentJobs().catch(() => {});
  return result;
}
export async function transferPaymentProof(
  fileId: string,
  bytes?: Uint8Array,
  requestedOffset?: number,
) {
  const actor = await documentActor();
  let file = rowValue(
    await serviceRpc("payment_transfer", {
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
    identity = tags(fileId, textValue(file.draft_id));
  const update = async (patch: Record<string, unknown>) => {
    file = rowValue(
      await serviceRpc("payment_transfer", {
        actor,
        file_id: fileId,
        action: "checkpoint",
        lease_id: lease,
        patch,
      }),
    );
  };
  const finish = async () => {
    await serviceRpc("payment_transfer", {
      actor,
      file_id: fileId,
      action: "finish",
      lease_id: lease,
    });
    await dispatchPaymentJobs().catch(() => {});
    return { validating: true, offset: total };
  };
  try {
    await drive.validateFolder(
      textValue(folder.folder_id),
      textValue(folder.root_id),
    );
    if (!file.drive_file_id)
      await update({ driveFileId: await drive.generateId() });
    const providerId = textValue(file.drive_file_id);
    const existing = await drive.find(providerId);
    if (existing && existing.size === String(total)) {
      drive.verifyIdentity(
        existing,
        textValue(folder.folder_id),
        identity,
        mime,
      );
      return await finish();
    }
    let uri: string | null = null;
    if (file.encrypted_session)
      uri = openUploadTicket<{ fileId: string; uri: string }>(
        textValue(file.encrypted_session),
        (v) => v.fileId === fileId && drive.validSession(v.uri),
        "Invalid stored upload session.",
      ).uri;
    const begin = async () => {
      const uri = await drive.begin(
        providerId,
        textValue(folder.folder_id),
        textValue(file.name),
        total,
        identity,
        mime,
      );
      if (!uri) throw Error("Unconfirmed provider original");
      await update({ session: sealUploadTicket({ fileId, uri }) });
      return uri;
    };
    if (!uri) uri = await begin();
    let progress = await drive.transfer(uri, total, undefined, 0, mime);
    if (progress.expired) {
      if (Number(file.offset_bytes) !== 0)
        throw new DocumentHttpError(
          410,
          "Upload expired. Cancel this group and upload the proofs again.",
        );
      uri = await begin();
      progress = await drive.transfer(uri, total, undefined, 0, mime);
    }
    if (progress.complete) return await finish();
    if (progress.offset < Number(file.offset_bytes))
      throw new DocumentHttpError(
        410,
        "Provider bytes are no longer available. Cancel the group and upload again.",
      );
    if (bytes) {
      if (requestedOffset !== progress.offset)
        throw new DocumentHttpError(
          409,
          "Confirmed offset changed. Check status and resume.",
        );
      if (
        !bytes.length ||
        bytes.length > QUOTE_CHUNK_SIZE ||
        progress.offset + bytes.length > total ||
        (progress.offset + bytes.length < total && bytes.length % (256 * 1024))
      )
        throw new DocumentHttpError(400, "Invalid payment-proof chunk.");
      progress = await drive.transfer(uri, total, bytes, progress.offset, mime);
      if (progress.expired)
        throw new DocumentHttpError(
          410,
          "Upload expired. Cancel the group and upload again.",
        );
    }
    await update({ offset: progress.offset });
    return progress.complete
      ? await finish()
      : { offset: progress.offset, total };
  } finally {
    await serviceRpc("payment_transfer", {
      actor,
      file_id: fileId,
      action: "release",
      lease_id: lease,
    }).catch(() => {});
  }
}
export async function processPaymentFileJob(jobId: string) {
  let job = record(
    await serviceRpc("payment_worker", { job_id: jobId, action: "claim" }),
  );
  if (!job) return;
  const lease = textValue(job.lease);
  const checkpoint = async (patch: Record<string, unknown>) => {
    const next = record(
      await serviceRpc("payment_worker", {
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
    const identity = tags(textValue(file.id), textValue(file.draft_id));
    if (job.kind === "validate") {
      await drive.validateFolder(
        textValue(folder.folder_id),
        textValue(folder.root_id),
      );
      const bytes = await drive.verifyFile(
        textValue(file.drive_file_id),
        textValue(folder.folder_id),
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
    await serviceRpc("payment_worker", {
      job_id: jobId,
      action: "complete",
      lease_id: lease,
    });
  } catch (error) {
    await serviceRpc("payment_worker", {
      job_id: jobId,
      action: "fail",
      lease_id: lease,
      patch: { invalid: error instanceof InvalidQuotationOriginal },
    });
  }
}
export function paymentFileError(error: unknown) {
  let status = 503,
    message =
      "Original-file processing is unavailable. Your saved payment draft and previous proofs are retained. Retry.";
  if (error instanceof DocumentHttpError) {
    status = error.status;
    message = error.message;
  }
  if (error instanceof ServiceCommandError) {
    const errors: Record<string, [number, string]> = {
      "42501": [
        403,
        "Your payment access changed. Refresh and sign in again if needed.",
      ],
      "40001": [
        409,
        "The proof group changed. Review the saved group before retrying.",
      ],
      "55P03": [
        409,
        "This original is still transferring. Wait briefly and retry.",
      ],
      "23505": [
        409,
        "An unfinished proof group already exists. Resume or cancel it first.",
      ],
      "23514": [400, "Check the selected proofs and group limits."],
      "22P02": [400, "Invalid payment-proof action."],
      P4201: [
        409,
        "An Administrator or Project Manager must set up the project document folder first.",
      ],
      P4202: [410, "This upload expired. Cancel its group and start again."],
      P4114: [
        409,
        "Choose an editable payment draft on an issued PO before changing proof files.",
      ],
      P4503: [409, "This retry identity was used for different input."],
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
