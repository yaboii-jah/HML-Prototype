"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import type { DocumentRef, MRF } from "@/src/domain/types";
import { supportingPdf } from "@/src/domain/request-archive";
import { readQuoteFile } from "./quote-files";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

type GalleryDocument = DocumentRef & { driveUrl?: string; drivePreviewUrl?: string };
type Source = { url: string; blob?: Blob; kind: "pdf" | "image" | "other"; loading: boolean; error: string };

function Chevron({ previous = false }: { previous?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={previous ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}/></svg>;
}

function PdfPage({ blob, pageNumber = 1, onPageCount }: { blob: Blob; pageNumber?: number; onPageCount?: (count: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let disposed = false;
    let loading: PDFDocumentLoadingTask | undefined, rendering: RenderTask | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (disposed) return;
        loading = pdfjs.getDocument({ data });
        const pdf = await loading.promise;
        if (disposed) return;
        onPageCount?.(pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        if (disposed || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1400 / Math.max(viewport.width, viewport.height));
        const sized = page.getViewport({ scale });
        const target = canvas.current;
        target.width = Math.ceil(sized.width); target.height = Math.ceil(sized.height);
        rendering = page.render({ canvas: target, viewport: sized });
        await rendering.promise;
        if (!disposed) setStatus("ready");
      } catch { if (!disposed) setStatus("error"); }
    })();
    return () => { disposed = true; rendering?.cancel(); void loading?.destroy(); };
  }, [blob, pageNumber, onPageCount]);
  return <>{status === "loading" && <span className="document-gallery-placeholder" role="status">Preparing preview…</span>}{status === "error" && <span className="document-gallery-placeholder">Page preview unavailable. Open the document to view it.</span>}<canvas ref={canvas} className="document-gallery-page" hidden={status !== "ready"} aria-label={`Page ${pageNumber} of the attached PDF`}/></>;
}

