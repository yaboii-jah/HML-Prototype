"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function RecordModal({ open, title, onClose, children, tabs, returnFocus }: { open: boolean; title: string; onClose: () => void; children: ReactNode; tabs?: ReactNode; returnFocus?: () => HTMLElement | null }) {
  const id = useId(), ref = useRef<HTMLDialogElement>(null), invoker = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose), returnRef = useRef(returnFocus);
  useEffect(() => { closeRef.current = onClose; returnRef.current = returnFocus; });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.showModal(); dialog.querySelector<HTMLButtonElement>(".record-modal-close")?.focus(); }
    else if (!open && dialog.open) { dialog.close(); const target = returnRef.current?.() || invoker.current; if (target?.isConnected && target.checkVisibility()) target.focus({ preventScroll: true }); }
  }, [open]);
  return <dialog ref={ref} className="record-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClose={() => closeRef.current()}>
    <header className="record-dialog-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" className="button secondary record-modal-close" onClick={onClose}>Close</button></header>
    {tabs}<div className="record-dialog-body">{children}</div>
  </dialog>;
}
