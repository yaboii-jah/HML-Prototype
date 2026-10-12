"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { CloseButton } from "@/src/components/ui/CloseButton";
import { DocumentLoading } from "@/src/components/ui/Skeleton";
import { InlineError } from "@/src/components/ui/Primitives";
import type { BidReport } from "@/src/domain/types";
import { getBidWorkbook } from "./bid-report-files";

export function BidReportPreview({ report, onClose }: { report: BidReport; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    let url = "";
    // No command callback: preview only reads the frozen, hash-verified PDF.
    getBidWorkbook(report, undefined, "pdf").then(({ blob }) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPreview({ blob, url });
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "The saved PDF could not be opened.");
    });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [report]);

  return <dialog ref={dialogRef} className="bid-report-preview" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id={titleId}>Bid comparison v{report.version}</h2><p className="helper-note">Saved PDF · {report.data.project.name}</p></div><CloseButton aria-label="Close bid comparison preview" onClick={onClose}/></header>
    <div className="bid-report-preview-content">{error ? <InlineError message={error}/> : preview ? <PdfDocumentViewer blob={preview.blob} fileName={report.pdf!.fileName} sourceUrl={preview.url}/> : <DocumentLoading/>}</div>
  </dialog>;
}