function DocumentCard({ document, swiping }: { document: GalleryDocument; swiping: React.RefObject<boolean> }) {
  const [source, setSource] = useState<Source>({ url: "", kind: "other", loading: true, error: "" });
  const [openError, setOpenError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let disposed = false, objectUrl = "";
    void (async () => {
      try {
        const blob = document.fileId ? await readQuoteFile(document.fileId) : undefined;
        if (disposed) return;
        if (!blob) { setSource({ url: "", kind: "other", loading: false, error: document.driveUrl ? "Open the document to view the archived copy." : "This file is unavailable on this device." }); return; }
        const kind = blob.type === "application/pdf" || /\.pdf$/i.test(document.name) ? "pdf" : /^image\/(png|jpeg|gif|webp|bmp)$/.test(blob.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(document.name) ? "image" : "other";
        objectUrl = URL.createObjectURL(kind === "pdf" && blob.type !== "application/pdf" ? new Blob([blob], { type: "application/pdf" }) : blob);
        setSource({ url: objectUrl, blob, kind, loading: false, error: "" });
      } catch { if (!disposed) setSource({ url: "", kind: "other", loading: false, error: "The file could not be loaded. Try opening the document." }); }
    })();
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.fileId, document.name, document.driveUrl]);
  const canOpen = !!(source.url || document.driveUrl);
  const open = (keyboard = false) => {
    if ((!keyboard && swiping.current) || !canOpen) return;
    setOpenError("");
    if (window.matchMedia("(max-width: 800px)").matches) {
      // Open synchronously from the tap so mobile browsers do not block the tab.
      window.open(document.driveUrl || source.url, "_blank", "noopener,noreferrer");
    } else { setPreviewOpen(true); dialog.current?.showModal(); }
  };
  return <>
    <button ref={trigger} type="button" className="document-gallery-card" aria-label={`Open ${document.name}`} disabled={!canOpen} aria-busy={source.loading} onClick={event => open(event.detail === 0)}>
      {source.loading ? <span className="document-gallery-placeholder" role="status">Loading document…</span> : source.kind === "pdf" && source.blob ? <PdfPage blob={source.blob}/> : source.kind === "image" && !openError ? <span className="document-gallery-image"><Image src={source.url} alt={`Preview of ${document.name}`} fill unoptimized onError={() => setOpenError("Image preview unavailable. Open the document to view it.")}/></span> : <span className="document-gallery-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 2H6v20h12V6zM14 2v5h4M8 12h8M8 16h8"/></svg>{openError || source.error || "Preview not available for this file type."}</span>}
      {canOpen && <span className="document-gallery-open">Open document ↗</span>}
    </button>
    {openError && <p className="field-error" role="alert">{openError}</p>}
    <dialog ref={dialog} className="document-gallery-modal" aria-label={`Preview of ${document.name}`} onClose={() => { setPreviewOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <header><h2>{document.name}</h2><div className="button-row"><a className="button secondary" href={document.driveUrl || source.url} target="_blank" rel="noreferrer">Open document ↗</a><button type="button" className="button secondary" onClick={() => dialog.current?.close()}>Close</button></div></header>
      {previewOpen && (source.kind === "image" && source.url ? <div className="document-gallery-image-viewer"><Image src={source.url} alt={document.name} fill unoptimized/></div> : source.kind === "pdf" && source.blob ? <PdfDocumentViewer blob={source.blob} fileName={document.name} sourceUrl={source.url}/> : document.drivePreviewUrl ? <iframe src={document.drivePreviewUrl} title={document.name} allow="fullscreen"/> : <p className="document-gallery-placeholder">This file type opens in a separate tab. Use Open document to view it.</p>)}
    </dialog>
  </>;
}

export function RequestDocumentGallery({ request }: { request: MRF }) {
  const attachments = [...(request.scopeDocument ? [request.scopeDocument] : []), ...request.documents];
  const support = supportingPdf(request);
  const archive = request.status === "approved" && request.archive?.status === "complete" && !request.correction ? request.archive.versions.at(-1) : undefined;
  const documents: GalleryDocument[] = attachments.map(document => document === support && archive ? { ...document, driveUrl: archive.supportUrl, drivePreviewUrl: `https://drive.google.com/file/d/${encodeURIComponent(archive.supportFileId)}/preview` } : document);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null), swiping = useRef(false), pointerStart = useRef<{ x: number; y: number } | null>(null);
  const active = Math.min(index, Math.max(0, documents.length - 1));
  const selected = useRef(0);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(() => node.scrollTo({ left: Math.min(selected.current, documents.length - 1) * node.clientWidth, behavior: "instant" }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [documents.length]);
  const move = (next: number) => {
    const node = track.current;
    if (!node) return;
    node.scrollTo({ left: Math.max(0, Math.min(documents.length - 1, next)) * node.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  if (!documents.length) return <p className="muted">No attachments recorded.</p>;
  return <div className="document-gallery">
    <div ref={track} className="document-gallery-track" role="region" aria-label="Request attachments" tabIndex={0} onScroll={event => { const next = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth); selected.current = next; setIndex(next); }} onKeyDown={event => {
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(active + (event.key === "ArrowLeft" ? -1 : 1)); }
    }} onPointerDown={event => { pointerStart.current = { x: event.clientX, y: event.clientY }; swiping.current = false; }} onPointerMove={event => {
      if (pointerStart.current && Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y) > 12) swiping.current = true;
    }} onPointerUp={() => { pointerStart.current = null; }} onPointerCancel={() => { pointerStart.current = null; swiping.current = true; }}>
      {documents.map((document, position) => <div key={`${document.fileId || document.name}-${position}`} className="document-gallery-slide" inert={position !== active} aria-hidden={position !== active}>{Math.abs(position - active) <= 1 && <DocumentCard key={`${document.fileId || document.name}-${document.driveUrl || "local"}`} document={document} swiping={swiping}/>}</div>)}
    </div>
    <footer className="document-gallery-footer"><div className="document-gallery-caption"><strong title={documents[active].name}>{documents[active].name}</strong><span aria-live="polite">{active + 1} of {documents.length}</span></div>{documents.length > 1 && <div className="document-gallery-navigation"><button type="button" className="icon-button" aria-label="Previous document" disabled={active === 0} onClick={() => move(active - 1)}><Chevron previous/></button><button type="button" className="icon-button" aria-label="Next document" disabled={active === documents.length - 1} onClick={() => move(active + 1)}><Chevron/></button></div>}</footer>
  </div>;
}
