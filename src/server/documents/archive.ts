import "server-only";
import { createHash } from "node:crypto";
import { parseMrfDraft, uuid } from "@/src/domain/requests/drafts";
import { record } from "@/src/domain/projects/projects";
import { generateMrfPdf } from "@/src/server/template-mrf-pdf";
import type { DriveGateway } from "./drive-gateway";
import { validateSupportingPdf } from "./pdf-validation";

function required(value: unknown) {
  if (typeof value !== "string" || !value) throw Error("Invalid archive snapshot");
  return value;
}
/** No public caller accepts this snapshot. The future approval transaction creates
 * the immutable row and job; this engine only consumes that committed identity.
 */
export async function archiveApprovedMrf(job: Record<string, unknown>, drive: DriveGateway, checkpoint: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const snapshot = record(job.snapshot), source = record(job.source), folder = record(job.folder);
  const frozen = record(snapshot?.snapshot), draft = parseMrfDraft(frozen?.draft);
  if (!snapshot || !source || !folder || !frozen || !draft || !uuid(snapshot.approved_by) || !required(snapshot.approved_name) || !(Number(snapshot.request_version) > 0) || !(Number(snapshot.attachment_revision) > 0) || !Number.isFinite(Date.parse(required(snapshot.approved_at)))
    || !draft.items.length || draft.items.some(item => !item.quantity || !item.name || !item.unit)) throw Error("Invalid approved snapshot");
  const ref = required(frozen.ref), projectName = required(frozen.projectName), projectLocation = required(frozen.projectLocation);
  const mappingId = required(folder.folder_id), root = required(folder.root_id), snapshotId = required(snapshot.id);
  await drive.validateFolder(mappingId, root);
  let saved = record(job.checkpoint) ?? {};
  const allocate = async (key: string) => {
    if (!saved[key]) saved = await checkpoint({ [key]: await drive.generateId() });
    return required(saved[key]);
  };
  const requestFolderId = await allocate("requestFolderId"), formFolderId = await allocate("formFolderId"), supportFolderId = await allocate("supportFolderId");
  const requestTag = { hmlRequestId: required(snapshot.request_id), hmlSnapshotId: snapshotId };
  await drive.ensureFolder(requestFolderId, mappingId, `${ref}-v${snapshot.version}`, requestTag);
  await drive.ensureFolder(formFolderId, requestFolderId, "MRF Form", requestTag);
  await drive.ensureFolder(supportFolderId, requestFolderId, "Supporting Documents", requestTag);
  const sourceBytes = await drive.bytes(required(source.drive_file_id), Number(source.size));
  if (sourceBytes.length !== Number(source.size) || createHash("sha256").update(sourceBytes).digest("hex") !== source.sha256) throw Error("Approved source integrity mismatch");
  await validateSupportingPdf(sourceBytes);
  const items = draft.items.map(item => ({ ...item, quantity: required(item.quantity) }));
  const formBytes = await generateMrfPdf({ ...draft, ref, items, documents: [{ type: "Supporting PDF", name: required(source.name) }] }, projectName, projectLocation, undefined, required(snapshot.approved_at));
  const formSha256 = createHash("sha256").update(formBytes).digest("hex");
  const formFileId = await allocate("formFileId"), supportingFileId = await allocate("supportingFileId");
  const upload = async (id: string, parent: string, name: string, bytes: Uint8Array, sha256: string, kind: string) => {
    const tags = { ...requestTag, hmlKind: kind };
    if (!await drive.find(id)) {
      const uri = await drive.begin(id, parent, name, bytes.length, tags);
      if (uri) {
        for (let offset = 0; offset < bytes.length;) {
          const result = await drive.transfer(uri, bytes.length, bytes.subarray(offset, offset + 3 * 1024 * 1024), offset);
          if (result.expired || result.offset <= offset) throw Error("Archive upload interrupted");
          offset = result.offset;
        }
      }
    }
    await drive.verifyPdf(id, parent, tags, bytes.length, sha256);
  };
  await upload(formFileId, formFolderId, `${ref}-v${snapshot.version}.pdf`, formBytes, formSha256, "approved-mrf");
  await upload(supportingFileId, supportFolderId, `${ref}-support-v${snapshot.version}.pdf`, sourceBytes, required(source.sha256), "approved-support");
  await checkpoint({ formFileId, supportingFileId, formSha256, supportingSha256: source.sha256, formSize: formBytes.length, supportingSize: sourceBytes.length, verified: true });
}
