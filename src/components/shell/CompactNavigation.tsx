"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Item = { href: string; label: string; icon: ReactNode; count: number };
export function CompactNavigation({ items, primary, pathname, onNavigate }: { items: Item[]; primary: string[]; pathname: string; onNavigate: () => void }) {
  const ref = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [capacity, setCapacity] = useState(6);
  useLayoutEffect(() => {
    const root = ref.current, aside = root?.closest("aside");
    if (!root || !aside) return;
    const measure = () => {
      const mobile = matchMedia("(max-width:800px)").matches;
      const row = parseFloat(getComputedStyle(root).getPropertyValue("--nav-link-height")) || 38;
      setCapacity(mobile ? items.length : Math.max(1, Math.floor((aside.getBoundingClientRect().bottom - root.getBoundingClientRect().top - 16) / (row + 2))));
    };
    const observer = new ResizeObserver(measure); observer.observe(aside);
    window.addEventListener("resize", measure); measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [items.length]);
  const sorted = [...primary.flatMap(href => items.filter(item => item.href === href)), ...items.filter(item => !primary.includes(item.href))];
  const compact = capacity < items.length;
  const shown = compact ? sorted.slice(0, Math.min(primary.length, Math.max(1, capacity - 1))) : sorted;
  const others = sorted.filter(item => !shown.includes(item));
  const active = (item: Item) => pathname === item.href || pathname.startsWith(`${item.href}/`);
  const link = (item: Item, more = false) => <Link href={item.href} key={item.href} className={`side-link ${active(item) ? "active" : ""}`} aria-current={active(item) ? "page" : undefined} onClick={() => { if (more) dialog.current?.close(); onNavigate(); }}>{item.icon}<span>{item.label}</span>{item.count > 0 && <i>{item.count}</i>}</Link>;
  return <div ref={ref} className="compact-navigation"><nav aria-label="Main navigation">{shown.map(item => link(item))}{compact && <button ref={trigger} type="button" className={`side-link nav-more-trigger ${others.some(active) ? "active" : ""}`} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><span aria-hidden="true">•••</span><span>More sections</span></button>}</nav>
    <dialog ref={dialog} className="nav-more-dialog" aria-label="More workspace sections" onClose={() => trigger.current?.focus({ preventScroll: true })}><div className="panel-heading"><h2>More sections</h2><button className="button secondary" type="button" onClick={() => dialog.current?.close()}>Close</button></div><nav aria-label="Other workspace sections">{others.map(item => link(item, true))}</nav></dialog>
  </div>;
}
