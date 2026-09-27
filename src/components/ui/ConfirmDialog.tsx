"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Prompt = { title: string; detail: string; action: string; danger?: boolean; resolve: (confirmed: boolean) => void };

export function useConfirmation() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const confirm = useCallback((title: string, detail: string, action: string, danger = false) => new Promise<boolean>(resolve => {
    if (pendingRef.current) { resolve(false); return; }
    pendingRef.current = true;
    setPrompt({ title, detail, action, danger, resolve });
  }), []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (prompt && dialog && !dialog.open) dialog.showModal();
    if (!prompt && dialog?.open) dialog.close();
  }, [prompt]);
  const finish = (confirmed: boolean) => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    prompt?.resolve(confirmed);
    setPrompt(null);
  };
  const confirmation = <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); finish(false); }}>
    {prompt && <><h2 id="confirm-title">{prompt.title}</h2><p>{prompt.detail}</p><div className="confirm-actions"><button type="button" className="button secondary" onClick={() => finish(false)}>Cancel</button><button type="button" className={`button ${prompt.danger ? "danger-outline" : "primary"}`} onClick={() => finish(true)}>{prompt.action}</button></div></>}
  </dialog>;
  return { confirm, confirmation };
}
