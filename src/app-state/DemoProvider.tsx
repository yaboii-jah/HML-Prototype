"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { demoRepository, serverRepositoryView, type RepositoryView } from "@/src/mock/repository";
import { demoSession, roleForDemoCredentials, serverSessionView, type DemoSessionView } from "./demo-session";
import type { Command, CommandResult } from "@/src/domain/commands";

type DemoContextValue = RepositoryView & {
  run: (command: Command) => Promise<CommandResult>;
  session: DemoSessionView;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => void;
  reset: () => Promise<void>;
  notice: string;
  clearNotice: () => void;
};
const DemoContext = createContext<DemoContextValue | null>(null);
const subscribe = (listener: () => void) => demoRepository.subscribe(listener);
const getSnapshot = () => demoRepository.getSnapshot();
const getServerSnapshot = () => serverRepositoryView;
const subscribeSession = (listener: () => void) => demoSession.subscribe(listener);
const getSession = () => demoSession.read();
const getServerSession = () => serverSessionView;

export function DemoProvider({ children }: { children: ReactNode }) {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const session = useSyncExternalStore(subscribeSession, getSession, getServerSession);
  const [notice, setNotice] = useState("");
  const snapshotRole = view.snapshot?.role;
  useEffect(() => {
    if (session.role && snapshotRole && snapshotRole !== session.role) {
      void demoRepository.execute({ type: "setRole", role: session.role });
    }
  }, [session.role, snapshotRole]);
  const run = async (command: Command) => {
    const previousRole = session.role;
    if (command.type === "setRole" && previousRole) demoSession.select(command.role);
    const result = await demoRepository.execute(command);
    if (!result.ok && command.type === "setRole" && previousRole) demoSession.select(previousRole);
    setNotice(result.message);
    return result;
  };
  const signIn = async (email: string, password: string) => {
    const role = roleForDemoCredentials(email, password);
    if (!role) return { ok: false, message: "Use one of the sample email addresses and the demo password." };
    const result = await demoRepository.execute({ type: "setRole", role });
    if (!result.ok) return { ok: false, message: result.message };
    demoSession.select(role);
    setNotice("");
    return { ok: true, message: `Entered as ${role}.` };
  };
  const signOut = () => { demoSession.clear(); setNotice(""); };
  const reset = async () => { await demoRepository.reset(); setNotice("Workspace restored."); };
  return <DemoContext.Provider value={{ ...view, run, session, signIn, signOut, reset, notice, clearNotice: () => setNotice("") }}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used under DemoProvider");
  return value;
}
