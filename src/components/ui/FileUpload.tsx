"use client";

import { useId, useRef, useState } from "react";

/** Accessible chooser/drop area. Validation and archival stay with the owning workflow. */
export function FileUpload({ label, hint, accept, multiple = true, disabled = false, busy = false, onFiles }: {
  label: string; hint: string; accept: string; multiple?: boolean; disabled?: boolean; busy?: boolean; onFiles: (files: File[]) => void;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const locked = disabled || busy;
  const choose = (files: File[]) => { if (!locked && files.length) onFiles(files); };
  return <div className={`qa-file-upload${dragging ? " is-dragging" : ""}`} aria-busy={busy} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); choose(Array.from(event.dataTransfer.files)); }}>
    <div className="qa-file-upload-copy"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H5v20h14V7zM14 2v5h5M12 17V10m-3 3 3-3 3 3"/></svg><div><strong id={`${id}-label`}>{label}</strong><p id={`${id}-hint`}>{hint}</p>{busy && <span className="qa-upload-status" role="status"><span className="qa-spinner" aria-hidden="true"/> Attaching and archiving files…</span>}</div></div>
    <button className="button secondary" type="button" disabled={locked} aria-describedby={`${id}-hint`} onClick={() => input.current?.click()}>Choose files</button>
    <input ref={input} className="reference-file-input" type="file" accept={accept} multiple={multiple} disabled={locked} aria-label={label} aria-describedby={`${id}-hint`} onChange={event => { choose(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ""; }}/>
  </div>;
}
