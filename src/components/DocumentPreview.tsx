"use client";

import { useEffect, useRef, useState } from "react";
import type { MRF, PO, Quote, Site } from "@/src/domain/types";

export function DocumentPreview({ kind, request, po, quote, project }: { kind: "mrf" | "po"; request: MRF; po?: PO; quote?: Quote; project: Site }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), viewer = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const open = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, request, po, quote, project }) });
      if (!response.ok) throw new Error((await response.json()).error || "The document could not be generated.");
      setUrl(URL.createObjectURL(await response.blob()));
      dialog.current?.showModal();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The document could not be generated."); }
    finally { setBusy(false); }
  };
  return <div className="print-hide"><button type="button" className="text-link" disabled={busy} onClick={() => void open()}>{busy ? "Preparing PDF…" : "Print preview ↗"}</button>
    {error && <p className="field-error" role="alert">{error}</p>}
    <dialog ref={dialog} aria-label={`${kind.toUpperCase()} print preview`} className="document-preview-dialog" onClose={() => setUrl("")}>
      <div className="panel-heading"><h2>{po?.ref || request.ref} — document preview</h2><div className="button-row"><a className="button secondary" href={url} download={`${po?.ref || request.ref}.pdf`}>Download PDF</a><button className="button secondary" type="button" onClick={() => viewer.current?.contentWindow?.print()}>Print</button><button className="button secondary" type="button" onClick={() => dialog.current?.close()}>Close</button></div></div>
      {url && <iframe ref={viewer} src={url} title={`${kind.toUpperCase()} document`}/>} 
    </dialog>
  </div>;
}
