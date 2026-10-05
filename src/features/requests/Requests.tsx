"use client";

import { CollapsibleSection, revealField } from "@/src/components/ui/CollapsibleSection";
import { useArchive } from "@/src/app-state/ArchiveProvider";
import Link from "next/link";
import { poStatusLabel } from "@/src/domain/workflow";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Documents, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { earliestNeededDate, posForRequest, poTotal, siteName, stockFor, supplierName } from "@/src/domain/selectors";
import type { DemoSnapshot, DocumentRef, Item } from "@/src/domain/types";
import { DocumentPreview } from "@/src/components/DocumentPreview";
import { deleteLocalFile, saveRequestFile } from "./quote-files";
import { procurementReady } from "@/src/domain/request-archive";
import { syncApprovedRequest } from "./archive-request";
import { MrfAiImport } from "./MrfAiImport";
import { mrfImportedItems, type MrfExtractionResult } from "@/src/domain/mrf-extraction";

const MATERIAL_COPY_FIELDS = [
  { key: "unit", label: "Unit" },
  { key: "neededDate", label: "Date needed" },
  { key: "purpose", label: "Purpose" },
  { key: "location", label: "Delivery location" },
  { key: "remarks", label: "Remarks" },
] as const;
type MaterialCopyField = (typeof MATERIAL_COPY_FIELDS)[number]["key"];
const todayLocal = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const REQUEST_STEPS = ["Request details", "Materials", "Review & submit"] as const;
const REQUEST_DETAIL_FIELDS = [
  { name: "requestedBy", label: "Requested by" },
  { name: "approvedBy", label: "Approved by" },
  { name: "purchaser", label: "Purchaser/Procurement Officer" },
  { name: "financeOfficer", label: "Finance Officer" },
] as const;
type RequestDetails = { siteId: string; ref: string; requestDate: string; requestedBy: string; approvedBy: string; purchaser: string; financeOfficer: string; specialInstructions: string };
type RequestStep = 1 | 2 | 3;

