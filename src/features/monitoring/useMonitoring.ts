"use client";

import { useEffect, useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { monitoringParams, parseMonitoringView, type MonitoringFilters, type MonitoringMode, type MonitoringView } from "@/src/domain/monitoring/contracts";
import { object } from "@/src/domain/accounts/accounts";

export function useMonitoring<M extends MonitoringMode>(mode: M, filters: MonitoringFilters, initial: MonitoringView<M> | null, initialFilters: MonitoringFilters) {
  const { revision, session } = useFoundationRealtime();
  const query = monitoringParams(filters).toString();
  const initialQuery = monitoringParams(initialFilters).toString();
  const [completed, setCompleted] = useState<{ query: string; view: MonitoringView<M> | null; error: string; clear?: boolean }>();
  const [retry, setRetry] = useState(0);
  const userId = session?.userId, role = session?.activeRole, accessRevision = session?.revision;

  useEffect(() => {
    if (!userId || !role || !revision && !retry && query === initialQuery && initial) return;
    const controller = new AbortController();
    const url = new URLSearchParams(query);
    url.set("mode", mode);
    void (async () => {
      try {
        const response = await fetch(`/api/monitoring/view?${url}`, {
          cache: "no-store", credentials: "same-origin",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 409) {
          window.location.replace(response.status === 401 ? "/sign-in" : "/choose-role");
          return;
        }
        if (response.status === 403 || response.status === 404) {
          setCompleted({ query, view: null, clear: true, error: "This view is unavailable for your current access." });
          return;
        }
        if (!response.ok) throw new Error("Monitoring unavailable");
        const result = object(await response.json());
        if (controller.signal.aborted) return;
        if (result?.userId !== userId || result.revision !== accessRevision || result.role !== role) {
          setCompleted({ query, view: null, clear: true, error: "Workspace access changed. Reload this page." });
          return;
        }
        const view = parseMonitoringView(mode, result.view);
        if (!view) throw new Error("Invalid monitoring response");
        setCompleted({ query, view, error: "" });
      } catch {
        if (!controller.signal.aborted) setCompleted(current => ({
          query, view: current?.query === query ? current.view : null,
          clear: current?.query === query && current.clear, error: "Updates could not be checked. Try again.",
        }));
      }
    })();
    return () => controller.abort();
  }, [mode, query, initialQuery, initial, revision, retry, userId, role, accessRevision]);

  const result = completed?.query === query ? completed : undefined;
  return {
    view: result?.clear ? null : (result?.view ?? (query === initialQuery ? initial : null)),
    error: result?.error ?? "",
    refresh: () => setRetry(current => current + 1),
    query,
  };
}
