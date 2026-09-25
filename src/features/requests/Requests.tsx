"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Documents, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { earliestNeededDate, posForRequest, poTotal, siteName, stockFor, supplierName } from "@/src/domain/selectors";
import type { DemoSnapshot, DocumentRef, Item } from "@/src/domain/types";

const MAX_REFERENCE_SIZE = 25 * 1024 * 1024;
const REFERENCE_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
};
const REFERENCE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const MATERIAL_COPY_FIELDS = [
  { key: "unit", label: "Unit" },
  { key: "neededDate", label: "Date needed" },
  { key: "purpose", label: "Purpose" },
  { key: "location", label: "Delivery location" },
  { key: "remarks", label: "Remarks" },
] as const;
type MaterialCopyField = (typeof MATERIAL_COPY_FIELDS)[number]["key"];

function referenceType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const acceptedMimes = REFERENCE_TYPES[extension];
  return acceptedMimes && (!file.type || acceptedMimes.includes(file.type.toLowerCase()))
    ? file.type || acceptedMimes[0]
    : "";
}

function referenceLabel(document: DocumentRef) {
  const extension = document.name.split(".").pop()?.toUpperCase();
  if (["PDF", "JPG", "JPEG", "PNG", "WEBP"].includes(extension || "")) return `${extension} file`;
  return document.type || "Document reference";
}

