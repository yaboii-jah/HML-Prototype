"use client";

import { useState } from "react";
import { demoRepository } from "@/src/mock/repository";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { Badge, InlineError } from "@/src/components/ui/Primitives";
import { auditTime } from "@/src/domain/audit";
import { isSiteBatch } from "@/src/domain/delivery-flow";
import type { Batch, DemoSnapshot } from "@/src/domain/types";

export function useDeliveryReceiptArchive() {
  const { beginOperation } = useDemo();
  const { perform } = useArchive();
  return async (state: DemoSnapshot, batchId: string) => {
    const batch = state.batches.find(value => value.id === batchId);
    if (!batch) return;
    const failures: string[] = [];
    for (const savedReceipt of batch.receiptVersions || []) {
      const receipt = demoRepository.getSnapshot().snapshot?.batches.find(value => value.id === batchId)?.receiptVersions?.find(value => value.id === savedReceipt.id) || savedReceipt;
      if (receipt.archive.status === "complete") continue;
      try { await perform(`delivery-receipt-${receipt.id}`, `${batch.ref}: receipt v${receipt.version}`, async progress => {
        const pipeline = await beginOperation({ kind: "delivery-receipt", batchId, receiptId: receipt.id });
        try {
          progress({ phase: "preparing" });
          const request = state.requests.find(value => value.id === receipt.data.request.id);
          const folder = state.sites.find(value => value.id === request?.siteId)?.driveFolderId;
          if (!folder) throw new Error("A project Google Drive folder is required. Receipt confirmation remains saved.");
          const response = await fetch("/api/drive/delivery-receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt, projectFolderId: folder }) });
          const result = await response.json();
          if (!response.ok || !result.driveFileId || !result.url) throw new Error(result.error || "Drive did not confirm this receipt archive.");
          const saved = await pipeline({ type: "completeDeliveryReceiptArchive", batchId, receiptId: receipt.id, fileId: result.driveFileId, url: result.url });
          if (!saved.ok) throw new Error(saved.message);
          progress({ phase: "complete" });
        } catch (cause) {
          await pipeline({ type: "failDeliveryReceiptArchive", batchId, receiptId: receipt.id, error: cause instanceof Error ? cause.message : "Receipt archive needs retry." });
          throw cause;
        }
      }, { kind: "delivery-receipt", batchId, receiptId: receipt.id }); } catch (cause) { failures.push(cause instanceof Error ? cause.message : "Receipt archive needs retry."); }
    }
    if (failures.length) throw new Error(failures.join(" "));
  };
}

export function DeliveryReceiptArchive({ batch, readOnly = false }: { batch: Batch; readOnly?: boolean }) {
  const { snapshot: state, run } = useDemo();
  const { jobs } = useArchive();
  const archive = useDeliveryReceiptArchive();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (!state) return null;
  const receipts = batch.receiptVersions || [], current = receipts.at(-1);
  const eligible = !readOnly && ["Accounting / Auditing", "Administrator", isSiteBatch(batch) ? "Site Personnel" : "Procurement"].includes(state.role);
  const active = busy || receipts.some(receipt => jobs.some(job => job.id === `delivery-receipt-${receipt.id}` && job.phase !== "complete" && !job.error));
  const retry = async () => {
    if (active) return; setBusy(true); setError("");
    try {
      const result = await run({ type: "captureDeliveryReceipt", id: batch.id });
      if (!result.ok) throw new Error(result.message);
      await archive(result.snapshot, batch.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt archive needs retry."); }
    finally { setBusy(false); }
  };
  return <div className="generated-delivery-receipt" aria-busy={active}>
    <div><strong>Generated receipt{current ? ` · v${current.version}` : ""}</strong><small>{current ? `Confirmation snapshot · ${auditTime(current.createdAt)}` : "Existing delivery: archive a snapshot of its recorded quantities."}</small><Badge>{active ? "Archiving" : current?.archive.status === "complete" ? "Archived" : current?.archive.error ? "Needs retry" : "Not archived"}</Badge></div>
    <div className="button-row">{current?.archive.url && <a className="button secondary" href={current.archive.url} target="_blank" rel="noreferrer">Open receipt</a>}{eligible && (!current || receipts.some(receipt => receipt.archive.status !== "complete")) && <button type="button" className="button secondary" disabled={active} onClick={retry}>{active ? "Archiving..." : current ? "Retry archive" : "Archive generated receipt"}</button>}</div>
    {current?.archive.error && <p className="field-error">{current.archive.error}</p>}
    {receipts.length > 1 && <details className="receipt-history"><summary>Previous receipt versions ({receipts.length - 1})</summary>{receipts.slice(0, -1).map(receipt => <div key={receipt.id}><span>v{receipt.version} · {auditTime(receipt.createdAt)} · {receipt.archive.status === "complete" ? "Archived" : "Needs archive"}</span>{receipt.archive.url && <a href={receipt.archive.url} target="_blank" rel="noreferrer">Open original</a>}</div>)}</details>}
    <InlineError message={error}/>
  </div>;
}
