"use client";
/* eslint-disable @next/next/no-img-element -- These previews use browser-local Blob URLs. */
import { useState } from "react";
import { DocumentSkeleton, LoadingRegion } from "./Skeleton";

/** Mount with key=src so switching documents cannot retain the previous load state. */
export function LoadingImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return <LoadingRegion inline pending={status === "loading"} label="Loading image…" className={`loading-image ${status === "loading" ? "is-loading" : ""}`}>
    {status === "error" ? <span role="alert">Image preview unavailable. Open the original document to view it.</span> : <img src={src} alt={alt} onLoad={() => setStatus("ready")} onError={() => setStatus("error")}/>}
    {status === "loading" && <span className="document-loading"><DocumentSkeleton/></span>}
  </LoadingRegion>;
}
