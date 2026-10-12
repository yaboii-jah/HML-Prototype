import type { CSSProperties, ReactNode } from "react";

export function Skeleton({ width, height, className = "" }: { width?: CSSProperties["width"]; height?: CSSProperties["height"]; className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} style={{ width, height }}/>;
}

/** Layout is reserved immediately; CSS reveals the shapes after a 150 ms grace. */
export function LoadingRegion({ pending = true, label = "Loading content…", children, className = "", inline = false }: { pending?: boolean; label?: string; children: ReactNode; className?: string; inline?: boolean }) {
  const Tag = inline ? "span" : "div";
  // Keep the announcement outside the busy subtree so assistive technology
  // doesn't defer it until loading has already finished.
  return <>{pending && <span className="loading-status" role="status">{label}</span>}<Tag className={`loading-region ${className}`} aria-busy={pending}>
    {children}
  </Tag></>;
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return <div className="loading-visual skeleton-rows" aria-hidden="true">{Array.from({ length: rows }, (_, row) => <div className="skeleton-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} key={row}>{Array.from({ length: columns }, (_, column) => <Skeleton key={column} width={column ? "70%" : "90%"}/>)}</div>)}</div>;
}

export function DocumentSkeleton({ compact = false }: { compact?: boolean }) {
  return <span className={`loading-visual skeleton-document ${compact ? "is-compact" : ""}`} aria-hidden="true"><span className="skeleton-paper"><Skeleton width="45%" height={20}/><Skeleton width="75%"/><Skeleton width="60%"/><span className="skeleton-paper-grid">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index}/>)}</span><Skeleton width="40%"/></span></span>;
}

export function DocumentLoading({ compact = false, inline = false }: { compact?: boolean; inline?: boolean }) {
  return <LoadingRegion label="Loading document…" className="document-loading" inline={inline}><DocumentSkeleton compact={compact}/></LoadingRegion>;
}
