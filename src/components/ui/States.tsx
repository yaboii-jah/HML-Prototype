"use client";

import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import type { ReactNode } from "react";

export function DataGate({ children }: { children: ReactNode }) {
  const { snapshot, status, message, reset } = useDemo();
  if (status === "loading") return <div className="state-screen"><div className="state-card"><span className="eyebrow">HML BUILDSYNC</span><h1>Opening workspace</h1><p>Loading project records…</p></div></div>;
  if (!snapshot || status === "recovery") return <div className="state-screen"><div className="state-card"><span className="eyebrow">WORKSPACE RECOVERY</span><h1>Saved data needs attention</h1><p>{message}</p><button className="button primary" onClick={() => { if (window.confirm("Restore the workspace? Current saved records will be replaced.")) void reset(); }}>Restore workspace</button></div></div>;
  return <>{status === "volatile" && <div className="storage-warning" role="status">{message}</div>}{children}</>;
}

export function MissingRecord({ name, listHref }: { name: string; listHref: string }) {
  return <div className="empty-page"><span className="eyebrow">RECORD UNAVAILABLE</span><h1>{name} not found</h1><p>This link may refer to an unavailable record.</p><Link className="button secondary" href={listHref}>Back to list</Link></div>;
}
