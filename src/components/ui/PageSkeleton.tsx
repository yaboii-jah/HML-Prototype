import { DocumentSkeleton, LoadingRegion, Skeleton, SkeletonRows } from "./Skeleton";

export type PageSkeletonVariant = "summary" | "register" | "detail" | "form" | "quotation";

export function skeletonVariant(pathname: string): PageSkeletonVariant {
  const parts = pathname.split("/").filter(Boolean);
  if (["dashboard", "reports"].includes(parts[0])) return "summary";
  if (parts.at(-1) === "quotes") return "quotation";
  if (["new", "edit", "maintenance"].includes(parts.at(-1) || "")) return "form";
  return parts.length > 1 ? "detail" : "register";
}

function Panel({ form = false }: { form?: boolean }) {
  return <div className="panel skeleton-panel"><Skeleton width="35%" height={22}/>{form ? <div className="skeleton-fields">{Array.from({ length: 6 }, (_, index) => <div key={index}><Skeleton width="45%"/><Skeleton height={42}/></div>)}</div> : <SkeletonRows rows={5} columns={2}/>}</div>;
}

export function PageSkeleton({ variant = "register" }: { variant?: PageSkeletonVariant }) {
  return <LoadingRegion label="Loading page…" className="page-skeleton">
    <div className="loading-visual" data-skeleton-variant={variant} aria-hidden="true">
      <div className="skeleton-page-heading"><div><Skeleton width={120}/><Skeleton width="min(360px, 80vw)" height={32}/><Skeleton width="min(480px, 85vw)"/></div><Skeleton width={130} height={40}/></div>
      {(variant === "summary" || variant === "detail") && <div className="skeleton-metrics">{Array.from({ length: 4 }, (_, index) => <div className="panel" key={index}><Skeleton width="65%"/><Skeleton width="80%" height={28}/></div>)}</div>}
      {variant === "form" ? <div className="skeleton-form"><div className="panel skeleton-tabs"><Skeleton/><Skeleton/><Skeleton/></div><Panel form/></div> : variant === "detail" ? <div className="skeleton-detail"><Panel/><div className="panel"><DocumentSkeleton/></div></div> : variant === "summary" ? <><div className="skeleton-detail"><Panel/><Panel/></div><div className="panel"><SkeletonRows/></div></> : <div className="panel skeleton-register"><div className="skeleton-tabs"><Skeleton width="45%" height={40}/><Skeleton width="20%" height={40}/><Skeleton width="20%" height={40}/></div>{variant === "quotation" && <div className="skeleton-tabs"><Skeleton/><Skeleton/><Skeleton/></div>}<SkeletonRows rows={8} columns={variant === "quotation" ? 6 : 4}/><Skeleton width={160}/></div>}
    </div>
  </LoadingRegion>;
}

export function WorkspaceSkeleton({ variant = "register" }: { variant?: PageSkeletonVariant }) {
  return <div className="app-frame skeleton-workspace"><aside className="side-nav" aria-hidden="true"><div className="loading-visual skeleton-nav"><Skeleton width={185} height={45}/><Skeleton width={120} height={22}/>{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} height={38}/>)}</div></aside><div className="workspace"><div className="masthead" aria-hidden="true"><div className="loading-visual skeleton-masthead"><Skeleton width={180}/><Skeleton width={120} height={36}/></div></div><main className="workspace-content"><PageSkeleton variant={variant}/></main></div></div>;
}

export function SignInSkeleton() {
  return <LoadingRegion label="Preparing sign-in…" className="signin-page skeleton-signin"><div className="signin-intro" aria-hidden="true"><div className="loading-visual"><Skeleton width={190} height={45}/><div className="skeleton-signin-story"><Skeleton width="80%" height={40}/><Skeleton width="60%" height={40}/><Skeleton/><Skeleton width="70%"/></div></div></div><div className="skeleton-signin-form" aria-hidden="true"><div className="loading-visual"><Skeleton width="60%" height={32}/><Skeleton width="85%"/>{Array.from({ length: 2 }, (_, index) => <div className="skeleton-field" key={index}><Skeleton width="25%"/><Skeleton height={48}/></div>)}<Skeleton height={48}/></div></div></LoadingRegion>;
}
