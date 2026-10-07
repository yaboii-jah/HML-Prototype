"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type Prompt = { title: string; detail: string; action: string; danger?: boolean; resolve: (confirmed: boolean) => void };
export type ConfirmAction = (title: string, detail: string, action: string, danger?: boolean) => Promise<boolean>;

export function useConfirmation() {
  const id = useId();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const promptRef = useRef<Prompt | null>(null);
  const confirm = useCallback((title: string, detail: string, action: string, danger = false) => new Promise<boolean>(resolve => {
    if (pendingRef.current) { resolve(false); return; }
    pendingRef.current = true;
    const next = { title, detail, action, danger, resolve };
    promptRef.current = next;
    setPrompt(next);
  }), []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (prompt && dialog && !dialog.open) dialog.showModal();
    if (!prompt && dialog?.open) dialog.close();
  }, [prompt]);
  useEffect(() => () => { promptRef.current?.resolve(false); pendingRef.current = false; }, []);
  const finish = (confirmed: boolean) => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    promptRef.current?.resolve(confirmed);
    promptRef.current = null;
    setPrompt(null);
  };
  const confirmation = <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); finish(false); }}>
    {prompt && <><h2 id={`${id}-title`}>{prompt.title}</h2><p>{prompt.detail}</p><div className="confirm-actions"><button type="button" className="button secondary" onClick={() => finish(false)}>Cancel</button><button type="button" className={`button ${prompt.danger ? "danger-outline" : "primary"}`} onClick={() => finish(true)}>{prompt.action}</button></div></>}
  </dialog>;
  return { confirm, confirmation };
}
