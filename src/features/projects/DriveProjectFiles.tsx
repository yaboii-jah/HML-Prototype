"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InlineError } from "@/src/components/ui/Primitives";
import { LoadingRegion, SkeletonRows } from "@/src/components/ui/Skeleton";
import { useDemo } from "@/src/app-state/DemoProvider";

type FileEntry = { id: string; name: string; mimeType: string; webViewLink?: string };
type Page = { files: FileEntry[]; nextPageToken?: string; truncated?: boolean; error?: string };
type Listing = { key: string; files: FileEntry[]; nextPage: string; error: string; truncated: boolean };
const FOLDER = "application/vnd.google-apps.folder";

export function DriveProjectFiles({ projectFolderId }: { projectFolderId: string }) {
  const { access } = useDemo();
  if (access.sitePersonnel) return null;
  return <DriveFolderListing key={projectFolderId} projectFolderId={projectFolderId}/>;
}

function DriveFolderListing({ projectFolderId }: { projectFolderId: string }) {
  const [path, setPath] = useState([{ id: projectFolderId, name: "Project folder" }]);
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing>({ key: "", files: [], nextPage: "", error: "", truncated: false });
  const [loading, setLoading] = useState(false);
  const active = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const folder = path.at(-1)!;
  const key = JSON.stringify([projectFolderId, folder.id, query.trim()]);
  const current = listing.key === key;
  const pending = loading || !current;

  const load = useCallback(async (token = "", append = false) => {
    active.current.controller?.abort();
    const controller = new AbortController(), id = ++active.current.id;
    active.current.controller = controller;
    setLoading(true);
    setListing(value => value.key === key ? { ...value, error: "" } : value);
    try {
      const params = new URLSearchParams({ projectFolderId, folderId: folder.id });
      if (query.trim()) params.set("q", query.trim());
      if (token) params.set("pageToken", token);
      const response = await fetch(`/api/drive/files?${params}`, { signal: controller.signal });
      const result = await response.json() as Page;
      if (controller.signal.aborted || active.current.id !== id) return;
      if (!response.ok) throw new Error(result.error || "Project files could not be loaded.");
      setListing(value => ({ key, files: append && value.key === key ? [...value.files, ...result.files] : result.files, nextPage: result.nextPageToken || "", truncated: !!result.truncated, error: "" }));
    } catch (cause) {
      if (!controller.signal.aborted && active.current.id === id) setListing(value => ({ key, files: value.key === key ? value.files : [], nextPage: value.key === key ? value.nextPage : "", truncated: false, error: cause instanceof Error ? cause.message : "Project files could not be loaded." }));
    } finally { if (!controller.signal.aborted && active.current.id === id) setLoading(false); }
  }, [projectFolderId, folder.id, query, key]);

  useEffect(() => {
    let disposed = false;
    const request = active.current;
    queueMicrotask(() => { if (!disposed) void load(); });
    return () => { disposed = true; request.controller?.abort(); request.id++; };
  }, [load]);

  const files = current ? listing.files : [];
  return <section className="panel drive-project-files"><div className="panel-heading"><div><h2>Google Drive documents</h2><p className="helper-note">Browse the mapped project folder or search file and folder names beneath it.</p></div><a className="text-link" href={`https://drive.google.com/drive/folders/${projectFolderId}`} target="_blank" rel="noreferrer">Open in Drive ↗</a></div>
    <div className="drive-file-toolbar"><input type="search" aria-label="Search project Drive documents" placeholder="Search project file names" value={query} onChange={event => setQuery(event.target.value)}/>{!query && path.length > 1 && <button className="button secondary" onClick={() => setPath(current => current.slice(0, -1))}>← Back</button>}</div>
    {!query && <p className="drive-breadcrumb">{path.map((part, index) => <span key={part.id}>{index > 0 && " / "}{part.name}</span>)}</p>}
    <LoadingRegion pending={pending} label="Loading project files…">
    <InlineError message={current ? listing.error : ""}/>
    <div className="drive-file-list">{files.map(file => file.mimeType === FOLDER ? <button type="button" className="data-link" key={file.id} onClick={() => { setPath(current => [...current, { id: file.id, name: file.name }]); setQuery(""); }}><div><strong>▣ {file.name}</strong><small>Folder</small></div><span>Open →</span></button> : <a className="data-link" key={file.id} href={file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`} target="_blank" rel="noreferrer"><div><strong>{file.name}</strong><small>File</small></div><span>↗</span></a>)}</div>
    {pending && <SkeletonRows key={`${key}-${files.length}`} rows={files.length ? 2 : 5} columns={2}/>}
    {!pending && !listing.error && !files.length && <p className="muted">No files found here.</p>}
    </LoadingRegion>
    {current && listing.error && <button className="button secondary" disabled={pending} onClick={() => void load()}>Retry loading files</button>}
    {current && listing.nextPage && !query && <button className="button secondary" disabled={pending} onClick={() => void load(listing.nextPage, true)}>Load more files</button>}
    {current && listing.truncated && <p className="helper-note">Showing the first matching files. Narrow your search to find more.</p>}
  </section>;
}
