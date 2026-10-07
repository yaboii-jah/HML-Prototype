"use client";

import { ArchiveProvider } from "./ArchiveProvider";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { demoRepository, serverRepositoryView, type RepositoryView } from "@/src/mock/repository";
import { demoSession, accountForCredentials, serverSessionView, type DemoSessionView } from "./demo-session";
import type { Command, CommandResult } from "@/src/domain/commands";
import type { AuditIdentity, OperationTarget, Role } from "@/src/domain/types";
import { ACCOUNT_FIXTURES } from "./demo-session";
import { bindAccountCommands, type CommandRunner } from "./command-gateway";

type DemoContextValue = RepositoryView & {
  run: (command: Command) => Promise<CommandResult>;
  beginOperation: (target: OperationTarget) => Promise<CommandRunner>;
  session: DemoSessionView;
  signedOut: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  switchRole: (role: Role) => { ok: boolean; message: string };
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
const identityFor = (account: DemoSessionView): AuditIdentity | undefined => {
  const fixture = ACCOUNT_FIXTURES.find(value => value.email === account.email && value.role === account.role);
  return fixture ? { name: fixture.name, email: fixture.email, role: fixture.role } : undefined;
};

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
  const gateway = bindAccountCommands(demoRepository, identityFor(session), () => identityFor(demoSession.read()));
  const run = async (command: Command) => {
    const result = await gateway.run(command);
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
  const switchRole = (role: Role) => {
    const active = demoSession.read();
    if (!view.snapshot || active.email !== session.email || active.role !== session.role || !demoSession.switchRole(role)) return { ok: false, message: "Sign in before changing departments." };
    setNotice("");
    return { ok: true, message: "Department changed." };
  };
  const reset = async () => { await demoRepository.reset(); setNotice("Workspace cleared. Start by adding a project."); };
  return <ArchiveProvider><DemoContext.Provider value={{ ...view, run, beginOperation: gateway.beginOperation, session, signedOut, signIn, switchRole, signOut, reset, notice, clearNotice: () => setNotice("") }}>{children}</DemoContext.Provider></ArchiveProvider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used under DemoProvider");
  return value;
}
