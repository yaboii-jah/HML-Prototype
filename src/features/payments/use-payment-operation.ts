"use client";
import { useRef, useState } from "react";
import { paymentCommandAction } from "@/app/(workspace)/finance/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import type { PaymentCommand } from "@/src/domain/payments/payments";
import { PaymentRecovery } from "@/src/domain/payments/recovery";

export function usePaymentOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false);
  const running = useRef(false);
  const recovery = useRef<PaymentRecovery | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const perform = async (command?: Omit<PaymentCommand, "requestId">) => {
    if (running.current) return null;
    const engine = recovery.current ??= new PaymentRecovery(paymentCommandAction, () => crypto.randomUUID());
    running.current = true; setBusy(true); setMessage(""); setConflict(false);
    try {
      const result = command ? await engine.run(command) : await engine.recover();
      setMessage(result.message);
      setConflict(!!result.conflict);
      return result;
    } finally {
      setUncertain(!!engine.pending);
      running.current = false; setBusy(false); refresh();
    }
  };
  return { busy: busy || uncertain, running: busy, uncertain, message, conflict, run: (command: Omit<PaymentCommand, "requestId">) => perform(command), recover: () => perform() };
}
