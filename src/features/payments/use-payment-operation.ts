"use client";
import { useRef, useState } from "react";
import { paymentCommandAction } from "@/app/(workspace)/finance/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import type { PaymentCommand } from "@/src/domain/payments/payments";

export function usePaymentOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false);
  const running = useRef(false), retry = useRef<{ key: string; id: string } | null>(null);
  const run = async (command: Omit<PaymentCommand, "requestId">) => {
    if (running.current) return null;
    const key = JSON.stringify(command);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    running.current = true; setBusy(true); setMessage(""); setConflict(false);
    try {
      const result = await paymentCommandAction({ ...command, requestId: retry.current.id });
      setMessage(result.message);
      if (result.ok) retry.current = null;
      else setConflict("conflict" in result && !!result.conflict);
      return result;
    } catch {
      setMessage("The response was interrupted. Retry the same action to check its saved outcome.");
      return null;
    } finally { running.current = false; setBusy(false); refresh(); }
  };
  return { busy, message, conflict, run };
}
