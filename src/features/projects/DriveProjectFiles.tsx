"use client";

import { useCallback, useEffect, useState } from "react";
import { InlineError } from "@/src/components/ui/Primitives";

type FileEntry = { id: string; name: string; mimeType: string; webViewLink?: string };
type Page = { files: FileEntry[]; nextPageToken?: string; truncated?: boolean; error?: string };
const FOLDER = "application/vnd.google-apps.folder";

export function DriveProjectFiles({ projectFolderId }: { projectFolderId: string }) {
  const [path, setPath] = useState([{ id: projectFolderId, name: "Project folder" }]);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [nextPage, setNextPage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const folder = path.at(-1)!;

  const load = useCallback(async (token = "", append = false, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ projectFolderId, folderId: folder.id });
      if (query.trim()) params.set("q", query.trim());
      if (token) params.set("pageToken", token);
      const response = await fetch(`/api/drive/files?${params}`, { signal });
      const result = await response.json() as Page;
      if (!response.ok) throw new Error(result.error || "Project files could not be loaded.");
      setFiles(current => append ? [...current, ...result.files] : result.files);
      setNextPage(result.nextPageToken || "");
      setTruncated(!!result.truncated);
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Project files could not be loaded."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [projectFolderId, folder.id, query]);

  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load("", false, controller.signal); }); return () => controller.abort(); }, [load]);

  return <section className="panel drive-project-files"><div className="panel-heading"><div><h2>Google Drive documents</h2><p className="helper-note">Browse the mapped project folder or search file and folder names beneath it.</p></div><a className="text-link" href={`https://drive.google.com/drive/folders/${projectFolderId}`} target="_blank" rel="noreferrer">Open in Drive ↗</a></div>
    <div className="drive-file-toolbar"><input type="search" aria-label="Search project Drive documents" placeholder="Search project file names" value={query} onChange={event => setQuery(event.target.value)}/>{!query && path.length > 1 && <button className="button secondary" onClick={() => setPath(current => current.slice(0, -1))}>← Back</button>}</div>
    {!query && <p className="drive-breadcrumb">{path.map((part, index) => <span key={part.id}>{index > 0 && " / "}{part.name}</span>)}</p>}
    {loading && !files.length && <p className="helper-note">Loading project files…</p>}
    <InlineError message={error}/>
    <div className="drive-file-list">{files.map(file => file.mimeType === FOLDER ? <button type="button" className="data-link" key={file.id} onClick={() => { setPath(current => [...current, { id: file.id, name: file.name }]); setQuery(""); }}><div><strong>▣ {file.name}</strong><small>Folder</small></div><span>Open →</span></button> : <a className="data-link" key={file.id} href={file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`} target="_blank" rel="noreferrer"><div><strong>{file.name}</strong><small>File</small></div><span>↗</span></a>)}</div>
    {!loading && !error && !files.length && <p className="muted">No files found here.</p>}
    {nextPage && !query && <button className="button secondary" disabled={loading} onClick={() => void load(nextPage, true)}>Load more files</button>}
    {truncated && <p className="helper-note">Showing the first matching files. Narrow your search to find more.</p>}
  </section>;
}
