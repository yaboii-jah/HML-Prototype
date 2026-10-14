"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Empty } from "./Primitives";

export function Register<T>({ rows, headers, renderRow, filters, resetKey = "", unit = "records", empty = "No records match this view.", className = "", tableClassName = "", embedded = false }: { rows: readonly T[]; headers: ReactNode; renderRow: (row: T) => ReactNode; filters?: ReactNode; resetKey?: string; unit?: string; empty?: string; className?: string; tableClassName?: string; embedded?: boolean }) {
  const [paging, setPaging] = useState({ key: resetKey, page: 1, size: 10 });
  const pages = Math.max(1, Math.ceil(rows.length / paging.size));
  const page = paging.key === resetKey ? Math.min(paging.page, pages) : 1;
  const start = (page - 1) * paging.size;
  const move = (next: number) => { setPaging(current => ({ ...current, key: resetKey, page: next })); };
  return <RegisterFrame embedded={embedded} className={className} filters={filters} resetKey={`${resetKey}-${page}-${paging.size}`} footer={<footer className="register-footer"><label>Per page <select aria-label={`${unit} per page`} value={paging.size} onChange={event => { setPaging({ key: resetKey, page: 1, size: Number(event.target.value) }); }}>{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>{rows.length ? start + 1 : 0}–{Math.min(start + paging.size, rows.length)} of {rows.length} {unit}</span><div className="register-page-controls"><button type="button" className="button secondary" disabled={page <= 1} onClick={() => move(page - 1)} aria-label={`Previous ${unit} page`}>Previous</button><span>{page} / {pages}</span><button type="button" className="button secondary" disabled={page >= pages} onClick={() => move(page + 1)} aria-label={`Next ${unit} page`}>Next</button></div></footer>}>
    <table className={tableClassName}><thead><tr>{headers}</tr></thead><tbody>{rows.slice(start, start + paging.size).map(renderRow)}</tbody></table>{!rows.length && <Empty detail={empty}/>}
  </RegisterFrame>;
}

export function RegisterFrame({ children, footer, filters, embedded = false, className = "", scrollClassName = "", resetKey = "" }: { children: ReactNode; footer: ReactNode; filters?: ReactNode; embedded?: boolean; className?: string; scrollClassName?: string; resetKey?: string }) {
  const ref = useRef<HTMLElement>(null);
  const hasFilters = !!filters;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const table = root.querySelector("table"), footer = root.querySelector<HTMLElement>(".register-footer"), toolbar = root.querySelector<HTMLElement>(".register-toolbar");
    const update = () => {
      if (!root.checkVisibility()) return;
      const viewport = window.visualViewport;
      // Viewport-relative positions change with page scrolling. Use the document
      // position so observer/filter updates cannot progressively grow the table.
      const documentTop = root.getBoundingClientRect().top + window.scrollY;
      const available = (viewport?.height || innerHeight) - documentTop - 16;
      const contentHeight = (table?.offsetHeight || 0) + (footer?.offsetHeight || 0) + (toolbar?.offsetHeight || 0) + 20;
      const minimumHeight = parseFloat(getComputedStyle(root).minHeight) || 480;
      root.style.setProperty("--register-height", `${embedded ? Math.min(520, Math.max(160, contentHeight)) : Math.max(minimumHeight, available)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    if (root.parentElement) observer.observe(root.parentElement);
    if (table) observer.observe(table);
    if (footer) observer.observe(footer);
    const visibility = new MutationObserver(update);
    if (root.parentElement) visibility.observe(root.parentElement, { attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", update); window.visualViewport?.addEventListener("resize", update);
    update();
    return () => { observer.disconnect(); visibility.disconnect(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, [embedded, hasFilters, resetKey]);
  useEffect(() => { ref.current?.querySelector(".register-scroll")?.scrollTo({ top: 0 }); }, [resetKey]);
  return <section ref={ref} className={`register ${embedded ? "is-embedded" : ""} ${className}`}>
    {filters && <div className="register-toolbar toolbar">{filters}</div>}
    <div className={`register-scroll table-frame ${scrollClassName}`}>{children}</div>
    {footer}
  </section>;
}

export function ViewTabs({ labels, active, onChange, id }: { labels: string[]; active: number; onChange: (index: number) => void; id: string }) {
  return <div className="view-tabs" role="tablist" aria-label="Views">{labels.map((label, index) => <button key={label} id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={active === index} aria-controls={`${id}-panel-${index}`} tabIndex={active === index ? 0 : -1} onClick={() => onChange(index)} onKeyDown={event => {
    const next = event.key === "ArrowRight" ? (index + 1) % labels.length : event.key === "ArrowLeft" ? (index - 1 + labels.length) % labels.length : event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); onChange(next); document.getElementById(`${id}-tab-${next}`)?.focus();
  }}>{label}</button>)}</div>;
}
