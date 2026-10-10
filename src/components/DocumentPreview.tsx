"use client";

import { useEffect, useRef, useState } from "react";
import type { Batch, MRF, PO, Quote, Site } from "@/src/domain/types";
import { PdfDocumentViewer } from "./PdfDocumentViewer";
import { CloseButton } from "./ui/CloseButton";

export function DocumentPreview({ kind, request, po, quote, project, batch, parentBatch }: { kind: "mrf" | "po" | "delivery"; request: MRF; po?: PO; quote?: Quote; project: Site; batch?: Batch; parentBatch?: Batch }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), invoker = useRef<HTMLButtonElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const title = kind === "delivery" ? "Delivery receipt" : kind.toUpperCase(), ref = batch?.ref || po?.ref || request.ref;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const open = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, request, po, quote, project, batch, parentBatch }) });
      if (!response.ok) throw new Error((await response.json()).error || "The document could not be generated.");
      const file = await response.blob(); setBlob(file); setUrl(URL.createObjectURL(file));
      dialog.current?.showModal();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The document could not be generated."); }
    finally { setBusy(false); }
  };
  return <div className="print-hide"><button ref={invoker} type="button" className="button secondary" disabled={busy} onClick={() => void open()}>{busy ? "Preparing PDF…" : "Print preview ↗"}</button>
    {error && <p className="field-error" role="alert">{error}</p>}
    <dialog ref={dialog} aria-label={`${title} print preview`} className="document-preview-dialog" onClose={() => { setUrl(""); setBlob(null); invoker.current?.focus({ preventScroll: true }); }}>
      <div className="panel-heading"><h2>{ref} — document preview</h2><CloseButton onClick={() => dialog.current?.close()}/></div>
      {url && blob && <PdfDocumentViewer blob={blob} fileName={`${ref}.pdf`} sourceUrl={url}/>}
    </dialog>
  </div>;
}
