"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";

type Entry = { id: string; name: string; ref: string; version: number; status: string };
export function QuotationReviewNavigation({ entries, current, mode, disabled, onSelect, onMode }: { entries: Entry[]; current: string; mode: "focused" | "all"; disabled: boolean; onSelect: (id: string) => void; onMode: (mode: "focused" | "all") => void }) {
  const [picker, setPicker] = useState(false), [query, setQuery] = useState("");
  const track = useRef<HTMLDivElement>(null), pickerButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const area = track.current, button = area?.querySelector<HTMLElement>(`[data-quote-id="${CSS.escape(current)}"]`);
    if (!area || !button) return;
    const box = area.getBoundingClientRect(), rect = button.getBoundingClientRect();
    if (rect.left < box.left) area.scrollBy({ left: rect.left - box.left });
    else if (rect.right > box.right) area.scrollBy({ left: rect.right - box.right });
  }, [current, entries.length]);
  const matches = entries.filter(entry => `${entry.name} ${entry.ref} ${entry.status} v${entry.version}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <section className="quotation-review-navigation" aria-label="Quotation review queue"><div className="quotation-navigation-heading"><div><h2>Quotation review</h2><small>{entries.length} quotations</small></div><div className="quotation-navigation-actions"><button ref={pickerButton} type="button" className="button secondary" disabled={disabled} onClick={() => { setQuery(""); setPicker(true); }}>All quotations ({entries.length})</button><div className="quotation-view-modes" aria-label="Quotation display"><button type="button" aria-pressed={mode === "focused"} disabled={disabled} onClick={() => onMode("focused")}>Focused</button><button type="button" aria-pressed={mode === "all"} disabled={disabled} onClick={() => onMode("all")}>All quotations</button></div></div></div>
      <div className="quotation-tab-strip"><button type="button" className="quotation-tab-scroll" aria-label="Previous supplier tabs" disabled={disabled} onClick={() => track.current?.scrollBy({ left: -300, behavior: "smooth" })}>‹</button><div ref={track} className="quotation-supplier-tabs" role="tablist" aria-label="Supplier quotations">{entries.map((entry, index) => <button key={entry.id} type="button" role="tab" data-quote-id={entry.id} aria-selected={entry.id === current} aria-controls={entry.id === current ? `quote-panel-${entry.id}` : undefined} tabIndex={entry.id === current ? 0 : -1} disabled={disabled} title={`${entry.name} · ${entry.ref || "Reference needed"} · v${entry.version}`} onClick={() => onSelect(entry.id)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + entries.length) % entries.length;
        onSelect(entries[next].id); track.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus({ preventScroll: true });
      }}><span><strong>{entry.name}</strong><Badge>{entry.status}</Badge></span><small>{entry.ref || "Reference needed"} · v{entry.version}</small></button>)}</div><button type="button" className="quotation-tab-scroll" aria-label="Next supplier tabs" disabled={disabled} onClick={() => track.current?.scrollBy({ left: 300, behavior: "smooth" })}>›</button></div>
    </section>
    <RecordModal open={picker} title="All quotations" onClose={() => setPicker(false)} returnFocus={() => pickerButton.current}><div className="quotation-picker"><input type="search" aria-label="Search quotations" placeholder="Search supplier, reference or status" value={query} onChange={event => setQuery(event.target.value)}/><div className="quotation-picker-list">{matches.map(entry => <button key={entry.id} type="button" aria-pressed={entry.id === current} onClick={() => { onSelect(entry.id); setPicker(false); }}><span><strong>{entry.name}</strong><small>{entry.ref || "Reference needed"} · v{entry.version}</small></span><Badge>{entry.status}</Badge></button>)}{!matches.length && <p className="muted">No quotations match your search.</p>}</div></div></RecordModal>
  </>;
}
