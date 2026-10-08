"use client";
import { useId, useRef, type ReactNode } from "react";
import type { StickyHeadingMode } from "./StickyHeadings";
export function CollapsibleSection({ title, children, defaultOpen = true, open, onOpenChange, summary, className = "", stickyHeading = "auto" }: { title: string; children: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; summary?: ReactNode; className?: string; stickyHeading?: StickyHeadingMode }) {
  const id = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} className={`collapsible-section ${className}`} data-sticky-heading={stickyHeading === false ? "off" : stickyHeading} data-sticky-title={title} open={open ?? defaultOpen} onToggle={event => onOpenChange?.(event.currentTarget.open)} onInvalidCapture={() => { if (ref.current) ref.current.open = true; onOpenChange?.(true); }}>
    <summary aria-controls={id}><span><strong>{title}</strong>{summary && <small>{summary}</small>}</span><span className="section-chevron" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m6 9 6 6 6-6"/></svg></span></summary>
    <div id={id} className="collapsible-body">{children}</div>
  </details>;
}
export function revealField(element: HTMLElement | null) {
  if (!element) return;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  requestAnimationFrame(() => {
    element.focus(); element.scrollIntoView({ block: "center", behavior: "instant" });
    requestAnimationFrame(() => {
      if (!element.isConnected) return;
      let top = 0;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) top = Math.max(top, parseFloat(getComputedStyle(parent).getPropertyValue("--section-scroll-offset")) || 0);
      const rect = element.getBoundingClientRect();
      if (rect.top < top) window.scrollBy({ top: rect.top - top, behavior: "instant" });
    });
  });
}
