"use client";

import { useId, useRef, useState } from "react";

export type QuotationUploadGroup = { id: string; files: File[]; status: "ready" | "processing" | "failed" | "completed"; error?: string };
type Props = {
  groups: QuotationUploadGroup[]; locked: boolean; extracting: boolean;
  onAdd: () => string; onFiles: (group: QuotationUploadGroup, files: File[]) => void;
  onOrder: (group: QuotationUploadGroup, files: File[]) => void;
  onRemove: (group: QuotationUploadGroup, position: number) => Promise<void>;
  onRemoveFile: (group: QuotationUploadGroup, position: number) => Promise<void>;
  onManual: (group?: QuotationUploadGroup) => Promise<void>; onExtract: () => Promise<void>;
};
const statusFor = (group: QuotationUploadGroup) => !group.files.length && group.status === "ready" ? "empty" : group.status;
const statusLabels: Record<string, string> = { empty: "Needs files", ready: "Ready", processing: "Extracting", failed: "Failed", completed: "Draft created" };
const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
function Status({ group }: { group: QuotationUploadGroup }) {
  const status = statusFor(group);
  return <span className={`badge ${status === "failed" ? "bad" : status === "completed" ? "good" : status === "empty" ? "warn" : ""}`}>{statusLabels[status]}</span>;
}
function Arrow({ down = false, horizontal = false }: { down?: boolean; horizontal?: boolean }) {
  const path = horizontal ? down ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6" : down ? "M12 4v16m-6-6 6 6 6-6" : "M12 20V4m-6 6 6-6 6 6";
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}

