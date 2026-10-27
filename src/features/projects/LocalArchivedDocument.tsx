"use client";
import { useEffect, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { localArchiveFiles } from "@/src/domain/local-files";
import { readQuoteFile } from "@/src/documents/files";
import { PdfDocumentViewer } from "@/src/components/PdfDocumentViewer";
import { PageHeader } from "@/src/components/ui/Primitives";
import { DocumentLoading } from "@/src/components/ui/Skeleton";
import { LoadingImage } from "@/src/components/ui/LoadingImage";

export function LocalArchivedDocument({ fileId }: { fileId: string }) {
  const { snapshot, access } = useDemo();
  const file = snapshot && localArchiveFiles(snapshot).find(file => file.id === fileId && (!access.sitePersonnel || !file.purchasingOnly) && access.canReadRecord(file.ownerId));
  const [loaded, setLoaded] = useState<{ id: string; blob?: Blob; url?: string; error?: string }>();
  const permitted = !!file;
  useEffect(() => {
    if (!permitted) return;
    let disposed = false, url = "";
    void readQuoteFile(fileId).then(blob => {
      if (disposed) return;
      if (!blob) { setLoaded({ id: fileId, error: "The local copy is unavailable. Return to its record and retry archiving, or attach the original document again." }); return; }
      url = URL.createObjectURL(blob); setLoaded({ id: fileId, blob, url });
    }).catch(() => { if (!disposed) setLoaded({ id: fileId, error: "This browser could not read the local document." }); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [fileId, permitted]);
  if (!file) return <PageHeader title="Document unavailable" description="This file is not linked to a record you can access in the current workspace."/>;
  const current = loaded?.id === fileId ? loaded : undefined;
  return <><PageHeader title={file.name} description="Archived in this browser." actions={current?.url && <a className="button secondary" href={current.url} download={file.name}>Download</a>}/>{!current ? <DocumentLoading/> : current.error ? <p className="inline-error" role="alert">{current.error}</p> : current.blob?.type === "application/pdf" ? <div style={{ height: "75dvh", display: "flex" }}><PdfDocumentViewer blob={current.blob} fileName={file.name} sourceUrl={current.url!}/></div> : current.blob?.type.startsWith("image/") ? <div className="document-gallery-image-viewer"><LoadingImage src={current.url!} alt={file.name}/></div> : <p>Use Download to open this document.</p>}</>;
}
