"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local Blob previews are not served or optimized by Next.js. */

import { useEffect, useRef, useState } from "react";
import type { Quote } from "@/src/domain/types";
import { readQuoteFile } from "./quote-files";

export function QuoteDocumentsDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  const document = quote.documents[selectedIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    let active = true;
    let url = "";
    if (!document?.fileId) return;
    readQuoteFile(document.fileId).then(blob => {
      if (!active) return;
      if (!blob) { setError("The original file is unavailable. Attach it again."); setPreview(null); return; }
      url = URL.createObjectURL(blob);
      setPreview({ url, type: document.type || blob.type });
      setError("");
    }).catch(() => { if (active) { setError("The original file could not be opened. Please try again."); setPreview(null); } });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [document?.fileId, document?.type]);

  const select = (index: number) => { setPreview(null); setError(""); setSelectedIndex(index); };
  const isPdf = preview?.type === "application/pdf" || document?.name.toLowerCase().endsWith(".pdf");
  const isImage = preview?.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(document?.name || "");

  return <dialog ref={dialogRef} className="quote-documents-dialog" aria-labelledby="quote-documents-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="quote-documents-heading"><div><span className="eyebrow">QUOTATION SOURCE</span><h2 id="quote-documents-title">View documents</h2></div><button type="button" className="icon-button" aria-label="Close document preview" onClick={onClose}>×</button></div>
    <div className="quote-documents-layout">
      <nav className="quote-documents-list" aria-label="Quotation documents">{quote.documents.map((item, index) => <button type="button" key={`${item.fileId || item.name}-${index}`} className={selectedIndex === index ? "active" : ""} aria-current={selectedIndex === index ? "true" : undefined} onClick={() => select(index)}><span>{index + 1}</span><strong>{item.name}</strong></button>)}</nav>
      <div className="quote-document-preview" aria-live="polite">{error ? <p role="alert">{error}</p> : !document?.fileId ? <p>This older document reference has no available source file.</p> : !preview ? <p>Loading preview…</p> : isPdf ? <iframe title={document.name} src={preview.url}/> : isImage ? <img src={preview.url} alt={`Preview of ${document.name}`}/> : <p>Preview is unavailable for this file type.</p>}</div>
    </div>
  </dialog>;
}
