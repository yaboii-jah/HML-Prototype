"use client";
import { useId, useRef, type ReactNode } from "react";

export function RowActions({ children }: { children: ReactNode }) {
  const id = useId(), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} className="button secondary" type="button" popoverTarget={id} onClick={() => requestAnimationFrame(() => {
    const panel = menu.current, button = trigger.current;
    if (!panel || !button || !panel.matches(":popover-open")) return;
    const anchor = button.getBoundingClientRect(), rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, anchor.right - rect.width))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - rect.height - 8, anchor.bottom + 4))}px`;
  })}>More actions</button><div ref={menu} id={id} popover="auto" className="row-action-menu" onClick={event => { if (event.target instanceof Element && event.target.closest("button,a")) menu.current?.hidePopover(); }}>{children}</div></>;
}
