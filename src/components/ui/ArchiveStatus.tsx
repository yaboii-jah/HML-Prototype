"use client";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import { useDemo } from "@/src/app-state/DemoProvider";

export function ArchiveStatus() {
  const { jobs: allJobs, dismiss } = useArchive();
  const { access } = useDemo();
  const jobs = allJobs.filter(job => access.canReadTarget(job.target));
  if (!jobs.length) return null;
  const failed = jobs.filter(job => job.error).length, active = jobs.filter(job => !job.error && job.phase !== "complete").length;
  return <aside className={`archive-activity ${failed ? "has-error" : !active ? "is-complete" : ""}`} aria-label="Document archive activity">
    <div className="archive-activity-heading"><strong>Document archiving</strong><small>{active ? `${active} in progress` : failed ? `${failed} need${failed === 1 ? "s" : ""} retry` : "Complete"}</small></div>
    <div role="status" aria-live="polite">{jobs.map(job => {
    const done = job.phase === "complete", measured = !job.error && !done && job.total !== undefined && job.loaded !== undefined;
    return <div className={`archive-job ${job.error ? "has-error" : done ? "is-complete" : ""}`} key={job.id} aria-busy={!done && !job.error}>
      <span className={!done && !job.error ? "archive-spinner" : "archive-state-icon"} aria-hidden="true">{job.error ? "!" : done ? "✓" : ""}</span>
      <div><strong>{job.label}</strong><small>{job.error ? `Needs retry: ${job.error}` : done ? "Archived to Google Drive" : `${job.phase === "preparing" ? "Preparing document" : "Uploading to Google Drive"}${job.fileCount ? ` · file ${job.fileIndex || 1} of ${job.fileCount}` : ""}`}</small>{measured && <progress aria-label={`${job.label} upload progress`} max={job.total} value={job.loaded}/>}</div>
      {(done || job.error) && <button type="button" className="icon-button" aria-label={`Dismiss archive status for ${job.label}`} onClick={() => dismiss(job.id)}>×</button>}
    </div>;
  })}</div></aside>;
}
