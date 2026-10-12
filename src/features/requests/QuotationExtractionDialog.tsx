"use client";

import { useEffect, useId, useRef } from "react";

export type QuotationExtractionProgress = { current: number; total: number; label: string; completed: number; failed: number };

export function QuotationExtractionDialog({ active, label, progress }: { active: boolean; label: string | null; progress: QuotationExtractionProgress | null }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null), invoker = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.setAttribute("closedby", "none");
    if (active && !dialog.open) {
      invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal(); dialog.focus();
    } else if (!active && dialog.open) {
      dialog.close();
      requestAnimationFrame(() => {
        const target = invoker.current;
        if (target?.isConnected && target.checkVisibility() && !target.matches(":disabled")) target.focus({ preventScroll: true });
        else document.querySelector<HTMLButtonElement>(".procurement-steps button.active")?.focus({ preventScroll: true });
      });
    }
  }, [active]);
  return <dialog ref={ref} className="record-dialog quotation-extraction-dialog" tabIndex={-1} aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} onCancel={event => event.preventDefault()} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } }}>
    <h2 id={`${id}-title`}>Extracting quotations with AI</h2>
    <div className="qa-extraction-progress" role="status" aria-live="polite" aria-atomic="true"><span className="qa-spinner" aria-hidden="true"/><div>
      <strong>{progress ? `Supplier group ${progress.current} of ${progress.total}` : "Reading supplier quotation"}</strong>
      <small>{progress?.label || label}</small>
      {progress && <small>{progress.completed} completed · {progress.failed} failed</small>}
    </div></div>
    {progress && <progress aria-label="Supplier groups processed" value={progress.completed + progress.failed} max={progress.total}/>}
    <p id={`${id}-note`} className="helper-note">AI is reading the files and preparing drafts for review. Keep this page open; this dialog closes when extraction finishes.</p>
  </dialog>;
}
