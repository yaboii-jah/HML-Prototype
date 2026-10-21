"use client";

import { ArchiveProvider } from "./ArchiveProvider";
import { ToastProvider, useToasts } from "./ToastProvider";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { demoRepository, serverRepositoryView, type RepositoryView } from "@/src/mock/repository";
import { demoSession, accountForCredentials, serverSessionView, type DemoSessionView } from "./demo-session";
import type { Command, CommandResult } from "@/src/domain/commands";
import type { AuditIdentity, OperationTarget, Role } from "@/src/domain/types";
import { userDirectory, serverUserDirectory, type UserDirectoryView, type UserChange } from "./user-directory";
import { bindAccountCommands, type CommandRunner } from "./command-gateway";
import { createReadAccess, type ReadAccess } from "@/src/domain/read-access";

const NO_ASSIGNMENTS: readonly string[] = [];

type DemoContextValue = RepositoryView & {
  run: (command: Command) => Promise<CommandResult>;
  beginOperation: (target: OperationTarget) => Promise<CommandRunner>;
  session: DemoSessionView;
  signedOut: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  directory: UserDirectoryView;
  siteIds: readonly string[];
  access: ReadAccess;
  manageUser: (change: UserChange) => Promise<{ ok: boolean; message: string }>;
  switchAccount: (id: string) => { ok: boolean; message: string };
  switchRole: (role: Role) => { ok: boolean; message: string };
  signOut: () => void;
  reset: () => Promise<boolean>;
  retrySetup: () => Promise<RepositoryView>;
};
const DemoContext = createContext<DemoContextValue | null>(null);
const subscribe = (listener: () => void) => demoRepository.subscribe(listener);
const getSnapshot = () => demoRepository.getSnapshot();
const getServerSnapshot = () => serverRepositoryView;
const subscribeSession = (listener: () => void) => demoSession.subscribe(listener);
const getSession = () => demoSession.read();
const getServerSession = () => serverSessionView;
const identityFor = (account: DemoSessionView): AuditIdentity | undefined => {
  const user = userDirectory.getSnapshot().users.find(value => value.active && value.id === account.userId && value.email === account.email && value.role === account.role && value.revision === account.revision);
  return user ? { name: user.name, email: user.email, role: user.role, userId: user.id, sessionRevision: user.revision } : undefined;
};

function DemoSessionProvider({ children }: { children: ReactNode }) {
  const { notify, clear } = useToasts();
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const session = useSyncExternalStore(subscribeSession, getSession, getServerSession);
  const directory = useSyncExternalStore(listener => userDirectory.subscribe(listener), () => userDirectory.getSnapshot(), () => serverUserDirectory);
  useEffect(() => { void userDirectory.load(); void demoRepository.load(); }, []);
  const [signedOut, setSignedOut] = useState(false);
  const snapshotRole = view.snapshot?.role;
  useEffect(() => {
    if (session.role && snapshotRole && snapshotRole !== session.role) {
      void demoRepository.execute({ type: "setRole", role: session.role });
    }
  }, [session.role, snapshotRole]);
  const siteIds = directory.users.find(user => user.id === session.userId)?.siteIds || NO_ASSIGNMENTS;
  const access = useMemo(() => createReadAccess(view.snapshot, session.role, siteIds), [view.snapshot, session.role, siteIds]);
  const snapshot = useMemo(() => view.snapshot && view.snapshot.siteFilter !== access.siteFilter ? { ...view.snapshot, siteFilter: access.siteFilter } : view.snapshot, [view.snapshot, access.siteFilter]);
  const gateway = bindAccountCommands(demoRepository, identityFor(session), () => identityFor(demoSession.read()), () => userDirectory.getSnapshot().users.find(user => user.id === demoSession.read().userId)?.siteIds || []);
  const run = async (command: Command) => {
    const result = await gateway.run(command);
    if (result.ok && ["completeRequestArchive", "completeQuoteArchive", "completePOArchive", "completeBidArchive"].includes(command.type)) notify({ tone: "success", title: result.message });
    return result;
  };
  const signIn = async (email: string, password: string) => {
    if (demoSession.read().role) return { ok: false, message: "Sign out before signing in with another account." };
    const account = await accountForCredentials(email, password);
    if (!account) return { ok: false, message: "Invalid email or password." };
    if (view.status === "recovery") {
      if (account.role !== "Administrator") return { ok: false, message: "An Administrator must restore this workspace before signing in." };
      demoSession.select(account); return { ok: true, message: "Administrator verified. You can restore the workspace." };
    }
    const result = await demoRepository.execute({ type: "setRole", role: account.role });
    if (!result.ok) return { ok: false, message: result.message };
    demoSession.select(account);
    setSignedOut(false);
    clear();
    return { ok: true, message: "Signed in." };
  };
  const signOut = () => { setSignedOut(true); demoSession.clear(); clear(); };
  const switchRole = (role: Role) => {
    const active = demoSession.read();
    if (!view.snapshot || active.email !== session.email || active.role !== session.role || !demoSession.switchRole(role)) return { ok: false, message: "Sign in before changing departments." };
    clear();
    return { ok: true, message: "Department changed." };
  };
  const switchAccount = (id: string) => {
    const active = demoSession.read();
    if (!view.snapshot || active.userId !== session.userId || active.revision !== session.revision || !demoSession.switchAccount(id)) return { ok: false, message: "Sign in before switching accounts." };
    clear(); return { ok: true, message: "Account changed." };
  };
  const manageUser = async (change: UserChange) => {
    const actor = identityFor(demoSession.read());
    if (!actor || actor.role !== "Administrator" || actor.userId !== session.userId || actor.sessionRevision !== session.revision) return { ok: false, message: "Your account changed. Sign in as Administrator to manage users." };
    if ((change.type === "add" || change.type === "edit") && change.siteIds?.some(id => !view.snapshot?.sites.some(site => site.id === id))) return { ok: false, message: "Choose projects from the current workspace." };
    return userDirectory.change(actor, change);
  };
  const reset = async () => {
    userDirectory.refresh();
    const actor = identityFor(demoSession.read());
    if (!actor || actor.role !== "Administrator" || actor.userId !== session.userId || actor.sessionRevision !== session.revision) {
      notify({ id: "workspace-reset", tone: "error", title: "Sign in as the current Administrator before clearing the workspace." });
      return false;
    }
    notify({ id: "workspace-reset", tone: "progress", title: "Clearing workspace…" });
    try {
      const result = await demoRepository.reset();
      if (result.status !== "ready") throw new Error(result.message || "Browser storage is unavailable.");
      userDirectory.refresh();
      notify({ id: "workspace-reset", tone: "success", title: "Workspace cleared. Start by adding a project." });
      return true;
    } catch {
      userDirectory.refresh();
      notify({ id: "workspace-reset", tone: "error", title: "Workspace clearing did not finish.", detail: "Some data may already have been removed. Retry Clear workspace when browser storage is available." });
      return false;
    }
  };
  return <ArchiveProvider key={snapshot?.showcase?.installationId || "workspace"}><DemoContext.Provider value={{ ...view, snapshot, access, run, beginOperation: gateway.beginOperation, session, signedOut, directory, siteIds, manageUser, signIn, switchRole, switchAccount, signOut, reset, retrySetup: () => demoRepository.retrySetup() }}>{children}</DemoContext.Provider></ArchiveProvider>;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  return <ToastProvider><DemoSessionProvider>{children}</DemoSessionProvider></ToastProvider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used under DemoProvider");
  return value;
}
