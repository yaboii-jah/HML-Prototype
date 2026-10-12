"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseButton } from "./CloseButton";

export function RecordModal({ open, title, onClose, children, tabs, returnFocus }: { open: boolean; title: string; onClose: () => void; children: ReactNode; tabs?: ReactNode; returnFocus?: () => HTMLElement | null }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null), invoker = useRef<HTMLElement | null>(null), focusScope = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose), returnRef = useRef(returnFocus);
  useEffect(() => { closeRef.current = onClose; returnRef.current = returnFocus; });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; focusScope.current = invoker.current?.closest<HTMLElement>(".register, .panel, section") || null; dialog.showModal(); dialog.querySelector<HTMLButtonElement>(".record-modal-close")?.focus(); }
    else if (!open && dialog.open) {
      dialog.close();
      const target = returnRef.current?.() || invoker.current;
      const fallback = focusScope.current?.querySelector<HTMLElement>('input[type="search"], input[aria-label^="Search"], [data-material-details-trigger]:not(:disabled), button:not(:disabled), [tabindex="0"]');
      const destination = target?.isConnected && target.checkVisibility() ? target : fallback;
      if (destination?.isConnected && destination.checkVisibility()) destination.focus({ preventScroll: true });
    }
  }, [open]);
  return <dialog ref={ref} className="record-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClose={() => closeRef.current()}>
    <header className="record-dialog-heading"><h2 id={`${id}-title`}>{title}</h2><CloseButton className="record-modal-close" onClick={onClose}/></header>
    {tabs}<div className="record-dialog-body">{children}</div>
  </dialog>;
}
