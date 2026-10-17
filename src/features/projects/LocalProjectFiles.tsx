"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { localArchiveFiles } from "@/src/domain/local-files";
import { localArchiveUrl } from "@/src/domain/archive-destination";
import { Register } from "@/src/components/ui/Register";
import { projectDocumentType } from "./document-type";
export function LocalProjectFiles({ siteId }: { siteId: string }) {
  const { snapshot, access } = useDemo(), [search, setSearch] = useState("");
  if (!snapshot || access.sitePersonnel || !access.canReadProject(siteId)) return null;
  const projectFiles = localArchiveFiles(snapshot).filter(file => file.projectId === siteId);
  const files = projectFiles.filter(file => file.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel project-documents"><h2>Project documents</h2><p className="helper-note">Archive copies stored in this browser.</p>
    <Register embedded rows={files} unit="documents" resetKey={siteId + search}
      filters={<input type="search" aria-label="Search project documents" placeholder="Search project file names" value={search} onChange={event => setSearch(event.target.value)}/>}
      empty={projectFiles.length ? "No documents match this search." : "Project documents appear here after archiving."}
      headers={<><th scope="col">Document name</th><th scope="col">File type</th><th scope="col">Action</th></>}
      renderRow={file => <tr key={file.id}><td><Link className="table-primary" href={localArchiveUrl(file.id)}>{file.name}</Link></td><td>{projectDocumentType(file.name)}</td><td className="register-actions"><Link className="text-link" href={localArchiveUrl(file.id)}>Open</Link></td></tr>}/>
  </section>;
}
