"use client";

import { ArchiveProvider } from "./ArchiveProvider";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { demoRepository, serverRepositoryView, type RepositoryView } from "@/src/mock/repository";
import { demoSession, accountForCredentials, serverSessionView, type DemoSessionView } from "./demo-session";
import type { Command, CommandResult } from "@/src/domain/commands";

type DemoContextValue = RepositoryView & {
  run: (command: Command) => Promise<CommandResult>;
  session: DemoSessionView;
  signedOut: boolean;
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
  const [signedOut, setSignedOut] = useState(false);
  const snapshotRole = view.snapshot?.role;
  useEffect(() => {
    if (session.role && snapshotRole && snapshotRole !== session.role) {
      void demoRepository.execute({ type: "setRole", role: session.role });
    }
  }, [session.role, snapshotRole]);
  const run = async (command: Command) => {
    if (command.type === "setRole") return { ok: false as const, message: "Sign out and sign in to use a different account." };
    if (!demoSession.read().role) return { ok: false as const, message: "Sign in to continue." };
    const result = await demoRepository.execute(command);
    if (result.ok && ["completeRequestArchive", "completeQuoteArchive", "completePOArchive", "completeBidArchive"].includes(command.type)) setNotice(result.message);
    return result;
  };
  const signIn = async (email: string, password: string) => {
    if (demoSession.read().role) return { ok: false, message: "Sign out before signing in with another account." };
    const account = accountForCredentials(email, password);
    if (!account) return { ok: false, message: "Invalid email or password." };
    const result = await demoRepository.execute({ type: "setRole", role: account.role });
    if (!result.ok) return { ok: false, message: result.message };
    demoSession.select(account);
    setSignedOut(false);
    setNotice("");
    return { ok: true, message: "Signed in." };
  };
  const signOut = () => { setSignedOut(true); demoSession.clear(); setNotice(""); };
  const reset = async () => { await demoRepository.reset(); setNotice("Workspace cleared. Start by adding a project."); };
  return <ArchiveProvider><DemoContext.Provider value={{ ...view, run, session, signedOut, signIn, signOut, reset, notice, clearNotice: () => setNotice("") }}>{children}</DemoContext.Provider></ArchiveProvider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used under DemoProvider");
  return value;
}
