"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { demoRepository, serverRepositoryView, type RepositoryView } from "@/src/mock/repository";
import type { Command, CommandResult } from "@/src/domain/commands";

type DemoContextValue = RepositoryView & {
  run: (command: Command) => Promise<CommandResult>;
  reset: () => Promise<void>;
  notice: string;
  clearNotice: () => void;
};
const DemoContext = createContext<DemoContextValue | null>(null);
const subscribe = (listener: () => void) => demoRepository.subscribe(listener);
const getSnapshot = () => demoRepository.getSnapshot();
const getServerSnapshot = () => serverRepositoryView;

export function DemoProvider({ children }: { children: ReactNode }) {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [notice, setNotice] = useState("");
  const run = async (command: Command) => {
    const result = await demoRepository.execute(command);
    setNotice(result.message);
    return result;
  };
  const reset = async () => { await demoRepository.reset(); setNotice("Workspace restored."); };
  return <DemoContext.Provider value={{ ...view, run, reset, notice, clearNotice: () => setNotice("") }}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used under DemoProvider");
  return value;
}
