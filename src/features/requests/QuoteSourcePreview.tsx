"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { DocumentLoading } from "@/src/components/ui/Skeleton";
import { LoadingImage } from "@/src/components/ui/LoadingImage";
import type { Quote } from "@/src/domain/types";
import { readQuoteFile } from "./quote-files";

type SourceDocument = Quote["documents"][number];
const sourceQuery = "(min-width:1280px)";
const subscribeWidth = (changed: () => void) => {
  const media = window.matchMedia(sourceQuery);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};
const wideSnapshot = () => window.matchMedia(sourceQuery).matches;
const serverSnapshot = () => false;
export const useWideQuotationSource = () => useSyncExternalStore(subscribeWidth, wideSnapshot, serverSnapshot);

export function QuoteSourcePreview({ document, compact = false }: { document?: SourceDocument; compact?: boolean }) {
  return <SourceFile key={`${document?.fileId || "missing"}-${document?.type}`} document={document} compact={compact}/>;
}

function SourceFile({ document, compact }: { document?: SourceDocument; compact: boolean }) {
  const [preview, setPreview] = useState<{ url: string; type: string; blob: Blob } | null>(null);
  const [error, setError] = useState("");
  const [imageZoom, setImageZoom] = useState("fit");
  useEffect(() => {
    let active = true, url = "";
    if (!document?.fileId) return;
    readQuoteFile(document.fileId).then(blob => {
      if (!active) return;
      if (!blob) { setError("The original file is unavailable. Attach it again to preview it."); return; }
      url = URL.createObjectURL(blob);
      setPreview({ url, type: document.type || blob.type, blob });
    }).catch(() => { if (active) setError("The original file could not be opened. Please try again."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [document?.fileId, document?.type]);

  if (!document) return <p className="quote-source-empty">Attach the supplier quotation to check its materials here.</p>;
  if (!document.fileId) return <p className="quote-source-empty">This older document reference has no available source file. You can still review its recorded materials.</p>;
  if (error) return <p className="quote-source-empty" role="alert">{error} You can still review the worksheet.</p>;
  if (!preview) return <DocumentLoading/>;
  const isPdf = preview.type === "application/pdf" || document.name.toLowerCase().endsWith(".pdf");
  const isImage = preview.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(document.name);
  return <div className="quote-source-file">
    <a className="text-link quote-source-original" href={preview.url} target="_blank" rel="noopener noreferrer">Open document ↗</a>
    {isPdf ? <PdfDocumentViewer blob={preview.blob} fileName={document.name} sourceUrl={preview.url} compact={compact}/> : isImage ? <>
      <label className="quote-source-image-tools">Zoom <select aria-label="Image zoom" value={imageZoom} onChange={event => setImageZoom(event.target.value)}><option value="fit">Fit width</option>{[50, 100, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
      <div className="quote-source-image-scroll"><div className="quote-source-image" style={{ width: imageZoom === "fit" ? "100%" : `${imageZoom}%` }}><LoadingImage src={preview.url} alt={`Preview of ${document.name}`}/></div></div>
    </> : <p className="quote-source-empty">Preview is unavailable for this file type. Use Open document to view it.</p>}
  </div>;
}

export function QuoteSourcePanel({ quote, onHide, onExpand }: { quote: Quote; onHide: () => void; onExpand: (index: number) => void }) {
  const [selectedFile, setSelectedFile] = useState("");
  const selectedIndex = Math.max(0, quote.documents.findIndex(document => (document.fileId || document.name) === selectedFile));
  return <aside className="quote-source-panel" aria-label="Supplier quotation source">
    <header><strong>Supplier source</strong><button type="button" className="text-link" onClick={onHide}>Hide source</button></header>
    <div className="quote-source-picker"><select aria-label="Source document" disabled={!quote.documents.length} value={selectedIndex} onChange={event => { const document = quote.documents[Number(event.target.value)]; setSelectedFile(document.fileId || document.name); }}>{quote.documents.length ? quote.documents.map((document, index) => <option key={`${document.fileId || document.name}-${index}`} value={index}>{index + 1}. {document.name}</option>) : <option value={0}>No source attached</option>}</select><button type="button" className="button secondary" disabled={!quote.documents.length} onClick={() => onExpand(selectedIndex)}>Expand source</button></div>
    <div className="quote-source-preview"><QuoteSourcePreview document={quote.documents[selectedIndex]} compact/></div>
  </aside>;
}
