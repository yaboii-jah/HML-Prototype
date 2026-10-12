"use client";

import { useEffect, useRef, useState } from "react";
import type { Batch, MRF, PO, Quote, Site } from "@/src/domain/types";
import { PdfDocumentViewer } from "./PdfDocumentViewer";
import { CloseButton } from "./ui/CloseButton";
import { archiveFileName, prefixedReference } from "@/src/domain/document-numbering";
import { DocumentLoading } from "./ui/Skeleton";

export function DocumentPreview({ kind, request, po, quote, project, batch, parentBatch }: { kind: "mrf" | "po" | "delivery"; request: MRF; po?: PO; quote?: Quote; project: Site; batch?: Batch; parentBatch?: Batch }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), invoker = useRef<HTMLButtonElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const pending = useRef<AbortController | null>(null);
  const title = kind === "delivery" ? "Delivery receipt" : kind.toUpperCase(), ref = batch?.ref || po?.ref || request.ref;
  const fileName = kind === "delivery" ? batch?.receiptVersions?.at(-1)?.fileName || (project.documentCode ? archiveFileName(prefixedReference(project.documentCode, ref), "receipt", "v1", ".pdf") : ref + ".pdf") : kind === "po" ? (po?.archiveRef || ref) + ".pdf" : (request.archiveRef || ref) + ".pdf";
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => pending.current?.abort(), []);
  const open = async () => {
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError("");
    if (!dialog.current?.open) dialog.current?.showModal();
    try {
      const response = await fetch("/api/documents/preview", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, request, po, quote, project, batch, parentBatch }) });
      if (!response.ok) throw new Error((await response.json()).error || "The document could not be generated.");
      const file = await response.blob();
      if (controller.signal.aborted) return;
      setBlob(file); setUrl(URL.createObjectURL(file));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The document could not be generated."); }
    finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  };
  return <div className="print-hide"><button ref={invoker} type="button" className="button secondary" disabled={busy} onClick={() => void open()}>{busy ? "Preparing PDF…" : "Print preview ↗"}</button>
    <dialog ref={dialog} aria-label={`${title} print preview`} className="document-preview-dialog" onClose={() => { pending.current?.abort(); pending.current = null; setBusy(false); setUrl(""); setBlob(null); setError(""); requestAnimationFrame(() => invoker.current?.focus({ preventScroll: true })); }}>
      <div className="panel-heading"><h2>{ref} — document preview</h2><CloseButton onClick={() => dialog.current?.close()}/></div>
      {busy && <DocumentLoading/>}
      {error && <div><p className="field-error" role="alert">{error}</p><button className="button secondary" onClick={() => void open()}>Retry preview</button></div>}
      {url && blob && <PdfDocumentViewer blob={blob} fileName={fileName} sourceUrl={url}/>}
    </dialog>
  </div>;
}
