"use client";
import { useId, useRef, type ReactNode } from "react";
export function CollapsibleSection({ title, children, defaultOpen = true, summary, className = "" }: { title: string; children: ReactNode; defaultOpen?: boolean; summary?: ReactNode; className?: string }) {
  const id = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} className={`collapsible-section ${className}`} open={defaultOpen} onInvalidCapture={() => { if (ref.current) ref.current.open = true; }}>
    <summary aria-controls={id}><span><strong>{title}</strong>{summary && <small>{summary}</small>}</span><span className="section-chevron" aria-hidden="true">⌄</span></summary>
    <div id={id} className="collapsible-body">{children}</div>
  </details>;
}
export function revealField(element: HTMLElement | null) {
  if (!element) return;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  requestAnimationFrame(() => { element.focus(); element.scrollIntoView({ block: "center", behavior: "instant" }); });
}
