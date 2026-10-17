import { archiveLocal } from "../requests/local-archive.ts";
import { archiveReady } from "../../domain/archive-destination.ts";
import { isExternalCredit, proofAssigned } from "../../domain/full-disbursement.ts";
import type { CommandRunner } from "../../app-state/command-gateway.ts";
import type { DemoSnapshot, PaymentProof } from "../../domain/types.ts";
import { accountingSignature, ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE, MAX_ACCOUNTING_BATCH } from "../../domain/accounting-documents.ts";
import { newId } from "../../domain/ids.ts";
import { saveGeneratedFile, readQuoteFile, deleteLocalFile } from "../requests/quote-files.ts";
import { workbookDigest } from "../requests/bid-report-files.ts";
import { uploadDocument } from "../requests/archive-purchasing.ts";
export async function attachPaymentProofFiles(state: DemoSnapshot, poId: string, files: File[], run: CommandRunner) {
  const po = state.pos.find(po => po.id === poId);
  const existing = po?.paymentProofs?.filter(proof => !isExternalCredit(po) || !proofAssigned(po!, proof.id)) || [];
  if (!files.length || files.length + existing.length > 12 || files.some(file => file.size < 12 || file.size > MAX_ACCOUNTING_FILE || !ACCOUNTING_MIMES.some(mime => mime === file.type)) || [...files, ...existing].reduce((sum, value) => sum + value.size, 0) > MAX_ACCOUNTING_BATCH) throw new Error("Use up to 12 PDF/image files, 20 MB each and 45 MB total.");
  for (const file of files) if (!accountingSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) throw new Error(`${file.name} does not match its file type.`);
  const documents: Pick<PaymentProof, "name" | "mime" | "size" | "localFileId" | "sha256">[] = [], written: string[] = [];
  try {
    for (const file of files) { const localFileId = newId("proof-file"); await saveGeneratedFile(localFileId, file); written.push(localFileId); documents.push({ name: file.name, mime: file.type as PaymentProof["mime"], size: file.size, localFileId, sha256: await workbookDigest(file) }); }
    const result = await run({ type: "attachPaymentProofs", poId, documents });
    if (!result.ok) throw new Error(result.message);
    return { snapshot: result.snapshot, proofs: result.snapshot.pos.find(po => po.id === poId)!.paymentProofs!.filter(proof => written.includes(proof.localFileId)) };
  } catch (cause) { await Promise.allSettled(written.map(deleteLocalFile)); throw cause; }
}
export async function archivePaymentProof(state: DemoSnapshot, poId: string, proof: PaymentProof, run: CommandRunner) {
  if (proof.archive.status === "complete") return;
  try {
    const po = state.pos.find(value => value.id === poId), mrf = state.requests.find(value => value.id === po?.mrfId), site = state.sites.find(value => value.id === mrf?.siteId);
    if (!po || !mrf || !site || !archiveReady(site)) throw new Error("A project Drive folder is required.");
    const blob = await readQuoteFile(proof.localFileId);
    if (!blob || await workbookDigest(blob) !== proof.sha256) throw new Error("The original proof is unavailable. Remove and attach it again.");
    if (site.localArchiveId) {
      const local = await archiveLocal(site, blob);
      const saved = await run({ type: "completePaymentProofArchive", poId, documentId: proof.id, fileId: local.fileId, url: local.url });
      if (!saved.ok) throw new Error(saved.message);
      return;
    }
    const response = await fetch("/api/drive/payment-proof", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof, po, mrf, projectFolderId: site.driveFolderId }) });
    const start = await response.json(); if (!response.ok) throw new Error(start.error || "Proof archive failed.");
    const finish = start.driveFileId && start.url ? start : start.ticket ? await uploadDocument(blob, start.ticket, start.offset || 0, "/api/drive/payment-proof/chunk") : undefined;
    if (!finish?.driveFileId || !finish.url) throw new Error("Drive did not confirm the proof upload.");
    const saved = await run({ type: "completePaymentProofArchive", poId, documentId: proof.id, fileId: finish.driveFileId, url: finish.url });
    if (!saved.ok) throw new Error(saved.message);
  } catch (cause) { await run({ type: "failPaymentProofArchive", poId, documentId: proof.id, error: cause instanceof Error ? cause.message : "Proof archive failed." }); throw cause; }
}
