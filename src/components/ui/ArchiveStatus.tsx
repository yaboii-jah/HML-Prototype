"use client";
import { useArchive } from "@/src/app-state/ArchiveProvider";
export function ArchiveStatus() {
  const { jobs, dismiss } = useArchive();
  if (!jobs.length) return null;
  return <aside className="archive-activity" aria-label="Document archive activity"><div role="status" aria-live="polite">{jobs.map(job => {
    const done = job.phase === "complete", measured = !job.error && !done && job.total !== undefined && job.loaded !== undefined;
    return <div className={`archive-job ${job.error ? "has-error" : done ? "is-complete" : ""}`} key={job.id} aria-busy={!done && !job.error}>
      <span className={!done && !job.error ? "archive-spinner" : "archive-state-icon"} aria-hidden="true">{job.error ? "!" : done ? "✓" : ""}</span>
      <div><strong>{job.label}</strong><small>{job.error ? `Needs retry: ${job.error}` : done ? "Archived to Google Drive" : `${job.phase === "preparing" ? "Preparing document" : "Uploading to Google Drive"}${job.fileCount ? ` · file ${job.fileIndex || 1} of ${job.fileCount}` : ""}`}</small>{measured && <progress aria-label={`${job.label} upload progress`} max={job.total} value={job.loaded}/>}</div>
      {(done || job.error) && <button type="button" className="icon-button" aria-label={`Dismiss archive status for ${job.label}`} onClick={() => dismiss(job.id)}>×</button>}
    </div>;
  })}</div></aside>;
}
