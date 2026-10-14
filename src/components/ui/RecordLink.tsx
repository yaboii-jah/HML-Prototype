"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";

/** Restricted related records retain their reference without offering an inaccessible link. */
export function RecordLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const { access } = useDemo();
  return access.canOpen(href) ? <Link href={href} className={className}>{children}</Link> : <span className={className}>{children}</span>;
}