export function SupplierQuotationUploads({ groups, locked, extracting, onAdd, onFiles, onOrder, onRemove, onRemoveFile, onManual, onExtract }: Props) {
  const detailId = useId();
  const [selectedId, setSelectedId] = useState(""), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [detailsOpen, setDetailsOpen] = useState(false), [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const filtered = groups.map((group, position) => ({ group, position })).filter(({ group, position }) => (!query || `supplier quotation ${position + 1} ${group.files.map(file => file.name).join(" ")}`.toLowerCase().includes(query)) && (filter === "all" || statusFor(group) === filter));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages), start = (currentPage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  const active = rows.find(row => row.group.id === selectedId) || rows[0];
  const eligible = groups.filter(group => group.files.length && ["ready", "failed"].includes(group.status)).length;
  const ready = groups.filter(group => group.files.length && group.status === "ready").length, failed = groups.filter(group => group.status === "failed").length;
  const select = (id: string) => {
    setSelectedId(id); setDetailsOpen(true); dragDepth.current = 0; setDragActive(false);
    requestAnimationFrame(() => { if (window.matchMedia("(max-width:1000px)").matches) detailHeading.current?.focus({ preventScroll: true }); });
  };
  const add = () => {
    const id = onAdd(); if (!id) return;
    setSearch(""); setFilter("all"); setPage(Math.floor(groups.length / pageSize) + 1); select(id);
  };
  const changeFilter = (value: string) => { setFilter(value); setPage(1); setSelectedId(""); setDetailsOpen(false); };
  const movePage = (value: number) => { setPage(value); setSelectedId(""); setDetailsOpen(false); };
  return <section className="panel supplier-upload-section">
    <div className="panel-heading"><div><h2>Add supplier quotations</h2><p className="helper-note">Keep each supplier’s files together. Select a group to add and arrange its pages.</p></div><div className="button-row"><button type="button" className="button secondary" disabled={locked} onClick={add}>+ Supplier quotation group</button><button type="button" className="button secondary" disabled={locked} onClick={() => void onManual()}>Enter manually</button></div></div>
    <div className={`supplier-upload-workbench${detailsOpen && active ? " is-detail-open" : ""}`}>
      <div className="supplier-upload-queue">
        <div className="supplier-queue-tools"><input ref={searchInput} type="search" aria-label="Search supplier quotation groups" placeholder="Search groups or filenames" value={search} disabled={locked} onChange={event => { setSearch(event.target.value); setPage(1); setSelectedId(""); setDetailsOpen(false); }}/><select aria-label="Filter upload group status" value={filter} disabled={locked} onChange={event => changeFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <ul className="supplier-queue-list" aria-label="Supplier quotation groups">{rows.map(({ group, position }) => <li key={group.id}><button type="button" className="supplier-queue-row" aria-pressed={active?.group.id === group.id} aria-controls={detailId} disabled={locked} onClick={() => select(group.id)}><span className="supplier-queue-number">{position + 1}</span><span className="supplier-queue-name"><strong>Supplier quotation {position + 1}</strong><small title={group.files.map(file => file.name).join(", ")}>{group.files.length} {group.files.length === 1 ? "file" : "files"}{group.files[0] ? ` · ${group.files[0].name}` : ""}</small></span><Status group={group}/></button></li>)}{!rows.length && <li className="supplier-queue-empty">{groups.length ? "No groups match your filters." : "Add a supplier group to get started."}</li>}</ul>
        <div className="supplier-queue-pagination"><label>Per page <select aria-label="Supplier groups per page" value={pageSize} disabled={locked} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setSelectedId(""); setDetailsOpen(false); }}><option value="10">10</option><option value="25">25</option></select></label><span>{filtered.length ? start + 1 : 0}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}</span><div><button type="button" aria-label="Previous supplier groups" disabled={locked || currentPage === 1} onClick={() => movePage(currentPage - 1)}><Arrow horizontal/></button><button type="button" aria-label="Next supplier groups" disabled={locked || currentPage === pages} onClick={() => movePage(currentPage + 1)}><Arrow horizontal down/></button></div></div>
      </div>
      <div id={detailId} className="supplier-upload-detail">
        <button type="button" className="text-link supplier-upload-back" disabled={locked} onClick={() => { setDetailsOpen(false); requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true })); }}>← Back to suppliers</button>
        {active ? (() => {
          const { group, position } = active, editable = !locked && ["ready", "failed"].includes(group.status);
          return <article className={`quote-upload-group status-${group.status}${dragActive ? " is-dragging" : ""}`}>
            <div className="quote-group-header"><div className="quote-group-heading"><div><h3 ref={detailHeading} tabIndex={-1}>Supplier quotation {position + 1}</h3><small>{group.files.length} {group.files.length === 1 ? "file" : "files"} · {sizeText(group.files.reduce((total, file) => total + file.size, 0))}</small></div></div><div className="quote-group-actions"><Status group={group}/><button type="button" className="text-link" disabled={locked || group.status === "processing"} onClick={() => void onRemove(group, position)}>Remove group</button></div></div>
            {["ready", "failed"].includes(group.status) && <div className="quote-group-drop" onDragEnter={event => { event.preventDefault(); if (!editable) return; dragDepth.current++; setDragActive(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragActive(false); if (editable) onFiles(group, Array.from(event.dataTransfer.files)); }}><span>Drop PDF or image files here<small>Up to 12 files · 20 MB each · 45 MB total</small></span><label className={`button secondary file-button${!editable ? " is-disabled" : ""}`}>Choose files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={!editable} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (editable) onFiles(group, files); }}/></label></div>}
            {group.error && <p className="field-error" role="alert">{group.error}</p>}
            {group.status === "processing" && <p className="helper-note" role="status">AI is reading this supplier’s files…</p>}
            {group.status === "completed" && <p className="helper-note">Draft created. Continue reviewing it in the quotation review queue below.</p>}
            <ol className="quote-file-order supplier-upload-files" hidden={!group.files.length}>{group.files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span className="supplier-upload-file-icon" aria-hidden="true">{file.type === "application/pdf" ? "PDF" : "IMG"}</span><span className="supplier-upload-file-name"><strong title={file.name}>{index + 1}. {file.name}</strong><small>{sizeText(file.size)}</small></span>{editable && <span className="button-row"><button type="button" className="supplier-file-move" aria-label={`Move ${file.name} earlier`} disabled={index === 0} onClick={() => onOrder(group, group.files.map((value, order) => order === index - 1 ? file : order === index ? group.files[index - 1] : value))}><Arrow/></button><button type="button" className="supplier-file-move" aria-label={`Move ${file.name} later`} disabled={index === group.files.length - 1} onClick={() => onOrder(group, group.files.map((value, order) => order === index + 1 ? file : order === index ? group.files[index + 1] : value))}><Arrow down/></button><button type="button" className="text-link" aria-label={`Remove ${file.name}`} onClick={() => void onRemoveFile(group, index)}>Delete</button></span>}</li>)}</ol>
            {!group.files.length && <div className="supplier-upload-file-empty"><p className="helper-note">Add this supplier’s quotation files in page order.</p></div>}
            {group.files.length > 0 && ["ready", "failed"].includes(group.status) && <div className="supplier-upload-detail-actions"><button type="button" className="button secondary" disabled={!editable} onClick={() => void onManual(group)}>Enter manually using these files</button></div>}
          </article>;
        })() : <div className="supplier-upload-detail-empty">{groups.length ? "Select a supplier group or adjust your filters." : "Create a supplier group, then add its quotation files here."}</div>}
      </div>
    </div>
    <div className="quote-queue-footer"><div><span>{groups.length} groups · {ready} ready · {failed} failed</span><small>Extraction includes ready and failed groups across all pages and filters.</small></div><button type="button" className="button primary" disabled={locked || !eligible} onClick={() => void onExtract()}>{extracting ? "Extracting quotations…" : `Extract all ready groups (${eligible})`}</button></div>
  </section>;
}
