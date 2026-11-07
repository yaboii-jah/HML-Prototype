import "server-only";
import { createHash } from "node:crypto";
import { start } from "workflow/api";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { documentDrive } from "@/src/server/documents/config";
import { rowValue, textValue } from "@/src/server/documents/state";
import { record } from "@/src/domain/projects/projects";
import { id, parsePurchasingView } from "@/src/domain/purchasing/contracts";
import { approvedPoArchiveWorkflow } from "@/src/server/workflows/purchasing";
import { validateSupportingPdf } from "@/src/server/documents/pdf-validation";
import { generatePurchasingPoPreview } from "./documents";

export async function dispatchApprovedPoArchives() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") return;
  const jobs = await serviceRpc("po_archive_dispatch", {});
  if (!Array.isArray(jobs) || !jobs.every(id)) throw Error("Invalid PO archive outbox.");
  await Promise.allSettled(jobs.map((jobId) => start(approvedPoArchiveWorkflow, [jobId])));
}

export async function processApprovedPoArchive(jobId: string) {
  if (!id(jobId)) throw Error("Invalid PO archive.");
  let job = record(await serviceRpc("po_archive_worker", { job_id: jobId, action: "claim" }));
  if (!job) return;
  const lease = textValue(job.lease);
  const checkpoint = async (patch: Record<string, unknown>) => {
    const next = record(await serviceRpc("po_archive_worker", {
      job_id: jobId, action: "checkpoint", lease_id: lease, patch,
    }));
    if (!next) throw Error("PO archive authority or lease changed.");
    job = next;
    return rowValue(next.checkpoint);
  };
  try {
    const approval = rowValue(job.approval), snapshot = rowValue(approval.snapshot);
    const view = parsePurchasingView(snapshot.view), frozenPo = rowValue(snapshot.po);
    const po = view?.records.find((r) => r.id === frozenPo.id);
    if (!view || !po || !po.calculation || po.calculation.issues.length) throw Error("Invalid frozen PO approval.");
    const approvedBy = rowValue(snapshot.approvedBy), folder = rowValue(job.folder);
    const drive = documentDrive(), folderId = textValue(folder.folder_id);
    const mime = "application/pdf";
    const tags = { hmlPoArchive: jobId, hmlPoApproval: textValue(approval.id), hmlKind: "approved-po" };
    await drive.validateFolder(folderId, textValue(folder.root_id));
    let saved = rowValue(job.checkpoint);
    if (!saved.fileId) saved = await checkpoint({ fileId: await drive.generateId() });
    const fileId = textValue(saved.fileId);
    if (saved.sha256 && typeof saved.size === "number" && await drive.find(fileId)) {
      await drive.verifyFile(fileId, folderId, tags, saved.size, textValue(saved.sha256), mime);
    } else {
      const bytes = await generatePurchasingPoPreview(view, po, {
        name: textValue(approvedBy.name), at: textValue(snapshot.approvedAt), version: textValue(approval.version),
      });
      if (bytes.length < 5 || bytes.length > 50 * 1024 * 1024) throw Error("Approved PO exceeds its document bound.");
      await validateSupportingPdf(bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await checkpoint({ sha256, size: bytes.length, verified: false });
      if (!(await drive.find(fileId))) {
        const name = `${(po.ref || "PO").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)}-approval-v${textValue(approval.version)}.pdf`;
        const uri = await drive.begin(fileId, folderId, name, bytes.length, tags, mime);
        if (uri) {
          for (let offset = 0; offset < bytes.length;) {
            const result = await drive.transfer(uri, bytes.length, bytes.subarray(offset, offset + 3 * 1024 * 1024), offset, mime);
            if (result.expired || result.offset <= offset) throw Error("PO archive upload interrupted.");
            offset = result.offset;
          }
        }
      }
      await drive.verifyFile(fileId, folderId, tags, bytes.length, sha256, mime);
    }
    await checkpoint({ verified: true });
    await serviceRpc("po_archive_worker", { job_id: jobId, action: "complete", lease_id: lease });
  } catch {
    await serviceRpc("po_archive_worker", { job_id: jobId, action: "fail", lease_id: lease });
  }
}
