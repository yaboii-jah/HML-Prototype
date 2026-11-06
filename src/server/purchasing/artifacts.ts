import "server-only";
import { createHash } from "node:crypto";
import { start } from "workflow/api";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentDrive } from "@/src/server/documents/config";
import { rowValue, textValue } from "@/src/server/documents/state";
import { record } from "@/src/domain/projects/projects";
import { id } from "@/src/domain/purchasing/contracts";
import { parseComparisonSnapshot } from "@/src/domain/purchasing/pricing";
import { comparisonArtifactWorkflow } from "@/src/server/workflows/purchasing";
import {
  generatePurchasingComparisonPdf,
  generatePurchasingComparisonWorkbook,
  XLSX_MIME,
} from "./documents";
import { validateSupportingPdf } from "@/src/server/documents/pdf-validation";

export async function dispatchComparisonArtifacts() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const jobs = await serviceRpc("comparison_dispatch", {});
  if (!Array.isArray(jobs) || !jobs.every(id))
    throw Error("Invalid comparison outbox.");
  await Promise.allSettled(
    jobs.map((jobId) => start(comparisonArtifactWorkflow, [jobId])),
  );
}
export async function processComparisonArtifact(jobId: string) {
  if (!id(jobId)) throw Error("Invalid comparison artifact.");
  let job = record(
    await serviceRpc("comparison_worker", { job_id: jobId, action: "claim" }),
  );
  if (!job) return;
  const lease = textValue(job.lease);
  const checkpoint = async (patch: Record<string, unknown>) => {
    const next = record(
      await serviceRpc("comparison_worker", {
        job_id: jobId,
        action: "checkpoint",
        lease_id: lease,
        patch,
      }),
    );
    if (!next) throw Error("Artifact authority or lease changed.");
    job = next;
    return rowValue(next.checkpoint);
  };
  try {
    const report = rowValue(job.report),
      snapshot = parseComparisonSnapshot(report.snapshot),
      folder = rowValue(job.folder);
    if (!snapshot || (job.format !== "pdf" && job.format !== "xlsx"))
      throw Error("Invalid immutable comparison.");
    const drive = documentDrive(),
      folderId = textValue(folder.folder_id),
      mime = job.format === "pdf" ? "application/pdf" : XLSX_MIME;
    await drive.validateFolder(folderId, textValue(folder.root_id));
    let saved = rowValue(job.checkpoint);
    if (!saved.fileId)
      saved = await checkpoint({ fileId: await drive.generateId() });
    const fileId = textValue(saved.fileId),
      tags = {
        hmlComparisonArtifact: jobId,
        hmlComparison: textValue(report.id),
        hmlKind: "comparison",
      };
    if (
      saved.sha256 &&
      typeof saved.size === "number" &&
      (await drive.find(fileId))
    ) {
      await drive.verifyFile(
        fileId,
        folderId,
        tags,
        saved.size,
        textValue(saved.sha256),
        mime,
      );
    } else {
      const bytes =
        job.format === "pdf"
          ? await generatePurchasingComparisonPdf(
              snapshot,
              textValue(report.version),
            )
          : await generatePurchasingComparisonWorkbook(
              snapshot,
              textValue(report.version),
            );
      if (bytes.length < 5 || bytes.length > 50 * 1024 * 1024)
        throw Error("Comparison artifact exceeds its bound.");
      if (job.format === "pdf") await validateSupportingPdf(bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await checkpoint({ sha256, size: bytes.length, verified: false });
      if (!(await drive.find(fileId))) {
        const uri = await drive.begin(
          fileId,
          folderId,
          `Comparison-${snapshot.ref.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)}-v${textValue(report.version)}.${job.format}`,
          bytes.length,
          tags,
          mime,
        );
        if (uri)
          for (let offset = 0; offset < bytes.length; ) {
            const result = await drive.transfer(
              uri,
              bytes.length,
              bytes.subarray(offset, offset + 3 * 1024 * 1024),
              offset,
              mime,
            );
            if (result.expired || result.offset <= offset)
              throw Error("Artifact upload interrupted.");
            offset = result.offset;
          }
      }
      await drive.verifyFile(
        fileId,
        folderId,
        tags,
        bytes.length,
        sha256,
        mime,
      );
    }
    await checkpoint({ verified: true });
    await serviceRpc("comparison_worker", {
      job_id: jobId,
      action: "complete",
      lease_id: lease,
    });
  } catch {
    await serviceRpc("comparison_worker", {
      job_id: jobId,
      action: "fail",
      lease_id: lease,
    });
  }
}
