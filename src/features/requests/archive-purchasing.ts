import { uploadDocument, uploadResponse as responseJson } from "../../documents/resumable-upload.ts";
import { archiveLocal, previewPdf } from "./local-archive.ts";
import { archiveReady } from "../../domain/archive-destination.ts";
import type { ArchiveProgressListener } from "../../domain/archive-progress.ts";
import type { Command, CommandResult } from "@/src/domain/commands";
import type { DemoSnapshot, PO, Quote } from "@/src/domain/types";
import { readQuoteFile } from "../../documents/files.ts";

type Run = (command: Command) => Promise<CommandResult>;
export async function syncFinalizedQuote(state: DemoSnapshot, quote: Quote, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const mrf = state.requests.find(value => value.id === quote.mrfId);
    const site = state.sites.find(value => value.id === mrf?.siteId);
    if (!mrf || !archiveReady(site) || !site || quote.archive?.status !== "pending") throw new Error("The quotation or mapped project Drive folder is missing.");
    const previous = state.quotes.find(value => value.id === quote.supersedesId);
    const files = [];
    for (const [index, document] of quote.documents.entries()) {
      if (!document.fileId) throw new Error("Attach the supplier's original quotation document.");
      const reused = previous?.archive?.status === "complete" ? previous.archive.files.find(value => value.localFileId === document.fileId) : undefined;
      if (reused) { files.push(reused); continue; }
      const blob = await readQuoteFile(document.fileId);
      if (!blob) throw new Error(`The original quotation file ${document.name} is unavailable. Create a revision and attach it again.`);
      if (site.localArchiveId) {
        const local = await archiveLocal(site, blob, progress);
        files.push({ localFileId: document.fileId, driveFileId: local.fileId, url: local.url, name: document.name });
        continue;
      }
      const start = await responseJson(await fetch("/api/drive/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote, mrf, projectFolderId: site.driveFolderId, index, size: blob.size }) }));
      const result = start.driveFileId && start.url ? start : start.ticket && Number.isInteger(start.offset) ? await uploadDocument(blob, start.ticket, start.offset!, "/api/drive/quotes/chunk", value => progress?.({ ...value, fileIndex: index + 1, fileCount: quote.documents.length })) : undefined;
      if (!result?.driveFileId || !result.url) throw new Error("Drive did not confirm the quotation file.");
      files.push({ localFileId: document.fileId, driveFileId: result.driveFileId, url: result.url, name: document.name });
    }
    const saved = await run({ type: "completeQuoteArchive", id: quote.id, files });
    if (!saved.ok) throw new Error(saved.message);
    return { ok: true, message: saved.message };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Quotation Drive archive failed.";
    await run({ type: "failQuoteArchive", id: quote.id, error: message });
    return { ok: false, message };
  }
}

export async function syncApprovedPO(state: DemoSnapshot, po: PO, run: Run, progress?: ArchiveProgressListener) {
  try {
    progress?.({ phase: "preparing" });
    const mrf = state.requests.find(value => value.id === po.mrfId);
    const quote = state.quotes.find(value => value.id === po.quoteId);
    const site = state.sites.find(value => value.id === mrf?.siteId);
    if (!mrf || !quote || !archiveReady(site) || !site || po.archive?.status !== "pending") throw new Error("The PO or mapped project Drive folder is missing.");
    if (site.localArchiveId) {
      const local = await archiveLocal(site, await previewPdf({ kind: "po", request: mrf, po, quote, project: site }), progress);
      const saved = await run({ type: "completePOArchive", id: po.id, fileId: local.fileId, url: local.url });
      if (!saved.ok) throw new Error(saved.message);
      return { ok: true, message: saved.message };
    }
    const result = await responseJson(await fetch("/api/drive/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ po, mrf, quote, projectFolderId: site.driveFolderId, projectName: site.name }) }));
    if (!result.fileId || !result.url) throw new Error("Drive did not confirm the PO PDF.");
    const saved = await run({ type: "completePOArchive", id: po.id, fileId: result.fileId, url: result.url });
    if (!saved.ok) throw new Error(saved.message);
    return { ok: true, message: saved.message };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "PO Drive archive failed.";
    await run({ type: "failPOArchive", id: po.id, error: message });
    return { ok: false, message };
  }
}
