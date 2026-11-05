import "server-only";
import { createHash } from "node:crypto";
import { start } from "workflow/api";
import { quotationArchiveWorkflow } from "@/src/server/workflows/quotations";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentDrive } from "@/src/server/documents/config";
import { rowValue, textValue } from "@/src/server/documents/state";
import { record } from "@/src/domain/projects/projects";
import {
  parseQuoteBody,
  quoteUuid,
  validQuoteFile,
  type QuoteFile,
} from "@/src/domain/quotations/drafts";
import { parseFinancialReview } from "@/src/domain/quotations/financial";
import { parseCalculation } from "@/src/domain/quotations/revisions";
import { generateQuotationReviewPdf } from "./review-pdf";
import { validateQuotationOriginal } from "./original-validation";
import { validateSupportingPdf } from "@/src/server/documents/pdf-validation";

export async function dispatchQuotationArchives() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const ids = await serviceRpc("quotation_archive_dispatch", {});
  if (!Array.isArray(ids) || !ids.every(quoteUuid))
    throw Error("Invalid quotation archive outbox");
  await Promise.allSettled(
    ids.map((id) => start(quotationArchiveWorkflow, [id])),
  );
}

export async function processQuotationArchive(id: string) {
  if (!quoteUuid(id)) throw Error("Invalid archive job ID");
  let job = record(
    await serviceRpc("quotation_archive_worker", {
      job_id: id,
      action: "claim",
    }),
  );
  if (!job) return;
  const lease = textValue(job.lease);
  const checkpoint = async (patch: Record<string, unknown>) => {
    const next = record(
      await serviceRpc("quotation_archive_worker", {
        job_id: id,
        action: "checkpoint",
        lease_id: lease,
        patch,
      }),
    );
    if (!next) throw Error("Archive authority or processing lease changed");
    job = next;
    return rowValue(next.checkpoint);
  };
  try {
    const revision = rowValue(job.revision),
      snapshot = rowValue(revision.snapshot),
      folder = rowValue(job.folder);
    const source = parseQuoteBody(snapshot.source),
      review = parseFinancialReview(snapshot.review),
      calculation = parseCalculation(snapshot.calculation);
    if (
      !source ||
      !review ||
      !calculation ||
      calculation.issues.length ||
      !Array.isArray(job.files) ||
      !job.files.length ||
      job.files.length > 12
    )
      throw Error("Invalid immutable quotation snapshot");
    const drive = documentDrive(),
      folderId = textValue(folder.folder_id),
      revisionId = textValue(revision.id);
    await drive.validateFolder(folderId, textValue(folder.root_id));
    let saved = rowValue(job.checkpoint);
    const allocate = async (key: string) => {
      if (!saved[key])
        saved = await checkpoint({ [key]: await drive.generateId() });
      return textValue(saved[key]);
    };
    const destination = await allocate("folderId");
    const tags = {
      hmlQuotationRevision: revisionId,
      hmlKind: "quotation-review",
    };
    await drive.ensureFolder(
      destination,
      folderId,
      `Quotation-${source.ref.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100)}-r${textValue(revision.number)}`,
      tags,
    );
    const files: QuoteFile[] = [];
    const manifest: { id: string; size: number; sha256: string }[] = [];
    for (const raw of job.files) {
      const file = record(raw);
      if (
        !file ||
        !quoteUuid(file.id) ||
        !quoteUuid(file.quoteId) ||
        !validQuoteFile(file)
      )
        throw Error("Invalid retained original metadata");
      const originalFolder = rowValue(file.folder);
      await checkpoint({ verified: false });
      const bytes = await drive.verifyFile(
        textValue(file.driveFileId),
        textValue(originalFolder.folder_id),
        {
          hmlQuotationFile: file.id,
          hmlQuotation: file.quoteId,
          hmlKind: "quotation-original",
        },
        file.size,
        file.sha256,
        file.mime,
      );
      await validateQuotationOriginal(bytes, file.mime);
      files.push({
        id: file.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        sha256: file.sha256,
      });
      manifest.push({ id: file.id, size: file.size, sha256: file.sha256 });
    }
    const bytes = await generateQuotationReviewPdf({
      id: revisionId,
      number: textValue(revision.number),
      finalizedAt: textValue(revision.finalized_at),
      finalizedBy: textValue(revision.finalized_name),
      mrfRef: textValue(snapshot.mrfRef),
      mrfArchiveId: textValue(revision.mrf_archive_id),
      source,
      review,
      calculation,
      files,
    });
    if (bytes.length > 50 * 1024 * 1024)
      throw Error("Review PDF exceeds its archive bound");
    await validateSupportingPdf(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex"),
      fileId = await allocate("pdfFileId");
    if (!(await drive.find(fileId))) {
      const uri = await drive.begin(
        fileId,
        destination,
        `Internal-quotation-review-r${textValue(revision.number)}.pdf`,
        bytes.length,
        tags,
      );
      if (uri)
        for (let offset = 0; offset < bytes.length; ) {
          const result = await drive.transfer(
            uri,
            bytes.length,
            bytes.subarray(offset, offset + 3 * 1024 * 1024),
            offset,
          );
          if (result.expired || result.offset <= offset)
            throw Error("Archive upload interrupted");
          offset = result.offset;
        }
    }
    await drive.verifyPdf(fileId, destination, tags, bytes.length, sha256);
    await checkpoint({
      pdfFileId: fileId,
      pdfSha256: sha256,
      pdfSize: bytes.length,
      manifest,
      verified: true,
    });
    await serviceRpc("quotation_archive_worker", {
      job_id: id,
      action: "complete",
      lease_id: lease,
    });
  } catch {
    await serviceRpc("quotation_archive_worker", {
      job_id: id,
      action: "fail",
      lease_id: lease,
    });
  }
}
