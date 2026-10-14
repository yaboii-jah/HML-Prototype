"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { ArchiveProgress, ArchiveProgressListener } from "@/src/domain/archive-progress";
import type { OperationTarget } from "@/src/domain/types";

type Job = ArchiveProgress & { id: string; label: string; target?: OperationTarget; error?: string };
type ArchiveContext = { jobs: Job[]; perform: <T>(id: string, label: string, task: (progress: ArchiveProgressListener) => Promise<T>, target?: OperationTarget) => Promise<T>; dismiss: (id: string) => void };
const Context = createContext<ArchiveContext | null>(null);
export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const active = useRef(new Map<string, Promise<unknown>>());
  const perform = useCallback(<T,>(id: string, label: string, task: (progress: ArchiveProgressListener) => Promise<T>, target?: OperationTarget): Promise<T> => {
    const running = active.current.get(id);
    if (running) return running as Promise<T>;
    const progress: ArchiveProgressListener = value => setJobs(current => [...current.filter(job => job.id !== id), { id, label, target, ...value }]);
    progress({ phase: "preparing" });
    const promise = Promise.resolve().then(() => task(progress)).then(result => {
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        setJobs(current => current.map(job => job.id === id ? { ...job, error: "message" in result ? String(result.message) : "Archive needs retry." } : job));
      } else {
        progress({ phase: "complete" });
        setTimeout(() => setJobs(current => current.filter(job => job.id !== id || job.phase !== "complete")), 4500);
      }
      return result;
    }).catch(cause => {
      setJobs(current => current.map(job => job.id === id ? { ...job, error: cause instanceof Error ? cause.message : "Archive needs retry." } : job));
      throw cause;
    }).finally(() => active.current.delete(id));
    active.current.set(id, promise);
    return promise;
  }, []);
  const dismiss = (id: string) => setJobs(current => current.filter(job => job.id !== id || active.current.has(id)));
  return <Context.Provider value={{ jobs, perform, dismiss }}>{children}</Context.Provider>;
}
export function useArchive() {
  const value = useContext(Context);
  if (!value) throw new Error("ArchiveProvider is missing.");
  return value;
}