export function Requests() {
  const { snapshot: state } = useDemo();
  const [search,setSearch]=useState(""), [status,setStatus]=useState("all"), [category,setCategory]=useState("all"), [neededBy,setNeededBy]=useState(""), [sort,setSort]=useState("recent");
  if(!state)return null;
  const rows=state.requests.filter(r=>(state.siteFilter==="all"||r.siteId===state.siteFilter)&&`${r.ref} ${r.category} ${r.items.map(i=>i.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())&&(status==="all"||r.status===status)&&(category==="all"||r.category===category)&&(!neededBy||r.items.some(item=>item.neededDate && item.neededDate<=neededBy))).sort((a,b)=>sort==="needed"?(earliestNeededDate(a)||"9999").localeCompare(earliestNeededDate(b)||"9999"):b.updatedAt.localeCompare(a.updatedAt));
  return <><PageHeader eyebrow="MATERIAL REQUEST REGISTER" title="Material requests" description="Requirements, PM decisions, quotations, and linked purchases." actions={state.role==="Site Personnel"?<Link className="button primary" href="/requests/new">+ New MRF</Link>:undefined}/><div className="toolbar"><input aria-label="Search requests" placeholder="Search MRF or material" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Request status" value={status} onChange={e=>setStatus(e.target.value)}>{["all","draft","submitted","returned","approved","rejected"].map(s=><option key={s} value={s}>{s==="all"?"All statuses":s}</option>)}</select><select aria-label="Request category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{state.categories.map(c=><option key={c}>{c}</option>)}</select><input aria-label="Needed by date" type="date" value={neededBy} onChange={e=>setNeededBy(e.target.value)}/><select aria-label="Sort requests" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently updated</option><option value="needed">Needed soonest</option></select></div><div className="table-frame"><table><thead><tr><th>MRF / material</th><th>Project</th><th>Earliest needed</th><th>Category</th><th>Status</th><th>Updated</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link className="table-primary" href={`/requests/${r.id}`}>{r.ref}</Link><small>{r.items.map(i=>`${i.quantity} ${i.unit} ${i.name}`).join(", ")}</small></td><td>{siteName(state,r.siteId)}</td><td>{earliestNeededDate(r)?dateText(earliestNeededDate(r)):"—"}</td><td>{r.category}</td><td><Badge value={r.status}/></td><td>{dateText(r.updatedAt)}</td></tr>)}</tbody></table>{!rows.length&&<Empty detail="Try a different search, filter, or site."/>}</div></>;
}

export function RequestForm({ id }: { id?: string }) {
  const { snapshot: state, run } = useDemo();
  const router = useRouter();
  const original = state?.requests.find(request => request.id === id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>(() => original?.items.map(item => ({ ...item })) || [{ id: newId("item"), name: "", unit: "bag", quantity: 1, neededDate: new Date().toISOString().slice(0, 10), purpose: "", location: "", remarks: "" }]);
  const [documentState, setDocumentState] = useState<{ id?: string; touched: boolean; documents: DocumentRef[] }>(() => ({ id, touched: false, documents: [] }));
  const documents = documentState.id === id && documentState.touched ? documentState.documents : original?.documents || [];
  const [error, setError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [copyFields, setCopyFields] = useState<Record<MaterialCopyField, boolean>>({ unit: false, neededDate: false, purpose: false, location: false, remarks: false });
  const [copySourceId, setCopySourceId] = useState("");
  const selectedCopySourceId = items.some(item => item.id === copySourceId) ? copySourceId : items[items.length - 1]?.id || "";
  const [expandedItemId, setExpandedItemId] = useState<string | null>(() => original?.items[0]?.id || items[0]?.id || null);
  const [materialSearch, setMaterialSearch] = useState("");
  const [invalidItemId, setInvalidItemId] = useState<string | null>(null);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const copySourceRef = useRef<HTMLSelectElement>(null);
  const addItem = () => {
    const previous = items[items.length - 1];
    const source = items.find(item => item.id === selectedCopySourceId) || previous;
    const today = new Date().toISOString().slice(0, 10);
    const added = {
      id: newId("item"), name: "", unit: copyFields.unit && source ? source.unit : "piece", quantity: 1,
      neededDate: copyFields.neededDate && source ? source.neededDate : today,
      purpose: copyFields.purpose && source ? source.purpose : "",
      location: copyFields.location && source ? source.location : "",
      remarks: copyFields.remarks && source ? source.remarks : "",
    };
    setItems(current => [...current, added]);
    setInvalidItemId(null);
    setError("");
    setExpandedItemId(added.id);
    setMaterialSearch("");
    addDialogRef.current?.close();
    window.requestAnimationFrame(() => {
      const card = document.getElementById("material-card-" + added.id);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("material-" + added.id)?.focus({ preventScroll: true });
    });
  };
  const openAddItemDialog = () => {
    if (!addDialogRef.current?.open) addDialogRef.current?.showModal();
    window.requestAnimationFrame(() => copySourceRef.current?.focus());
  };
  const removeItem = (itemId: string) => {
    if (items.length <= 1) return;
    const index = items.findIndex(item => item.id === itemId);
    const remaining = items.filter(item => item.id !== itemId);
    setItems(remaining);
    if (expandedItemId === itemId) setExpandedItemId(remaining[Math.min(index, remaining.length - 1)]?.id || null);
    if (invalidItemId === itemId) { setInvalidItemId(null); setError(""); }
  };
  const revealItem = (item: Item, fieldId: string) => {
    setMaterialSearch("");
    setExpandedItemId(item.id);
    window.requestAnimationFrame(() => {
      const card = document.getElementById("material-card-" + item.id);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(fieldId)?.focus({ preventScroll: true });
    });
  };
  const updateItem = (itemId: string, patch: Partial<Item>) => {
    const currentItem = items.find(item => item.id === itemId);
    const updatedItem = currentItem ? { ...currentItem, ...patch } : null;
    setItems(current => current.map(item => item.id === itemId ? { ...item, ...patch } : item));
    if (invalidItemId === itemId && updatedItem && updatedItem.name.trim() && updatedItem.unit.trim() && Number.isFinite(updatedItem.quantity) && updatedItem.quantity > 0 && updatedItem.neededDate.trim() && updatedItem.purpose.trim() && updatedItem.location.trim()) { setInvalidItemId(null); setError(""); }
  };

  const normalizedMaterialSearch = materialSearch.trim().toLowerCase();
  const matchesMaterialSearch = (item: Item, query: string) => !query || [item.name, item.purpose, item.location, item.remarks].some(value => value.toLowerCase().includes(query));
  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => matchesMaterialSearch(item, normalizedMaterialSearch));

  const updateDocuments = (update: (current: DocumentRef[]) => DocumentRef[]) => setDocumentState(current => {
    const currentDocuments = current.id === id && current.touched ? current.documents : original?.documents || [];
    return { id, touched: true, documents: update(currentDocuments) };
  });

  if (!state) return null;
  if (id && !original) return <MissingRecord name="MRF" listHref="/requests"/>;

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const nextDocuments: DocumentRef[] = [];
    const problems: string[] = [];
    Array.from(files).forEach(file => {
      if (file.size > MAX_REFERENCE_SIZE) {
        problems.push(`${file.name} is larger than 25 MB.`);
        return;
      }
      const type = referenceType(file);
      if (!type) {
        problems.push(`${file.name} isn’t a supported file type. Choose a PDF, JPG, PNG, or WEBP.`);
        return;
      }
      nextDocuments.push({ name: file.name, type });
    });
    if (nextDocuments.length) updateDocuments(current => [...current, ...nextDocuments]);
    setAttachmentError(problems.join(" "));
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "draft" ? "draft" : "submit";
    if (intent === "submit" && documents.length === 0) {
      setAttachmentError("Add at least one document before submitting this MRF.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const result = await run({
      type: "saveRequest", id, intent, siteId: String(form.get("site")), category: String(form.get("category")),
      scope: String(form.get("scope")), requestedBy: String(form.get("requestedBy")), approvedBy: String(form.get("approvedBy")), purchaser: String(form.get("purchaser")), financeOfficer: String(form.get("financeOfficer")), items, documents,
    });
    if (result.ok) router.push(`/requests/${result.recordId}`);
    else {
      setError(result.message);
      if (result.field === "items") {
        const invalid = items.find(item => !item.name.trim() || !item.unit.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !item.neededDate.trim() || !item.purpose.trim() || !item.location.trim());
        if (invalid) {
          setInvalidItemId(invalid.id);
          const fieldId = !invalid.name.trim() ? "material-" + invalid.id : !invalid.unit.trim() ? "unit-" + invalid.id : !Number.isFinite(invalid.quantity) || invalid.quantity <= 0 ? "quantity-" + invalid.id : !invalid.neededDate.trim() ? "needed-" + invalid.id : !invalid.purpose.trim() ? "purpose-" + invalid.id : "location-" + invalid.id;
          revealItem(invalid, fieldId);
        }
      }
    }
  };

  return <>
    <PageHeader eyebrow={original ? "REVISE MATERIAL REQUEST" : "NEW MATERIAL REQUEST"} title={original ? `Edit ${original.ref}` : "Create MRF"} description="Capture the work need, material quantities, and document references."/>
    <form className="form-stack" noValidate onSubmit={save}>
      <section className="panel">
        <h2 className="panel-title">General information</h2>
        <div className="form-grid">
          <Field label="Project / site"><select name="site" defaultValue={original?.siteId || (state.siteFilter !== "all" ? state.siteFilter : state.sites[0].id)}>{state.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
          <Field label="Category"><select name="category" defaultValue={original?.category || state.categories[0]}>{state.categories.map(category => <option key={category}>{category}</option>)}</select></Field>
          <Field label="Work package / scope"><input name="scope" defaultValue={original?.scope || ""}/></Field>
          <Field label="Requested by"><input name="requestedBy" defaultValue={original?.requestedBy || ""}/></Field>
          <Field label="Approved by"><input name="approvedBy" defaultValue={original?.approvedBy || ""}/></Field>
          <Field label="Purchaser/Procurement Officer"><input name="purchaser" defaultValue={original?.purchaser || ""}/></Field>
          <Field label="Finance Officer"><input name="financeOfficer" defaultValue={original?.financeOfficer || ""}/></Field>
        </div>
      </section>
      <section className="panel materials-panel" aria-label="Materials">
        <div className="materials-toolbar">
          <span className="material-count" role="status">{normalizedMaterialSearch ? 'Showing ' + visibleItems.length + ' of ' + items.length : items.length + (items.length === 1 ? ' material' : ' materials')}</span>
          <input type="search" aria-label="Search materials by name or details" placeholder="Search name, purpose, location, or remarks" value={materialSearch} onChange={event => { const value = event.target.value; const query = value.trim().toLowerCase(); setMaterialSearch(value); const active = items.find(item => item.id === expandedItemId); if (!active || !matchesMaterialSearch(active, query)) setExpandedItemId(items.find(item => matchesMaterialSearch(item, query))?.id || null); }} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}/>
          <button type="button" className="button primary" onClick={openAddItemDialog}>+ Add material</button>
        </div>
        <dialog ref={addDialogRef} className="material-add-dialog" aria-labelledby="material-add-title">
          <div className="material-dialog-heading"><div><span className="eyebrow">MATERIALS</span><h2 id="material-add-title">Add material</h2></div><button type="button" className="icon-button" aria-label="Close add material dialog" onClick={() => addDialogRef.current?.close()}>×</button></div>
          <p className="material-dialog-note">Choose a source and the fields to copy. You can edit the new material afterward.</p>
          <div className="material-add-source"><Field label="Copy from"><select ref={copySourceRef} aria-label="Copy from material" value={selectedCopySourceId} onChange={event => setCopySourceId(event.target.value)}>{items.map((source, sourceIndex) => <option key={source.id} value={source.id}>{'Material ' + (sourceIndex + 1) + ' — ' + (source.name.trim() || 'Unnamed material')}</option>)}</select></Field></div>
          <fieldset className="material-copy-options">
            <legend>Copy selected fields</legend>
            {MATERIAL_COPY_FIELDS.map(field => <label key={field.key}><input type="checkbox" aria-label={'Copy ' + field.label.toLowerCase() + ' from selected material'} checked={copyFields[field.key]} onChange={() => setCopyFields(current => ({ ...current, [field.key]: !current[field.key] }))}/><span>{field.label}</span></label>)}
          </fieldset>
          <div className="material-add-actions"><button type="button" className="button secondary" onClick={() => addDialogRef.current?.close()}>Cancel</button><button type="button" className="button primary" onClick={addItem}>Add material</button></div>
        </dialog>
        <div className="material-list">
          {visibleItems.length ? visibleItems.map(({ item, index }) => {
            const isExpanded = expandedItemId === item.id;
            return <article className="material-card" id={'material-card-' + item.id} key={item.id}>
              <div className="material-summary-row">
                <h3 className="material-summary-heading"><button type="button" className="material-summary-trigger" aria-expanded={isExpanded} aria-controls={'material-fields-' + item.id} onClick={() => setExpandedItemId(current => current === item.id ? null : item.id)}>
                  <span className="material-summary-index">Material {index + 1}</span>
                  <span className="material-summary-copy"><strong>{item.name.trim() || 'Unnamed material'}</strong><span>{item.quantity} {item.unit} · Needed {item.neededDate ? dateText(item.neededDate) : 'date not set'}</span></span>
                  <span className="material-summary-indicator" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                </button></h3>
                <button type="button" className="icon-button material-remove" aria-label={'Remove material ' + (index + 1)} disabled={items.length === 1} onClick={() => removeItem(item.id)}>×</button>
              </div>
              <div className="material-card-fields" id={'material-fields-' + item.id} hidden={!isExpanded}>
                <div className="material-card-grid">
                  <Field label="Material"><input id={'material-' + item.id} name={'material-' + item.id} value={item.name} onChange={event => updateItem(item.id, { name: event.target.value })}/></Field>
                  <Field label="Unit"><input id={'unit-' + item.id} name={'unit-' + item.id} value={item.unit} onChange={event => updateItem(item.id, { unit: event.target.value })}/></Field>
                  <Field label="Quantity"><input id={'quantity-' + item.id} name={'quantity-' + item.id} type="number" step="any" value={item.quantity} onChange={event => updateItem(item.id, { quantity: Number(event.target.value) })}/></Field>
                  <Field label="Date needed"><input id={'needed-' + item.id} name={'needed-' + item.id} type="date" value={item.neededDate} onChange={event => updateItem(item.id, { neededDate: event.target.value })}/></Field>
                  <Field label="Purpose"><input id={'purpose-' + item.id} name={'purpose-' + item.id} value={item.purpose} onChange={event => updateItem(item.id, { purpose: event.target.value })}/></Field>
                  <Field label="Delivery location"><input id={'location-' + item.id} name={'location-' + item.id} value={item.location} onChange={event => updateItem(item.id, { location: event.target.value })}/></Field>
                  <div className="material-card-wide"><Field label="Remarks"><textarea id={'remarks-' + item.id} name={'remarks-' + item.id} value={item.remarks} onChange={event => updateItem(item.id, { remarks: event.target.value })}/></Field></div>
                </div>
                <InlineError message={invalidItemId === item.id ? error : ''}/>
              </div>
            </article>;
          }) : <div className="material-search-empty"><strong>No materials match “{materialSearch}”.</strong><button type="button" className="text-link" onClick={() => setMaterialSearch("")}>Clear search</button></div>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2 id="references-heading">Document references</h2><span className="reference-count">{documents.length} attached</span></div>
        <p className="reference-note">File contents aren’t retained; only attachment details are saved.</p>
        <div className={`reference-dropzone${dragActive ? " is-active" : ""}`} onDragEnter={event => { event.preventDefault(); setDragActive(true); }} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={event => { event.preventDefault(); setDragActive(false); }} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}>
          <input ref={inputRef} className="reference-file-input" type="file" accept={REFERENCE_ACCEPT} multiple aria-label="Choose document references" onChange={onPickFiles}/>
          <svg className="reference-upload-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M11 4h17l9 9v18H11z"/><path d="M28 4v9h9"/><circle cx="33" cy="35" r="10"/><path d="M33 39v-9m-4 4 4-4 4 4"/></svg>
          <p>Drag and drop files here or <button type="button" className="reference-choose" onClick={() => inputRef.current?.click()}>Choose files</button></p>
          <small>PDF, JPG, PNG, or WEBP · Up to 25 MB per file</small>
        </div>
        <InlineError message={attachmentError}/>
        {documents.length > 0 && <div className="reference-file-list" aria-label="Attached document references">
          {documents.map((document, index) => <div className="reference-file" key={`${index}-${document.name}-${document.type}`}>
            <span className="reference-file-icon" aria-hidden="true">{document.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}</span>
            <div className="reference-file-detail"><strong title={document.name}>{document.name}</strong><small>{referenceLabel(document)}</small></div>
            <button type="button" className="reference-remove" aria-label={`Remove ${document.name}`} onClick={() => { updateDocuments(current => current.filter((_, fileIndex) => fileIndex !== index)); setAttachmentError(""); }}>×</button>
          </div>)}
        </div>}
      </section>
      <InlineError message={invalidItemId ? "" : error}/>
      <div className="form-actions"><Link className="button secondary" href={original ? `/requests/${original.id}` : "/requests"}>Cancel</Link><button className="button secondary" type="submit" value="draft">Save draft</button><button className="button primary" type="submit" value="submit">{original ? "Resubmit MRF" : "Submit MRF"}</button></div>
    </form>
  </>;
}

function RequestMaterialList({ state, siteId, items }: { state: DemoSnapshot; siteId: string; items: Item[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(() => items[0]?.id ?? null);

  return <section className="panel request-materials-panel" aria-label="Materials">
    <div className="request-materials-heading">
      <h2 className="panel-title">{items.length} {items.length === 1 ? "material" : "materials"}</h2>
    </div>
    {items.length === 0 ? <Empty detail="No materials have been added to this request." /> :
      <div className="request-materials-list">{items.map((item, index) => {
        const isExpanded = expandedId === item.id;
        const detailsId = `request-material-details-${item.id}`;
        return <article className="request-material" key={item.id}>
          <h3 className="request-material-heading">
            <button type="button" className="request-material-trigger" aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => setExpandedId(current => current === item.id ? null : item.id)}>
              <span className="request-material-index">Material {index + 1}</span>
              <span className="request-material-name">{item.name || "Unnamed material"}</span>
              <span className="request-material-indicator" aria-hidden="true">{isExpanded ? "−" : "+"}</span>
            </button>
          </h3>
          <div className="request-material-body" id={detailsId} hidden={!isExpanded}>
            <div className="data-rows">
              <div><span>Requested</span><strong>{item.quantity} {item.unit}</strong></div>
              <div><span>Site stock</span><strong>{stockFor(state, siteId, item.name, item.unit)} {item.unit}</strong></div>
              <div><span>Date needed</span><strong>{item.neededDate ? dateText(item.neededDate) : "—"}</strong></div>
              <div><span>Purpose</span><strong>{item.purpose || "—"}</strong></div>
              <div><span>Delivery location</span><strong>{item.location || "—"}</strong></div>
              {item.remarks && <div><span>Remarks</span><strong>{item.remarks}</strong></div>}
            </div>
          </div>
        </article>;
      })}</div>}
  </section>;
}

export function RequestDetail({ id }: { id: string }) {
  const { snapshot: state, run }=useDemo(); const [decision,setDecision]=useState<"return"|"reject"|null>(null),[error,setError]=useState("");
  if(!state)return null; const request=state.requests.find(r=>r.id===id); if(!request)return <MissingRecord name="MRF" listHref="/requests"/>;
  const pos=posForRequest(state,request),po=pos[0];
  const decide=async(choice:"approve"|"return"|"reject",reason?:string)=>{if(choice==="reject"&&!window.confirm("Reject this MRF? The request will close."))return;const result=await run({type:"reviewRequest",id,decision:choice,reason});if(!result.ok)setError(result.message);else{setDecision(null);setError("");}};
  return <><RecordHeader backHref="/requests" backLabel="Material requests" eyebrow={`${siteName(state,request.siteId)} · ${request.category}`} title={request.ref} badges={<><Badge value={request.status}/>{po&&<Badge value={po.status}/>}</>}/>
    <div className="request-detail-layout"><div className="request-detail-overview"><section className="panel"><h2 className="panel-title">General information</h2><div className="data-rows"><div><span>Work package</span><strong>{request.scope}</strong></div><div><span>Requested by</span><strong>{request.requestedBy || "—"}</strong></div><div><span>Approved by</span><strong>{request.approvedBy || "—"}</strong></div><div><span>Purchaser/Procurement Officer</span><strong>{request.purchaser || "—"}</strong></div><div><span>Finance Officer</span><strong>{request.financeOfficer || "—"}</strong></div></div>{request.reason&&<div className="callout warn"><strong>Review reason</strong><p>{request.reason}</p></div>}</section>
    <section className="panel"><h2 className="panel-title">Documents and links</h2><Documents docs={request.documents}/><h3 className="subheading">Purchase order</h3>{pos.length ? pos.map(linked => <Link className="data-link" href={`/purchase-orders/${linked.id}`} key={linked.id}><div><strong>{linked.ref}</strong><small>{supplierName(state,linked)} · {money(poTotal(state,linked))}</small></div><Badge value={linked.status}/></Link>) : <p className="muted">No PO has been prepared.</p>}</section></div>
    <RequestMaterialList key={request.id} state={state} siteId={request.siteId} items={request.items}/>
    {state.role==="Site Personnel"&&["draft","returned"].includes(request.status)&&<section className="action-bar"><div><strong>{request.status==="returned"?"Revision requested":"Draft request"}</strong><p>Update the MRF before submitting it to the Project Manager.</p></div><Link className="button primary" href={`/requests/${id}/edit`}>Edit MRF</Link></section>}
    {state.role==="Project Manager"&&request.status==="submitted"&&<section className="panel"><div className="panel-heading"><h2>PM decision</h2><span>Site stock is shown above for context.</span></div><div className="button-row"><button className="button primary" onClick={()=>void decide("approve")}>Approve request</button><button className="button secondary" onClick={()=>setDecision("return")}>Return with reason</button><button className="button danger-outline" onClick={()=>setDecision("reject")}>Reject with reason</button></div>{decision&&<form className="decision-panel" onSubmit={e=>{e.preventDefault();void decide(decision,String(new FormData(e.currentTarget).get("reason")));}}><Field label={`${decision==="return"?"Return":"Rejection"} reason`}><textarea name="reason" required minLength={5}/></Field><InlineError message={error}/><div className="button-row"><button type="button" className="button secondary" onClick={()=>setDecision(null)}>Cancel</button><button className="button primary">Confirm {decision}</button></div></form>}</section>}
    {request.status==="approved"&&<section className="action-bar"><div><strong>Supplier comparison</strong><p>{state.quotes.filter(q=>q.mrfId===id).length} quotations on file. The lowest price is highlighted but never selected automatically.</p></div><Link className="button primary" href={`/requests/${id}/quotes`}>Compare quotations →</Link></section>}
    <Timeline state={state} ids={[id,...pos.map(linked=>linked.id)]}/></div></>;
}

export { QuotationWorkspace as QuoteComparison } from "./QuotationWorkspace";
