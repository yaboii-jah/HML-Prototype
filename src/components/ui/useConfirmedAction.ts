"use client";

import { useRef, useState } from "react";
import { useConfirmation } from "./ConfirmDialog";

export type ConfirmedAction = (title: string, detail: string, action: string, execute: () => void | Promise<unknown>, danger?: boolean) => Promise<void>;

/** Hold the operation lock through both confirmation and the resulting work. */
export function useConfirmedAction(onError: (message: string) => void) {
  const { confirm, confirmation } = useConfirmation();
  const locked = useRef(false);
  const [working, setWorking] = useState(false);
  const confirmAction: ConfirmedAction = async (title, detail, action, execute, danger = false) => {
    if (locked.current) return;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const popoverTrigger = invoker?.closest("[popover]")?.previousElementSibling;
    const returnTo = popoverTrigger instanceof HTMLElement ? popoverTrigger : invoker;
    locked.current = true; setWorking(true);
    try {
      if (!await confirm(title, detail, action, danger)) return;
      await execute();
    } catch (cause) { onError(cause instanceof Error ? cause.message : "The action could not be completed. Please try again."); }
    finally {
      locked.current = false; setWorking(false);
      requestAnimationFrame(() => { if (returnTo?.isConnected && returnTo.checkVisibility() && !returnTo.matches(":disabled")) returnTo.focus({ preventScroll: true }); });
    }
  };
  return { confirmAction, working, confirmation };
}
