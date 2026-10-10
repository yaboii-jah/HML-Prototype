"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { PDFViewer, EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

const scales = [50, 75, 100, 125, 150, 200, 300];
type ToolIcon = "sidebar" | "search" | "previous" | "next" | "minus" | "plus" | "print" | "download" | "fullscreen" | "rotate";
function Icon({ name }: { name: ToolIcon }) {
  const paths: Record<ToolIcon, string> = {
    sidebar: "M3 4h18v16H3zM9 4v16M5.5 8h1M5.5 12h1M5.5 16h1",
    search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    previous: "m6 14 6-6 6 6", next: "m6 10 6 6 6-6", minus: "M5 12h14", plus: "M5 12h14M12 5v14",
    print: "M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1",
    download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
    fullscreen: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6",
    rotate: "M20 10a8 8 0 1 0-2 8M20 3v7h-7",
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

function PdfTool({ icon, label, onClick, disabled = false, pressed }: { icon: ToolIcon; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <button type="button" className="pdf-tool-button" aria-label={label} title={label} disabled={disabled} aria-pressed={pressed} onClick={onClick}><Icon name={icon}/></button>;
}

function Thumbnail({ pdf, number, active, root, onSelect }: { pdf: PDFDocumentProxy; number: number; active: boolean; root: RefObject<HTMLElement | null>; onSelect: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), button = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let disposed = false, rendering: RenderTask | undefined;
    const draw = async () => {
      try {
        const page = await pdf.getPage(number);
        if (disposed || !canvas.current) return;
        const original = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 132 / original.width });
        canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height);
        rendering = page.render({ canvas: canvas.current, viewport });
        await rendering.promise;
        if (!disposed) setStatus("ready");
      } catch { if (!disposed) setStatus("error"); }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void draw(); }
    }, { root: root.current, rootMargin: "150px" });
    if (button.current) observer.observe(button.current);
    return () => { disposed = true; observer.disconnect(); rendering?.cancel(); };
  }, [pdf, number, root]);
  useEffect(() => {
    if (!active || !button.current || !root.current) return;
    const item = button.current.getBoundingClientRect(), box = root.current.getBoundingClientRect();
    if (item.top < box.top) root.current.scrollBy({ top: item.top - box.top });
    else if (item.bottom > box.bottom) root.current.scrollBy({ top: item.bottom - box.bottom });
  }, [active, root]);
  return <button ref={button} type="button" className="pdf-document-thumbnail" aria-label={`Go to page ${number}`} aria-current={active ? "page" : undefined} onClick={onSelect}><span className="pdf-document-thumbnail-paper"><canvas ref={canvas} hidden={status !== "ready"}/>{status !== "ready" && <span>{status === "error" ? "Preview unavailable" : `Page ${number}`}</span>}</span><span>{number}</span></button>;
}

