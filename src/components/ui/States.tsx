"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "./ConfirmDialog";
import type { ReactNode } from "react";

export function DataGate({ children }: { children: ReactNode }) {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot, status, message, reset, session, signedOut } = useDemo();
  const router = useRouter();
  useEffect(() => {
    if (status === "loading" || status === "recovery" || !snapshot || session.status === "loading" || session.role) return;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    router.replace(signedOut ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
  }, [router, session.role, session.status, snapshot, status, signedOut]);
  if (status === "loading") return <div className="state-screen"><div className="state-card"><span className="eyebrow">HML ConstructSync</span><h1>Opening workspace</h1><p>Loading project records…</p></div></div>;
  if (!snapshot || status === "recovery") return <><div className="state-screen"><div className="state-card"><span className="eyebrow">WORKSPACE RECOVERY</span><h1>Saved data needs attention</h1><p>{message}</p>{session.role === "Administrator" ? <button className="button primary" onClick={() => void (async () => { if (await confirm("Clear this workspace?", "Saved records and uploaded files will be removed and replaced with an empty workspace.", "Clear workspace", true)) await reset(); })()}>Clear workspace</button> : <Link href="/sign-in" className="button primary">Sign in as Administrator</Link>}</div></div>{confirmation}</>;
  if (session.status === "loading" || !session.role || snapshot.role !== session.role) return <div className="state-screen"><div className="state-card"><span className="eyebrow">HML ConstructSync</span><h1>Opening workspace</h1><p>Loading your account…</p></div></div>;
  return <>{status === "volatile" && <div className="storage-warning" role="status">{message}</div>}{children}</>;
}

export function MissingRecord({ name, listHref }: { name: string; listHref: string }) {
  return <div className="empty-page"><span className="eyebrow">RECORD UNAVAILABLE</span><h1>{name} not found</h1><p>This link may refer to an unavailable record.</p><Link className="button secondary" href={listHref}>Back to list</Link></div>;
}
