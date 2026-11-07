"use client";
import { useRef, useState } from "react";
import { purchasingCommandAction } from "@/app/(workspace)/purchase-orders/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import type { PurchasingCommand } from "@/src/domain/purchasing/contracts";

export function usePurchasingOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
  const running = useRef(false),
    retry = useRef<{ key: string; id: string } | null>(null);
  const run = async (
    input: Omit<PurchasingCommand, "requestId">,
    stableRequestId?: string,
  ) => {
    if (running.current) return null;
    const key = JSON.stringify(input);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const result = await purchasingCommandAction({
        ...input,
        requestId: stableRequestId || retry.current.id,
      });
      if (result.ok) {
        retry.current = null;
        setNotice(result.message);
      } else {
        setError(result.message);
        setConflict(!!result.conflict);
      }
      return result;
    } catch {
      setError(
        "The response was interrupted. Retry the same request to check its saved outcome.",
      );
      return null;
    } finally {
      running.current = false;
      setBusy(false);
      refresh();
    }
  };
  const reviewed = () => {
    setError("");
    setConflict(false);
    retry.current = null;
  };
  return { busy, error, notice, conflict, run, reviewed };
}