export function PdfDocumentViewer({ blob, fileName, sourceUrl }: { blob: Blob; fileName: string; sourceUrl: string }) {
  const shell = useRef<HTMLDivElement>(null), sidebar = useRef<HTMLElement>(null), findInput = useRef<HTMLInputElement>(null), printer = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null), viewer = useRef<PDFViewer | null>(null), events = useRef<EventBus | null>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(0), [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState("page-width"), [ready, setReady] = useState(false), [error, setError] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [sidebarOpen, setSidebarOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [query, setQuery] = useState(""), [matches, setMatches] = useState({ current: 0, total: 0 }), [searching, setSearching] = useState(false), [printUrl, setPrintUrl] = useState("");
  const printTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let disposed = false, task: PDFDocumentLoadingTask | undefined, instance: PDFViewer | undefined, resize: ResizeObserver | undefined;
    const onFullscreen = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const { PDFViewer, EventBus, PDFLinkService, PDFFindController, FindState } = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (disposed || !container.current || !pages.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const bus = new EventBus(), links = new PDFLinkService({ eventBus: bus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
        const findController = new PDFFindController({ eventBus: bus, linkService: links });
        instance = new PDFViewer({ container: container.current, viewer: pages.current, eventBus: bus, linkService: links, findController });
        viewer.current = instance; events.current = bus; links.setViewer(instance);
        bus.on("pagesinit", () => {
          if (disposed || !instance) return;
          instance.currentScaleValue = "page-width"; setCount(instance.pagesCount); setReady(true);
        });
        bus.on("pagechanging", (event: { pageNumber: number }) => { if (!disposed) { setPage(event.pageNumber); setPageInput(String(event.pageNumber)); } });
        bus.on("scalechanging", (event: { scale: number; presetValue?: string }) => { if (!disposed) setScale(event.presetValue || String(Math.round(event.scale * 100))); });
        bus.on("pagerendered", (event: { error?: unknown }) => { if (!disposed && event.error) setError("This page could not be displayed. Use Open document to view the original file."); });
        bus.on("updatefindmatchescount", (event: { matchesCount: { current: number; total: number } }) => { if (!disposed) setMatches(event.matchesCount); });
        bus.on("updatefindcontrolstate", (event: { state: number; matchesCount: { current: number; total: number } }) => { if (!disposed) { setSearching(event.state === FindState.PENDING); setMatches(event.matchesCount); } });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (disposed) return;
        task = pdfjs.getDocument({ data: bytes });
        const document = await task.promise;
        if (disposed) return;
        setPdf(document); links.setDocument(document); instance.setDocument(document);
        resize = new ResizeObserver(() => {
          if (instance?.pagesCount && ["auto", "page-width", "page-fit"].includes(instance.currentScaleValue)) instance.currentScaleValue = instance.currentScaleValue;
        });
        resize.observe(container.current);
      } catch { if (!disposed) setError("The PDF could not be displayed. Use Open document to view the original file."); }
    })();
    return () => {
      disposed = true; resize?.disconnect(); instance?.setDocument(null); viewer.current = null; events.current = null; void task?.destroy();
      document.removeEventListener("fullscreenchange", onFullscreen); if (printTimer.current) clearTimeout(printTimer.current);
    };
  }, [blob]);
  const go = (number: number) => { if (viewer.current && ready) viewer.current.currentPageNumber = Math.max(1, Math.min(count, number)); };
  const commitPage = () => { const number = Number(pageInput); if (Number.isInteger(number) && number >= 1 && number <= count) { go(number); setPageInput(String(number)); } else setPageInput(String(page)); };
  const zoom = (factor: number) => { if (viewer.current && ready) viewer.current.currentScale = Math.max(.25, Math.min(4, viewer.current.currentScale * factor)); };
  const search = (text: string, previous = false, again = false) => {
    events.current?.dispatch("find", { source: viewer.current, type: again ? "again" : "", query: text, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  };
  const toggleSearch = () => {
    if (searchOpen) { setSearchOpen(false); events.current?.dispatch("findbarclose", { source: viewer.current }); }
    else { setSearchOpen(true); requestAnimationFrame(() => findInput.current?.focus()); }
  };
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement === shell.current) await document.exitFullscreen(); else await shell.current?.requestFullscreen(); }
    catch { setError("Fullscreen is unavailable in this browser."); }
  };
  return <div ref={shell} className="pdf-document-viewer" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => findInput.current?.focus()); }
    if (event.key === "Escape" && searchOpen) { event.preventDefault(); event.stopPropagation(); toggleSearch(); }
  }}>
    <div className="pdf-document-toolbar" role="toolbar" aria-label="PDF viewer controls">
      <div className="pdf-document-toolbar-group">
        <PdfTool icon="sidebar" label="Toggle thumbnails" disabled={!ready} pressed={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}/>
        <PdfTool icon="search" label="Find in document" disabled={!ready} pressed={searchOpen} onClick={toggleSearch}/>
        <span className="pdf-toolbar-divider"/>
        <PdfTool icon="previous" label="Previous page" disabled={!ready || page === 1} onClick={() => go(page - 1)}/>
        <PdfTool icon="next" label="Next page" disabled={!ready || page === count} onClick={() => go(page + 1)}/>
        <label>Page <input aria-label="PDF page number" type="number" min="1" max={count || 1} value={pageInput} disabled={!ready} onChange={event => setPageInput(event.target.value)} onBlur={commitPage} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitPage(); } }}/></label><span aria-live="polite">of {count || "—"}</span>
      </div>
      <div className="pdf-document-toolbar-group pdf-document-zoom-tools">
        <PdfTool icon="minus" label="Zoom out" disabled={!ready || Number(scale) <= 25} onClick={() => zoom(1 / 1.2)}/>
        <PdfTool icon="plus" label="Zoom in" disabled={!ready || Number(scale) >= 400} onClick={() => zoom(1.2)}/>
        <select aria-label="PDF zoom" value={scale} disabled={!ready} onChange={event => { if (viewer.current) viewer.current.currentScaleValue = ["auto", "page-width", "page-fit"].includes(event.target.value) ? event.target.value : String(Number(event.target.value) / 100); }}><option value="auto">Automatic zoom</option><option value="page-width">Fit width</option><option value="page-fit">Fit page</option>{scales.map(value => <option key={value} value={value}>{value}%</option>)}{!["auto", "page-width", "page-fit"].includes(scale) && !scales.includes(Number(scale)) && <option value={scale}>{scale}%</option>}</select>
      </div>
      <div className="pdf-document-toolbar-group pdf-document-file-tools">
        <PdfTool icon="rotate" label="Rotate clockwise" disabled={!ready} onClick={() => { if (viewer.current) viewer.current.pagesRotation = (viewer.current.pagesRotation + 90) % 360; }}/>
        <PdfTool icon="fullscreen" label={fullscreen ? "Exit fullscreen" : "Fullscreen"} disabled={!ready} pressed={fullscreen} onClick={() => void toggleFullscreen()}/>
        <PdfTool icon="print" label="Print PDF" disabled={!ready} onClick={() => { setError(""); if (printUrl) { try { printer.current?.contentWindow?.print(); } catch { setError("Printing is unavailable here. Use Open document to print the original file."); } } else setPrintUrl(sourceUrl); }}/>
        <a className="pdf-tool-button" aria-label="Download PDF" title="Download PDF" href={sourceUrl} download={fileName}><Icon name="download"/></a>
      </div>
    </div>
    {searchOpen && <div className="pdf-document-findbar"><input ref={findInput} type="search" aria-label="Search PDF text" placeholder="Find in document…" value={query} onChange={event => { setQuery(event.target.value); setMatches({ current: 0, total: 0 }); setSearching(!!event.target.value); search(event.target.value); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); search(query, event.shiftKey, true); } }}/><PdfTool icon="previous" label="Previous match" disabled={!query} onClick={() => search(query, true, true)}/><PdfTool icon="next" label="Next match" disabled={!query} onClick={() => search(query, false, true)}/><span role="status">{query ? searching ? "Searching…" : matches.total ? `${matches.current} of ${matches.total} matches` : "No matches" : ""}</span></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="pdf-document-body">{sidebarOpen && <aside ref={sidebar} className="pdf-document-sidebar" aria-label="Page thumbnails"><div className="pdf-document-sidebar-heading">Thumbnails</div>{pdf && ready && Array.from({ length: count }, (_, index) => <Thumbnail key={index + 1} pdf={pdf} number={index + 1} active={page === index + 1} root={sidebar} onSelect={() => go(index + 1)}/>)}</aside>}<div className="pdf-document-stage">{!ready && !error && <p className="pdf-document-loading" role="status">Loading PDF…</p>}<div ref={container} className="pdf-document-scroll" tabIndex={0} role="region" aria-label="PDF document pages"><div ref={pages} className="pdfViewer"/></div></div></div>
    {printUrl && <iframe ref={printer} className="pdf-document-print-frame" tabIndex={-1} aria-hidden="true" src={printUrl} title="PDF print document" onLoad={() => { printTimer.current = setTimeout(() => { try { printer.current?.contentWindow?.focus(); printer.current?.contentWindow?.print(); } catch { setError("Printing is unavailable here. Use Open document to print the original file."); } }, 500); }}/>}
  </div>;
}
