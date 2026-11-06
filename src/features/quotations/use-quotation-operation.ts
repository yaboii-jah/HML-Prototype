"use client";
import { useRef, useState } from "react";
import { quotationCommandAction } from "@/app/(workspace)/requests/[id]/quotes/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import type { QuoteInput } from "@/src/domain/quotations/drafts";

export function useQuoteOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState("");
  const running = useRef(false),
    retry = useRef<{ key: string; id: string } | null>(null);
  const run = async (input: QuoteInput) => {
    if (running.current) return null;
    const key = JSON.stringify(input);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    setNotice("");
    try {
      const result = await quotationCommandAction({
        ...input,
        requestId: retry.current.id,
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
    setConflict(false);
    setError("");
    retry.current = null;
  };
  return { busy, error, conflict, notice, run, reviewed };
}
