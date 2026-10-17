"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceSkeleton, skeletonVariant } from "./PageSkeleton";
import { Fragment, useEffect } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "./ConfirmDialog";
import type { ReactNode } from "react";

export function DataGate({ children }: { children: ReactNode }) {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot, status, message, reset, session, signedOut, directory } = useDemo();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (status === "loading" || status === "recovery" || !snapshot || session.status === "loading" || session.role) return;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    router.replace(signedOut ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
  }, [router, session.role, session.status, snapshot, status, signedOut]);
  if (directory.status === "recovery") return <div className="state-screen"><div className="state-card"><h1>Saved user accounts need attention</h1><p>{directory.error}</p><p>Restore the saved user directory in browser storage before continuing.</p></div></div>;
  if (status === "loading") return <WorkspaceSkeleton variant={skeletonVariant(pathname)}/>;
  if (!snapshot || status === "recovery") return <><div className="state-screen"><div className="state-card"><span className="eyebrow">WORKSPACE RECOVERY</span><h1>Saved data needs attention</h1><p>{message}</p>{session.role === "Administrator" ? <button className="button primary" onClick={() => void (async () => { if (await confirm("Clear this workspace?", "Saved records and uploaded files will be removed and replaced with an empty workspace.", "Clear workspace", true)) await reset(); })()}>Clear workspace</button> : <Link href="/sign-in" className="button primary">Sign in as Administrator</Link>}</div></div>{confirmation}</>;
  if (session.status === "loading" || directory.status === "loading" || !session.role || snapshot.role !== session.role) return <WorkspaceSkeleton variant={skeletonVariant(pathname)}/>;
  return <Fragment key={`${snapshot.showcase?.installationId || "workspace"}:${session.userId}:${session.revision}`}>{status === "volatile" && <div className="storage-warning" role="status">{message}</div>}{children}</Fragment>;
}

export function WorkspaceAccess({ children }: { children: ReactNode }) {
  const { access } = useDemo();
  const pathname = usePathname();
  if (!access.canOpen(pathname)) return <div className="empty-page"><span className="eyebrow">PROJECT ACCESS</span><h1>Access unavailable</h1><p>This page is outside your assigned projects or role. Ask an Administrator to review your project access.</p><Link className="button secondary" href="/dashboard">Back to dashboard</Link></div>;
  return <>{children}</>;
}

export function AssignmentNotice() {
  const { access } = useDemo();
  if (!access.sitePersonnel || access.projectIds.length) return null;
  return <section className="panel" role="status"><h2>No assigned projects</h2><p>Ask an Administrator to assign your account to a project before requesting materials, receiving deliveries or managing site stock.</p></section>;
}

export function MissingRecord({ name, listHref }: { name: string; listHref: string }) {
  return <div className="empty-page"><span className="eyebrow">RECORD UNAVAILABLE</span><h1>{name} not found</h1><p>This link may refer to an unavailable record.</p><Link className="button secondary" href={listHref}>Back to list</Link></div>;
}
