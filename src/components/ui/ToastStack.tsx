"use client";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useToasts, type Toast } from "@/src/app-state/ToastProvider";

const glyphs: Record<Toast["tone"], string> = { progress: "", success: "✓", warning: "!", error: "✕" };
const subscribeMounted = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function ToastCard({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  return <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} aria-live={toast.tone === "error" ? "assertive" : "polite"} aria-atomic="true" aria-busy={toast.tone === "progress" || undefined}>
    <span className="toast-glyph" aria-hidden="true">{toast.tone === "progress" ? <i className="toast-spinner" /> : glyphs[toast.tone]}</span>
    <div className="toast-text"><strong>{toast.title}</strong>{toast.detail && <small>{toast.detail}</small>}</div>
    <button type="button" className="toast-close" aria-label={`Dismiss: ${toast.title}`} onClick={() => dismiss(toast.id)}>×</button>
  </div>;
}

export function ToastStack() {
  const { toasts, dismiss } = useToasts();
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted);
  if (!mounted || !toasts.length) return null;
  return createPortal(<div className="toast-stack" aria-label="Notifications">
    {toasts.map(toast => <ToastCard key={toast.id} toast={toast} dismiss={dismiss}/>)}
  </div>, document.body);
}