export function Requests() {
  const { snapshot: state } = useDemo();
  const [search,setSearch]=useState(""), [status,setStatus]=useState("all"), [neededBy,setNeededBy]=useState(""), [sort,setSort]=useState("recent");
  if(!state)return null;
  const rows=state.requests.filter(r=>(state.siteFilter==="all"||r.siteId===state.siteFilter)&&`${r.ref} ${r.items.map(i=>i.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())&&(status==="all"||r.status===status)&&(!neededBy||r.items.some(item=>item.neededDate && item.neededDate<=neededBy))).sort((a,b)=>sort==="needed"?(earliestNeededDate(a)||"9999").localeCompare(earliestNeededDate(b)||"9999"):b.updatedAt.localeCompare(a.updatedAt));
  return <><PageHeader eyebrow="MATERIAL REQUEST REGISTER" title="Material requests" description="Requirements, Procurement decisions, quotations, and linked purchases." actions={state.role==="Site Personnel"?<Link className="button primary" href="/requests/new">+ New MRF</Link>:undefined}/><div className="toolbar"><input aria-label="Search requests" placeholder="Search MRF or material" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Request status" value={status} onChange={e=>setStatus(e.target.value)}>{["all","draft","submitted","returned","approved","rejected"].map(s=><option key={s} value={s}>{s==="all"?"All statuses":s}</option>)}</select><input aria-label="Needed by date" type="date" value={neededBy} onChange={e=>setNeededBy(e.target.value)}/><select aria-label="Sort requests" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently updated</option><option value="needed">Needed soonest</option></select></div><div className="table-frame"><table><thead><tr><th>MRF / material</th><th>Project</th><th>Earliest needed</th><th>Status</th><th>Updated</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link className="table-primary" href={`/requests/${r.id}`}>{r.ref || "Unnumbered draft"}</Link><small>{r.items.map(i=>`${i.quantity} ${i.unit} ${i.name}`).join(", ")}</small></td><td>{siteName(state,r.siteId)}</td><td>{earliestNeededDate(r)?dateText(earliestNeededDate(r)):"—"}</td><td><Badge value={r.status}/></td><td>{dateText(r.updatedAt)}</td></tr>)}</tbody></table>{!rows.length&&<Empty detail={state.requests.length ? "Try a different search, filter, or site." : "No material requests yet. Site Personnel can create the first MRF."}/>}</div></>;
}

export function RequestForm({ id }: { id?: string }) {
  const { snapshot: state, run } = useDemo();
  const router = useRouter();
  const original = state?.requests.find(request => request.id === id);
  const inputRef = useRef<HTMLInputElement>(null);
  const choosePdfRef = useRef<HTMLButtonElement>(null);
  const pendingFileIds = useRef(new Set<string>());
  useEffect(() => { const staged = pendingFileIds.current; return () => { for (const fileId of staged) void deleteLocalFile(fileId).catch(() => {}); }; }, []);
  const { confirm, confirmation } = useConfirmation();
  const [items, setItems] = useState<Item[]>(() => original?.items.map(item => ({ ...item })) || [{ id: newId("item"), name: "", unit: "bag", quantity: 1, neededDate: new Date().toISOString().slice(0, 10), purpose: "", location: "", remarks: "" }]);
  const [documentState, setDocumentState] = useState<{ id?: string; touched: boolean; documents: DocumentRef[] }>(() => ({ id, touched: false, documents: [] }));
  const documents = documentState.id === id && documentState.touched ? documentState.documents : original?.documents || [];
  const [scopeState] = useState<{ id?: string; touched: boolean; document?: DocumentRef }>(() => ({ id, touched: false }));
  const scopeDocument = scopeState.id === id && scopeState.touched ? scopeState.document : original?.scopeDocument;
  const documentsOnly = original?.correction?.scope === "documents";
  const activeSupportingPdf = documents.find(document => document.type === "Supporting PDF");
  const [details, setDetails] = useState<RequestDetails>(() => ({
    siteId: original?.siteId || (state?.siteFilter !== "all" ? state?.siteFilter : "") || state?.sites[0]?.id || "",
    ref: original?.ref || "", requestDate: original?.requestDate || todayLocal(),
    requestedBy: original?.requestedBy || "", approvedBy: original?.approvedBy || "",
    purchaser: original?.purchaser || "", financeOfficer: original?.financeOfficer || "",
    specialInstructions: original?.specialInstructions || "",
  }));
  const [step, setStep] = useState<RequestStep>(documentsOnly ? 3 : 1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stepHeadingRef.current?.focus(); }, [step]);
  const [error, setError] = useState("");
  const [formFieldError, setFormFieldError] = useState<{ field: keyof RequestDetails; message: string } | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [savingPdf, setSavingPdf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importedWithAI, setImportedWithAI] = useState(false);
  const aiAssisted = original?.aiAssisted === true || importedWithAI;
  const [aiReviewed, setAiReviewed] = useState(false);
  const [aiReviewError, setAiReviewError] = useState("");
  const aiReviewRef = useRef<HTMLInputElement>(null);
  const manuallyEdited = useRef(false);
  const markEdited = () => { manuallyEdited.current = true; setAiReviewed(false); setAiReviewError(""); };
  const saveInProgress = useRef(false);
  const pdfInProgress = useRef(false);
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
    markEdited();
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
    markEdited();
    const index = items.findIndex(item => item.id === itemId);
    const remaining = items.filter(item => item.id !== itemId);
    setItems(remaining);
    if (expandedItemId === itemId) setExpandedItemId(remaining[Math.min(index, remaining.length - 1)]?.id || null);
    if (invalidItemId === itemId) { setInvalidItemId(null); setError(""); }
  };
  const revealItem = (item: Item, fieldId: string) => {
    setStep(2);
    setMaterialSearch("");
    setExpandedItemId(item.id);
    window.requestAnimationFrame(() => {
      const card = document.getElementById("material-card-" + item.id);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      revealField(document.getElementById(fieldId));
    });
  };
  const updateItem = (itemId: string, patch: Partial<Item>) => {
    markEdited();
    const currentItem = items.find(item => item.id === itemId);
    const updatedItem = currentItem ? { ...currentItem, ...patch } : null;
    setItems(current => current.map(item => item.id === itemId ? { ...item, ...patch } : item));
    if (invalidItemId === itemId && updatedItem && updatedItem.name.trim() && updatedItem.unit.trim() && Number.isFinite(updatedItem.quantity) && updatedItem.quantity > 0 && updatedItem.neededDate.trim() && updatedItem.location.trim()) { setInvalidItemId(null); setError(""); }
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

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || pdfInProgress.current || saveInProgress.current) return;
    const file = files[0];
    pdfInProgress.current = true;
    setSavingPdf(true);
    try {
      if (files.length !== 1 || file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf") || file.size > 50 * 1024 * 1024 || await file.slice(0, 5).text() !== "%PDF-") { setAttachmentError("Choose one valid PDF up to 50 MB."); return; }
      const saved = await saveRequestFile(file, "Supporting PDF");
      pendingFileIds.current.add(saved.fileId!);
      updateDocuments(() => [saved]);
      setAttachmentError("");
    } catch { setAttachmentError("The PDF could not be saved in this browser."); }
    finally { pdfInProgress.current = false; setSavingPdf(false); }
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const changeStep = (nextStep: RequestStep) => {
    setError("");
    setStep(nextStep);
  };
  const updateDetails = (field: keyof RequestDetails, value: string) => {
    markEdited();
    setDetails(current => ({ ...current, [field]: value }));
    if (formFieldError?.field === field) setFormFieldError(null);
  };
  const applyImport = async ({ extraction }: MrfExtractionResult) => {
    if (manuallyEdited.current && !await confirm("Replace entered details and materials?", "The extracted values will replace this form's request details and material list. The supporting PDF stays separate.", "Apply extracted values")) return false;
    const found = extraction.details;
    setDetails({ siteId: "", ref: found.ref, requestDate: found.requestDate, requestedBy: found.requestedBy, approvedBy: found.approvedBy, purchaser: found.purchaser, financeOfficer: found.financeOfficer, specialInstructions: found.specialInstructions });
    const imported = mrfImportedItems(extraction, () => newId("item"));
    setItems(imported); setExpandedItemId(imported[0].id); setMaterialSearch(""); setInvalidItemId(null);
    setImportedWithAI(true); setAiReviewed(false); setAiReviewError(""); setFormFieldError(null); setError(""); setStep(1);
    manuallyEdited.current = false;
    window.requestAnimationFrame(() => revealField(document.getElementById("siteId")));
    return true;
  };
  const detailError = (field: keyof RequestDetails, message: string) => {
    setFormFieldError({ field, message });
    setStep(1);
    window.requestAnimationFrame(() => revealField(document.getElementById(field)));
    return false;
  };
  const validateDetails = () => {
    if (!state.sites.some(site => site.id === details.siteId)) return detailError("siteId", "Choose a valid project.");
    if (!details.ref.trim()) return detailError("ref", "Enter the M.R.F No.");
    if (state.requests.some(request => request.id !== id && request.ref.trim().toLocaleLowerCase() === details.ref.trim().toLocaleLowerCase())) return detailError("ref", "This M.R.F No. is already in use.");
    const date = details.requestDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return detailError("requestDate", "Enter a valid Request Date.");
    for (const field of REQUEST_DETAIL_FIELDS) if (!details[field.name].trim()) return detailError(field.name, `Enter ${field.label.toLowerCase()}.`);
    setFormFieldError(null);
    return true;
  };
  const invalidMaterialField = (item: Item) => !item.name.trim() ? "material" : !item.unit.trim() ? "unit" : !Number.isFinite(item.quantity) || item.quantity <= 0 ? "quantity" : !item.neededDate.trim() ? "needed" : !item.location.trim() ? "location" : null;
  const validateMaterials = () => {
    if (!items.length) { setStep(2); setError("Add at least one material."); return false; }
    const invalid = items.find(item => invalidMaterialField(item));
    if (invalid) {
      setInvalidItemId(invalid.id);
      setError("Enter a material name, unit, positive quantity, date needed, and delivery location.");
      revealItem(invalid, `${invalidMaterialField(invalid)}-${invalid.id}`);
      return false;
    }
    setInvalidItemId(null);
    setError("");
    return true;
  };
  const nextStep = () => {
    if (step === 1 && validateDetails()) changeStep(2);
    else if (step === 2 && validateMaterials()) changeStep(3);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveInProgress.current || pdfInProgress.current) return;
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "draft" ? "draft" : "submit";
    if (intent === "submit" && step !== 3) { nextStep(); return; }
    if (intent === "submit") {
      if (!documentsOnly && (!validateDetails() || !validateMaterials())) return;
      if (!activeSupportingPdf?.fileId) { setAttachmentError("Attach one combined supporting PDF before submitting."); revealField(choosePdfRef.current); return; }
      if (aiAssisted && !aiReviewed) { setAiReviewError("Confirm you reviewed the extracted request details and materials."); revealField(aiReviewRef.current); return; }
    }
    saveInProgress.current = true;
    setSaving(true);
    try {
      if (intent === "submit" && !await confirm(original ? "Resubmit this MRF?" : "Submit this MRF?", "Procurement will receive this request for a decision.", original ? "Resubmit MRF" : "Submit MRF")) return;
      const result = await run({ type: "saveRequest", id, intent, ...details, aiAssisted, aiReviewed, signatoryTitles: original?.signatoryTitles, scopeDocument, items, documents });
      if (result.ok) {
        const keptIds = new Set([scopeDocument?.fileId, ...documents.map(document => document.fileId)].filter((value): value is string => !!value));
        for (const fileId of pendingFileIds.current) if (keptIds.has(fileId)) pendingFileIds.current.delete(fileId);
        for (const fileId of [original?.scopeDocument?.fileId, ...(original?.documents.map(document => document.fileId) || [])]) if (fileId && !keptIds.has(fileId)) void deleteLocalFile(fileId).catch(() => {});
        router.push(`/requests/${result.recordId}`);
      } else {
        const field = result.field === "ref" || result.field === "requestDate" ? result.field : null;
        setFormFieldError(field ? { field, message: result.message } : null);
        setError(field ? "" : result.message);
        if (field) detailError(field, result.message);
        if (result.field === "siteId") detailError("siteId", result.message);
        if (result.field === "items") validateMaterials();
        if (result.field === "documents") { setStep(3); setAttachmentError(result.message); }
        if (result.field === "aiReview") { setStep(3); setAiReviewError(result.message); window.requestAnimationFrame(() => revealField(aiReviewRef.current)); }
      }
    } catch { setError("The request could not be saved. Please try again."); }
    finally { saveInProgress.current = false; setSaving(false); }
  };

  if (!state) return null;
  if (!state.sites.length) return <>
    <PageHeader eyebrow="NEW MATERIAL REQUEST" title="Set up the workspace first" description="A project is needed before you can create an MRF." />
    <section className="panel"><p>Switch to Administrator and add a project. Then return here as Site Personnel.</p><Link className="button primary" href="/admin">Open administration</Link></section>
  </>;

  return <>
    <PageHeader eyebrow={original ? "REVISE MATERIAL REQUEST" : "NEW MATERIAL REQUEST"} title={original ? `Edit ${original.ref || "unnumbered draft"}` : "Create MRF"} description="Enter request details, add materials, then review and submit."/>
    <form className="form-stack request-wizard" noValidate onSubmit={save} onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "search" && event.target.type !== "checkbox") {
        event.preventDefault();
        if (step < 3) nextStep();
      }
    }}>
      {original?.correction && <div className="callout warn"><strong>Procurement requested a correction</strong><p>{original.correction.reason}</p><p>{documentsOnly ? "Only the supporting PDF can be replaced because purchasing has started." : "Update the request and supporting PDF, then resubmit."}</p></div>}
      <nav aria-label="Request steps"><ol className="request-steps">{REQUEST_STEPS.map((label, index) => <li key={label}><button type="button" aria-current={step === index + 1 ? "step" : undefined} disabled={documentsOnly || index + 1 >= step || saving || savingPdf} onClick={() => changeStep((index + 1) as RequestStep)}><span className="request-step-number" aria-hidden="true">{index + 1}</span><span>{label}</span></button></li>)}</ol></nav>
      <div className="request-step-heading"><span className="eyebrow">STEP {step} OF 3</span><h2 ref={stepHeadingRef} tabIndex={-1}>{REQUEST_STEPS[step - 1]}</h2><p>{step === 1 ? "Choose the project and enter the names shown on the MRF." : step === 2 ? "List the materials the site needs. Purpose and remarks are optional." : "Attach the supporting PDF and check your request before sending it to Procurement."}</p></div>
      {!id && state.role === "Site Personnel" && <div hidden={step !== 1}><MrfAiImport disabled={saving || savingPdf} onApply={applyImport}/></div>}
      <fieldset className="request-edit-fields" disabled={documentsOnly}>
      <section className="panel" hidden={step !== 1}>
        <CollapsibleSection title="General information">
        <div className="form-grid">
          <Field label="Project / site" error={formFieldError?.field === "siteId" ? formFieldError.message : undefined}><select id="siteId" name="site" value={details.siteId} aria-invalid={formFieldError?.field === "siteId"} onChange={event => updateDetails("siteId", event.target.value)}><option value="">Choose a project</option>{state.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
          <Field label="M.R.F No." error={formFieldError?.field === "ref" ? formFieldError.message : undefined}><input id="ref" name="ref" value={details.ref} placeholder="Enter the company reference" autoComplete="off" aria-invalid={formFieldError?.field === "ref"} onChange={event => updateDetails("ref", event.target.value)}/></Field>
          <Field label="Request Date" error={formFieldError?.field === "requestDate" ? formFieldError.message : undefined}><input id="requestDate" name="requestDate" type="date" value={details.requestDate} aria-invalid={formFieldError?.field === "requestDate"} onChange={event => updateDetails("requestDate", event.target.value)}/></Field>
          {REQUEST_DETAIL_FIELDS.map(field => <Field key={field.name} label={field.label} error={formFieldError?.field === field.name ? formFieldError.message : undefined}><input id={field.name} name={field.name} value={details[field.name]} aria-invalid={formFieldError?.field === field.name} onChange={event => updateDetails(field.name, event.target.value)}/></Field>)}
          <div className="material-card-wide"><CollapsibleSection title="Comments / special instructions" defaultOpen={false}><Field label="Comments / special instructions (optional)"><textarea name="specialInstructions" value={details.specialInstructions} onChange={event => updateDetails("specialInstructions", event.target.value)}/></Field></CollapsibleSection></div>
        </div>
        </CollapsibleSection>
      </section>
      <section className="panel materials-panel" aria-label="Materials" hidden={step !== 2}><CollapsibleSection title="Requested materials">
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
                  <Field label="Material" error={invalidItemId === item.id && !item.name.trim() ? "Enter the material name." : undefined}><input id={'material-' + item.id} name={'material-' + item.id} value={item.name} onChange={event => updateItem(item.id, { name: event.target.value })}/></Field>
                  <Field label="Unit" error={invalidItemId === item.id && !item.unit.trim() ? "Enter the unit." : undefined}><input id={'unit-' + item.id} name={'unit-' + item.id} value={item.unit} onChange={event => updateItem(item.id, { unit: event.target.value })}/></Field>
                  <Field label="Quantity" error={invalidItemId === item.id && (!Number.isFinite(item.quantity) || item.quantity <= 0) ? "Enter a quantity greater than zero." : undefined}><input id={'quantity-' + item.id} name={'quantity-' + item.id} type="number" step="any" value={item.quantity || ""} onChange={event => updateItem(item.id, { quantity: Number(event.target.value) })}/></Field>
                  <Field label="Date needed" error={invalidItemId === item.id && !item.neededDate.trim() ? "Choose a date needed." : undefined}><input id={'needed-' + item.id} name={'needed-' + item.id} type="date" value={item.neededDate} onChange={event => updateItem(item.id, { neededDate: event.target.value })}/></Field>
                  <Field label="Purpose (optional)"><input id={'purpose-' + item.id} name={'purpose-' + item.id} value={item.purpose} onChange={event => updateItem(item.id, { purpose: event.target.value })}/></Field>
                  <Field label="Delivery location" error={invalidItemId === item.id && !item.location.trim() ? "Enter the delivery location." : undefined}><input id={'location-' + item.id} name={'location-' + item.id} value={item.location} onChange={event => updateItem(item.id, { location: event.target.value })}/></Field>
                  <div className="material-card-wide"><Field label="Remarks (optional)"><textarea id={'remarks-' + item.id} name={'remarks-' + item.id} value={item.remarks} onChange={event => updateItem(item.id, { remarks: event.target.value })}/></Field></div>
                </div>
                <InlineError message={invalidItemId === item.id ? error : ''}/>
              </div>
            </article>;
          }) : <div className="material-search-empty"><strong>No materials match “{materialSearch}”.</strong><button type="button" className="text-link" onClick={() => setMaterialSearch("")}>Clear search</button></div>}
        </div>
        </CollapsibleSection>
      </section>
      </fieldset>
      <section className="panel" hidden={step !== 3}>
        <CollapsibleSection title="Combined supporting PDF" summary={<span className="reference-count">{activeSupportingPdf ? "1 attached" : "Required to submit"}</span>}>
        <p className="reference-note">Attach one PDF containing the hardcopy MRF, key plan, and work scope. It stays in this browser during Procurement review and is archived to Drive after approval.</p>
        <div className={`reference-dropzone${dragActive ? " is-active" : ""}`} onDragEnter={event => { event.preventDefault(); setDragActive(true); }} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={event => { event.preventDefault(); setDragActive(false); }} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}>
          <input ref={inputRef} className="reference-file-input" type="file" accept="application/pdf,.pdf" aria-label="Choose combined supporting PDF" disabled={savingPdf || saving} onChange={onPickFiles}/>
          <svg className="reference-upload-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M11 4h17l9 9v18H11z"/><path d="M28 4v9h9"/><circle cx="33" cy="35" r="10"/><path d="M33 39v-9m-4 4 4-4 4 4"/></svg>
          <p>Drag and drop the combined PDF here or <button ref={choosePdfRef} type="button" className="reference-choose" disabled={savingPdf || saving} onClick={() => inputRef.current?.click()}>Choose PDF</button></p>
          <small>PDF only · Up to 50 MB</small>
        </div>
        <InlineError message={attachmentError}/>
        {savingPdf && <p role="status">Saving PDF…</p>}
        {activeSupportingPdf && <div className="reference-file-list" aria-label="Attached supporting PDF"><div className="reference-file"><span className="reference-file-icon" aria-hidden="true">PDF</span><div className="reference-file-detail"><strong title={activeSupportingPdf.name}>{activeSupportingPdf.name}</strong><small>Stored in this browser until and after Drive archiving</small></div><button type="button" className="reference-remove" disabled={savingPdf || saving} aria-label={`Remove ${activeSupportingPdf.name}`} onClick={() => { updateDocuments(() => []); setAttachmentError(""); }}>×</button></div></div>}
        </CollapsibleSection>
      </section>
      {step === 3 && <section className="panel request-review" aria-label="Request summary">
        <div className="panel-heading"><h2>Request summary</h2>{!documentsOnly && <button type="button" className="text-link" onClick={() => changeStep(1)}>Edit details</button>}</div>
        <dl className="request-review-details"><div><dt>Project / site</dt><dd>{siteName(state, details.siteId)}</dd></div><div><dt>M.R.F No.</dt><dd>{details.ref || "—"}</dd></div><div><dt>Request Date</dt><dd>{dateText(details.requestDate)}</dd></div>{REQUEST_DETAIL_FIELDS.map(field => <div key={field.name}><dt>{field.label}</dt><dd>{details[field.name] || "—"}</dd></div>)}</dl>
        {details.specialInstructions && <p className="request-review-instructions"><strong>Comments / special instructions:</strong> {details.specialInstructions}</p>}
        <div className="panel-heading"><h3>Materials · {items.length}</h3>{!documentsOnly && <button type="button" className="text-link" onClick={() => changeStep(2)}>Edit materials</button>}</div>
        <ul className="request-review-materials">{items.map(item => <li key={item.id}><strong>{item.name || "Unnamed material"}</strong><span>{item.quantity} {item.unit} · Needed {dateText(item.neededDate)}</span><span>Deliver to: {item.location || "—"}</span>{item.purpose && <span>Purpose: {item.purpose}</span>}{item.remarks && <span>Remarks: {item.remarks}</span>}</li>)}</ul>
      </section>}
      {step === 3 && aiAssisted && <section className="panel mrf-ai-review"><h2>Confirm your review</h2><p>Check the request details and each material against the hardcopy. AI can misread names, dates and quantities.</p><label className="quote-check"><input ref={aiReviewRef} type="checkbox" name="aiReviewed" checked={aiReviewed} aria-invalid={!!aiReviewError} aria-describedby={aiReviewError ? "mrf-ai-review-error" : undefined} onChange={event => { setAiReviewed(event.target.checked); setAiReviewError(""); }}/><span>I reviewed the extracted request details and materials.</span></label>{aiReviewError && <p id="mrf-ai-review-error" className="field-error" role="alert">{aiReviewError}</p>}</section>}
      <InlineError message={invalidItemId ? "" : error}/>
      <div className="form-actions request-wizard-actions"><div><Link className="button secondary" href={original ? `/requests/${original.id}` : "/requests"}>Cancel</Link><button className="button secondary" type="submit" value="draft" disabled={saving || savingPdf}>Save draft</button></div><div>{step > 1 && !documentsOnly && <button className="button secondary" type="button" disabled={saving || savingPdf} onClick={() => changeStep((step - 1) as RequestStep)}>Back</button>}{step < 3 ? <button className="button primary" type="button" onClick={nextStep}>Next</button> : <button className="button primary" type="submit" value="submit" disabled={saving || savingPdf}>{saving ? "Please wait…" : original ? "Resubmit MRF" : "Submit MRF"}</button>}</div></div>
    </form>
    {confirmation}
  </>;
}

function RequestMaterialList({ state, siteId, items, requestId }: { state: DemoSnapshot; siteId: string; items: Item[]; requestId: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
              <span className="request-material-name">{item.name || "Unnamed material"}<small className="request-material-summary">{item.quantity} {item.unit} · Needed {item.neededDate ? dateText(item.neededDate) : "—"}</small></span>
              <span className="request-material-indicator" aria-hidden="true">{isExpanded ? "−" : "+"}</span>
            </button>
          </h3>
          {state.quotes.some(quote => quote.mrfId === requestId && quote.reviewStatus !== "draft" && quote.lines?.some(line => line.requestItemId === item.id)) && <div className="request-material-match"><small>Supplier offers match this material</small><Link className="text-link" href={`/requests/${requestId}/quotes?materialId=${encodeURIComponent(item.id)}`}>View matching offers</Link></div>}
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
  const { perform } = useArchive();
  const { snapshot: state, run }=useDemo(); const [decision,setDecision]=useState<"return"|"reject"|null>(null),[error,setError]=useState("");
  const [archiving,setArchiving]=useState(false),[reopenOpen,setReopenOpen]=useState(false);
  const { confirm, confirmation } = useConfirmation();
  if(!state)return null; const request=state.requests.find(r=>r.id===id); if(!request)return <MissingRecord name="MRF" listHref="/requests"/>;
  const pos=posForRequest(state,request),po=pos[0];
  const currentArchive = request.archive?.versions.at(-1);
  const archive=async(source=state)=>{const current=source.requests.find(value=>value.id===id),site=source.sites.find(value=>value.id===current?.siteId);if(!current||!site)return;setArchiving(true);const result=await perform(`request-${current.id}`, `MRF ${current.ref}`, progress => syncApprovedRequest(current,site,run,progress));setError(result.ok?"":result.message);setArchiving(false);};
  const decide=async(choice:"approve"|"return"|"reject",reason?:string)=>{if(!await confirm(`${choice === "approve" ? "Approve" : choice === "return" ? "Return" : "Reject"} ${request.ref}?`,choice === "approve" ? "The approved MRF and supporting PDF will be archived to Google Drive before Procurement begins." : choice === "return" ? "Site Personnel will revise this request." : "This request will close.",`${choice === "approve" ? "Approve" : choice === "return" ? "Return" : "Reject"} request`,choice === "reject"))return;const result=await run({type:"reviewRequest",id,decision:choice,reason});if(!result.ok)setError(result.message);else{setDecision(null);setError("");if(choice==="approve")await archive(result.snapshot);}};
  return <><RecordHeader backHref="/requests" backLabel="Material requests" eyebrow={siteName(state,request.siteId)} title={request.ref || "Unnumbered draft"} badges={<><Badge value={request.status}/>{po&&<Badge value={po.status}>{poStatusLabel(po.status)}</Badge>}</>}/>
    <div className="request-detail-layout"><div className="request-detail-overview"><section className="panel"><h2 className="panel-title">General information</h2><DocumentPreview kind="mrf" request={request} project={state.sites.find(site => site.id === request.siteId)!}/><div className="data-rows"><div><span>M.R.F No.</span><strong>{request.ref || "—"}</strong></div><div><span>Request Date</span><strong>{request.requestDate ? dateText(request.requestDate) : "—"}</strong></div><div><span>Requested by</span><strong>{request.requestedBy || "—"}</strong></div><div><span>Approved by</span><strong>{request.approvedBy || "—"}</strong></div><div><span>Purchaser/Procurement Officer</span><strong>{request.purchaser || "—"}</strong></div><div><span>Finance Officer</span><strong>{request.financeOfficer || "—"}</strong></div></div>{request.scope && !request.scopeDocument && <p className="helper-note">Legacy scope note: {request.scope}</p>}{request.reason&&<div className="callout warn"><strong>Review reason</strong><p>{request.reason}</p></div>}</section>
    <section className="panel"><h2 className="panel-title">Documents and links</h2>{(request.scopeDocument || request.documents.length > 0) && <Documents docs={[...(request.scopeDocument ? [request.scopeDocument] : []), ...request.documents]} showType={false} />}{pos.map(linked => <Link className="data-link" href={`/purchase-orders/${linked.id}`} key={linked.id}><div><strong>{linked.ref}</strong><small>{supplierName(state,linked)} · {money(poTotal(state,linked))}</small></div><Badge value={linked.status}/></Link>)}{!request.scopeDocument && !request.documents.length && !pos.length && <p className="muted">No documents or links recorded.</p>}</section></div>
    <RequestMaterialList key={request.id} requestId={request.id} state={state} siteId={request.siteId} items={request.items}/>
    {state.role==="Site Personnel"&&(["draft","returned"].includes(request.status)||request.correction?.status==="requested")&&<section className="action-bar"><div><strong>{request.correction?.status==="requested"||request.status==="returned"?"Revision requested":"Draft request"}</strong><p>{request.correction?.scope==="documents"?"Replace the supporting PDF and resubmit it to Procurement.":"Update the MRF before submitting it to Procurement."}</p></div><Link className="button primary" href={`/requests/${id}/edit`}>Edit MRF</Link></section>}
    {state.role==="Procurement"&&(request.status==="submitted"||request.correction?.status==="submitted")&&<section className="panel"><div className="panel-heading"><h2>Procurement decision</h2></div><p className="helper-note">Review current on-hand site stock for each requested material above. Quantities match the material name and unit; approval does not reserve stock.</p><div className="button-row"><button className="button primary" onClick={()=>void decide("approve")}>Approve request</button><button className="button secondary" onClick={()=>setDecision("return")}>Return with reason</button>{!request.correction&&<button className="button danger-outline" onClick={()=>setDecision("reject")}>Reject with reason</button>}</div>{decision&&<form className="decision-panel" onSubmit={e=>{e.preventDefault();void decide(decision,String(new FormData(e.currentTarget).get("reason")));}}><Field label={`${decision==="return"?"Return":"Rejection"} reason`}><textarea name="reason" required minLength={5}/></Field><InlineError message={error}/><div className="button-row"><button type="button" className="button secondary" onClick={()=>setDecision(null)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}</section>}
    {request.archive && <section className="panel"><div className="panel-heading"><h2>Google Drive archive</h2><Badge value={request.archive.status === "complete" ? "Complete" : "Pending"}/></div>{request.archive.status === "pending" ? <><p className="helper-note">Procurement waits until the generated MRF and supporting PDF are both in the project folder.</p>{request.archive.error && <div className="callout warn"><strong>Archive needs a retry</strong><p>{request.archive.error}</p></div>}{["Procurement","Administrator"].includes(state.role) && <button className="button primary" disabled={archiving} onClick={()=>void archive()}>{archiving ? "Archiving…" : "Retry Drive archive"}</button>}</> : <p className="helper-note">The latest approved PDFs are available in the project folder.</p>}{request.archive.versions.map(version=><div className="data-rows" key={version.version}><div><span>Version {version.version}{currentArchive?.version===version.version ? " · Current" : ""}</span><strong><a href={version.formUrl} target="_blank" rel="noreferrer">MRF Form ↗</a> · <a href={version.supportUrl} target="_blank" rel="noreferrer">Supporting PDF ↗</a></strong></div></div>)}</section>}
    {request.correction && <div className="callout warn"><strong>Correction {request.correction.status}</strong><p>{request.correction.reason}</p><p>New purchasing actions are paused until Procurement reapproves and archives the corrected MRF.</p></div>}
    {state.role==="Procurement"&&request.status==="approved"&&!request.correction&&request.archive?.status==="complete"&&<section className="panel"><h2 className="panel-title">Correct approved MRF</h2><p className="helper-note">Site Personnel will revise the same request. Once quotations or POs exist, only the supporting PDF can change.</p>{reopenOpen ? <form onSubmit={async event=>{event.preventDefault();const reason=String(new FormData(event.currentTarget).get("reason")||"");const result=await run({type:"reopenApprovedRequest",id,reason});setError(result.ok?"":result.message);if(result.ok)setReopenOpen(false);}}><Field label="Correction reason"><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={()=>setReopenOpen(false)}>Cancel</button><button className="button primary">Send back to Site Personnel</button></div></form> : <button className="button secondary" onClick={()=>setReopenOpen(true)}>Reopen for correction</button>}</section>}
    <InlineError message={error}/>
    {confirmation}
    {procurementReady(request)&&<section className="action-bar"><div><strong>Supplier comparison</strong><p>{state.quotes.filter(q=>q.mrfId===id).length} quotations on file. The lowest price is highlighted but never selected automatically.</p></div><Link className="button primary" href={`/requests/${id}/quotes`}>Compare quotations →</Link></section>}
    <Timeline state={state} ids={[id,...pos.map(linked=>linked.id)]}/></div></>;
}

export { QuotationWorkspace as QuoteComparison } from "./QuotationWorkspace";
