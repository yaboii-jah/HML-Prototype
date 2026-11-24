export function ProjectDriveLink({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const label = projectName ? `Open ${projectName} in Google Drive` : "Open in Google Drive";
  return (
    <a
      className="text-link"
      href={`/api/projects/${encodeURIComponent(projectId)}/drive-folder`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
    >
      Open in Google Drive{" "}
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.35">
        <path d="M4.5 2H2v8h8V7.5M6.5 2H10v3.5M10 2 5.2 6.8" />
      </svg>
    </a>
  );
}
