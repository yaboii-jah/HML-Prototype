"use client";

import { useEffect, useRef, useState } from "react";
import { CloseButton } from "@/src/components/ui/CloseButton";
import type { Quote } from "@/src/domain/types";
import { QuoteSourcePreview } from "./QuoteSourcePreview";

export function QuoteDocumentsDialog({ quote, onClose, initialIndex = 0, onAttach, onRemoveDocument, disabled = false, error = "" }: { quote: Quote; onClose: () => void; initialIndex?: number; onAttach?: (files: File[]) => Promise<void>; onRemoveDocument?: (fileId: string) => Promise<void>; disabled?: boolean; error?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const invoker = useRef<HTMLElement | null>(null);
  const currentIndex = Math.min(selectedIndex, Math.max(0, quote.documents.length - 1));
  const selected = quote.documents[currentIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialogRef} className="quote-documents-dialog" aria-labelledby="quote-documents-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="quote-documents-heading"><div><span className="eyebrow">QUOTATION SOURCE</span><h2 id="quote-documents-title">View documents</h2></div><CloseButton aria-label="Close document preview" onClick={onClose}/></div>
    {onAttach && <div className="quote-document-management"><label className="button secondary file-button">+ Add supplier files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={disabled} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void onAttach(files); }}/></label>{onRemoveDocument && selected?.fileId && <button type="button" className="button danger-outline" disabled={disabled} onClick={() => void onRemoveDocument(selected.fileId!)}>Remove selected attachment</button>}<small>Up to 12 PDF or image files · 20 MB each · 45 MB total</small></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="quote-documents-layout">
      <nav className="quote-documents-list" aria-label="Quotation documents">{!quote.documents.length && <p className="helper-note">No supplier files attached.</p>}{quote.documents.map((item, index) => <button type="button" key={`${item.fileId || item.name}-${index}`} className={currentIndex === index ? "active" : ""} aria-current={currentIndex === index ? "true" : undefined} onClick={() => setSelectedIndex(index)}><span>{index + 1}</span><strong>{item.name}</strong></button>)}</nav>
      <div className="quote-document-preview"><QuoteSourcePreview document={selected}/></div>
    </div>
  </dialog>;
}
