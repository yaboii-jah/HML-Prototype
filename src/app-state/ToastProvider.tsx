"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "progress" | "success" | "warning" | "error";
export type ToastInput = { id?: string; tone: ToastTone; title: string; detail?: string };
export type Toast = { id: string; tone: ToastTone; title: string; detail?: string };

const VISIBLE_LIMIT = 4;
const AUTO_DISMISS_MS: Record<ToastTone, number | null> = { progress: null, success: 4000, warning: 8000, error: null };
let sequence = 0;

type ToastContext = {
  toasts: Toast[];
  notify: (input: ToastInput) => string;
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};
const Context = createContext<ToastContext | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback((id: string, tone: ToastTone) => {
    clearTimer(id);
    const duration = AUTO_DISMISS_MS[tone];
    if (duration === null) return;
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setToasts(current => current.filter(toast => toast.id !== id));
    }, duration));
  }, [clearTimer]);

  const upsert = useCallback((input: ToastInput) => {
    const id = input.id || `toast-${++sequence}`;
    setToasts(current => {
      const existing = current.find(toast => toast.id === id);
      const next: Toast = { id, tone: input.tone, title: input.title, detail: input.detail };
      const updated = existing ? current.map(toast => (toast.id === id ? next : toast)) : [...current, next];
      return updated.length > VISIBLE_LIMIT ? updated.slice(updated.length - VISIBLE_LIMIT) : updated;
    });
    schedule(id, input.tone);
    return id;
  }, [schedule]);

  const dismiss = useCallback((id: string) => {
    clearTimer(id);
    setToasts(current => current.filter(toast => toast.id !== id));
  }, [clearTimer]);

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);

  const value = useMemo<ToastContext>(() => ({ toasts, notify: upsert, update: (id, patch) => {
    setToasts(current => {
      const target = current.find(toast => toast.id === id);
      if (!target) return current;
      const tone = patch.tone ?? target.tone;
      schedule(id, tone);
      return current.map(toast => (toast.id === id ? { ...toast, ...patch, tone } : toast));
    });
  }, dismiss, clear }), [toasts, upsert, dismiss, clear, schedule]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useToasts() {
  const value = useContext(Context);
  if (!value) throw new Error("useToasts must be used under ToastProvider.");
  return value;
}