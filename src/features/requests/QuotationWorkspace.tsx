"use client";

import { useArchive } from "@/src/app-state/ArchiveProvider";
import Link from "next/link";
import { poStatusLabel } from "@/src/domain/workflow";
import { useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, RecordHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { latestFinalizedQuotes } from "@/src/domain/procurement";
import { quoteLineTotal } from "@/src/domain/pricing";
import { orderedFor } from "@/src/domain/selectors";
import { procurementReady } from "@/src/domain/request-archive";
import type { DemoSnapshot, DocumentRef, Quote, QuoteAdjustment, QuoteLine } from "@/src/domain/types";
import { QuoteDraftEditor } from "./QuoteDraftEditor";
import { QuoteDocumentsDialog } from "./QuoteDocumentsDialog";
import { deleteLocalFile, readQuoteFile, saveQuoteFiles } from "./quote-files";
import { syncFinalizedQuote } from "./archive-purchasing";
import { BidComparisonReports } from "./BidComparisonReports";

type Step = "review" | "compare" | "allocation" | "po";
type Group = { id: string; files: File[]; status: "ready" | "processing" | "failed" | "completed"; error?: string };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const supplierName = (state: DemoSnapshot, quote: Quote) => quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier";
const format = (currency: string | undefined, value: number) => currency === "PHP" || !currency ? money(value) : `${currency} ${value.toFixed(2)}`;
const blankQuote = (requestId: string, documents: DocumentRef[] = [], supplier = ""): Quote => ({ id: newId("quote"), mrfId: requestId, supplierId: "", ref: "", prices: {}, available: "", leadDays: 0, terms: "", documents, lines: [blankLine()], currency: "PHP", tax: 0, freight: 0, discount: 0, validity: "", extraction: "manual", reviewStatus: "draft", supplierDetails: { name: supplier, address: "", tin: "", contactName: "", email: "", phone: "" }, adjustments: [], quoteDate: "", deliveryTerms: "", quoteNotes: "" });
function extractedAdjustments(value: Record<string, unknown>): QuoteAdjustment[] {
  const list = Array.isArray(value.adjustments) ? value.adjustments : [];
  if (list.length) return list.map((raw: Record<string, unknown>) => ({ id: newId("adjustment"), label: String(raw.label || "Adjustment"), kind: (["discount", "tax", "shipping", "other"].includes(String(raw.kind)) ? raw.kind : "other") as QuoteAdjustment["kind"], calculation: (raw.calculation === "percentage" ? "percentage" : "fixed"), value: num(raw.value) }));
  return [["tax", "Tax", value.tax], ["shipping", "Freight", value.freight], ["discount", "Discount", value.discount]].filter(row => num(row[2]) > 0).map(row => ({ id: newId("adjustment"), kind: row[0] as QuoteAdjustment["kind"], label: row[1] as string, calculation: "fixed", value: num(row[2]) }));
}

export function QuotationWorkspace({ id, initialMaterialId = "" }: { id: string; initialMaterialId?: string }) {
  const { perform } = useArchive();
  const { snapshot: state, run } = useDemo();
  const [step, setStep] = useState<Step>(initialMaterialId ? "compare" : "review");
  const [groups, setGroups] = useState<Group[]>([]);
  const [dragGroupId, setDragGroupId] = useState("");
  const dragDepth = useRef<Record<string, number>>({});
  const [manualSourcesOpen, setManualSourcesOpen] = useState(false);
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [reviewMode, setReviewMode] = useState<"focused" | "all">("focused");
  const { confirm, confirmation } = useConfirmation();
  const [activeDraftId, setActiveDraftId] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [materialFilter, setMaterialFilter] = useState(initialMaterialId);
  const [busy, setBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [archivingQuoteId, setArchivingQuoteId] = useState("");
  if (!state) return null;
  const request = state.requests.find(value => value.id === id);
  if (!request) return <MissingRecord name="MRF" listHref="/requests"/>;
  const canEdit = state.role === "Procurement" && procurementReady(request);
  const quotes = state.quotes.filter(value => value.mrfId === id);
  const finalized = latestFinalizedQuotes(state, id);
  const drafts = quotes.filter(value => value.reviewStatus === "draft");
  const activeDraft = drafts.find(value => value.id === activeDraftId) || drafts[0];
  const pos = state.pos.filter(value => value.mrfId === id);
  const staged = state.pendingAwards.filter(value => value.requestId === id);
  const pendingFor = (lineId: string) => staged.find(value => value.quoteLineId === lineId)?.quantity || 0;
  const ordered = (itemId: string) => pos.filter(po => po.status !== "rejected").reduce((total, po) => total + orderedFor(state, po, itemId), 0);
  const stagedFor = (itemId: string) => staged.filter(value => value.itemId === itemId).reduce((total, value) => total + value.quantity, 0);
  const setGroup = (groupId: string, patch: Partial<Group>) => setGroups(current => current.map(group => group.id === groupId ? { ...group, ...patch } : group));
  const enterDrop = (key: string) => { dragDepth.current[key] = (dragDepth.current[key] || 0) + 1; setDragGroupId(key); };
  const leaveDrop = (key: string) => { dragDepth.current[key] = Math.max(0, (dragDepth.current[key] || 0) - 1); if (!dragDepth.current[key]) setDragGroupId(""); };
  const clearDrop = (key: string) => { dragDepth.current[key] = 0; setDragGroupId(""); };
  const saveDraft = async (quote: Quote) => { const result = await run({ type: "saveQuoteDraft", quote }); if (!result.ok) setError(result.message); return result.ok; };
  const attachDraftFiles = async (quote: Quote, files: File[]) => {
    const combined = [...quote.documents, ...files];
    const existingSizes = await Promise.all(quote.documents.map(async document => document.fileId ? (await readQuoteFile(document.fileId))?.size || 0 : 0));
    if (combined.length > 12 || files.some(file => !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) || [...existingSizes, ...files.map(file => file.size)].reduce((sum, size) => sum + size, 0) > 45 * 1024 * 1024) { setError("Use up to 12 PDF, JPG, PNG, or WebP files, at most 20 MB each and 45 MB total."); return; }
    try { const documents = await saveQuoteFiles(files); if (await saveDraft({ ...quote, documents: [...quote.documents, ...documents] })) setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The quotation files could not be attached."); }
  };
  const removeDraftDocument = async (quote: Quote, fileId: string) => {
    if (!await saveDraft({ ...quote, documents: quote.documents.filter(document => document.fileId !== fileId) })) return;
    const shared = state.quotes.some(value => value.id !== quote.id && value.documents.some(document => document.fileId === fileId));
    if (!shared) void deleteLocalFile(fileId).catch(() => {});
    setError("");
  };
  const archiveQuote = async (quote: Quote, snapshot: DemoSnapshot = state) => {
    setArchivingQuoteId(quote.id); setError("");
    try { const result = await perform(`quote-${quote.id}`, `Quotation ${quote.ref || quote.supplierDetails?.name || "files"}`, progress => syncFinalizedQuote(snapshot, quote, run, progress)); if (!result.ok) setError(result.message); }
    finally { setArchivingQuoteId(""); }
  };
  const addGroupFiles = (group: Group, files: File[]) => {
    const combined = [...group.files, ...files];
    if (combined.length > 12 || combined.some(file => !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) || combined.reduce((sum, file) => sum + file.size, 0) > 45 * 1024 * 1024) { setGroup(group.id, { error: "Use up to 12 PDF, JPG, PNG, or WebP files, at most 20 MB each and 45 MB total." }); return; }
    setGroup(group.id, { files: combined, error: "", status: "ready" });
  };
  const extract = async (files: File[], documents?: DocumentRef[], supersedesId?: string, groupId?: string) => {
    setBusy(true); setError(""); if (groupId) setGroup(groupId, { status: "processing", error: "" });
    try {
      const form = new FormData(); files.forEach(file => form.append("files", file));
      form.append("materials", JSON.stringify(request.items.map(item => ({ id: item.id, description: item.name, quantity: item.quantity, unit: item.unit }))));
      const response = await fetch("/api/quotes/extract", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI could not read this quotation.");
      const found = result.extraction as Record<string, unknown>;
      if (!Array.isArray(found.lines)) throw new Error("AI extraction returned no offered lines.");
      const source = documents || await saveQuoteFiles(files);
      const previous = supersedesId ? quotes.find(value => value.id === supersedesId) : undefined;
      const name = String(found.supplier || previous?.supplierDetails?.name || "");
      const matchingSupplier = state.suppliers.find(value => value.name.trim().toLowerCase() === name.trim().toLowerCase());
      const draft: Quote = { ...blankQuote(id, source, name), supplierId: previous?.supplierId || matchingSupplier?.id || "", supersedesId, extraction: "gemini", ref: String(found.reference || ""), currency: String(found.currency || "").toUpperCase(), available: String(found.available || ""), leadDays: num(found.leadDays), terms: String(found.terms || ""), validity: String(found.validity || ""), quoteDate: String(found.quoteDate || ""), deliveryTerms: String(found.deliveryTerms || ""), quoteNotes: String(found.quoteNotes || ""), supplierDetails: { name, address: String(found.supplierAddress || ""), tin: String(found.supplierTin || ""), contactName: String(found.contactName || ""), email: String(found.email || ""), phone: String(found.phone || "") }, adjustments: extractedAdjustments(found), lines: found.lines.map((raw: Record<string, unknown>) => { const suggested = request.items.some(item => item.id === raw.requestedMaterialId) ? String(raw.requestedMaterialId) : ""; return { ...blankLine(), description: String(raw.description || ""), quantity: num(raw.quantity), unit: String(raw.unit || ""), unitPrice: num(raw.unitPrice), brand: String(raw.brand || ""), specification: String(raw.specification || ""), supplierItemCode: String(raw.supplierItemCode || ""), discountType: (["none", "percentage", "fixed"].includes(String(raw.discountType)) ? raw.discountType : "none") as QuoteLine["discountType"], discountValue: num(raw.discountValue), taxRate: num(raw.taxRate), printedTotal: num(raw.printedTotal) > 0 ? num(raw.printedTotal) : null, leadTime: String(raw.leadTime || ""), notes: String(raw.notes || ""), sourcePage: num(raw.sourcePage) > 0 ? num(raw.sourcePage) : null, requestItemId: suggested, matchConfidence: (["high", "medium", "low"].includes(String(raw.matchConfidence)) ? raw.matchConfidence : "low") as QuoteLine["matchConfidence"], matchRationale: String(raw.matchRationale || ""), matchConfirmed: false }; }) };
      if (!await saveDraft(draft)) throw new Error("The extracted draft could not be saved.");
      setActiveDraftId(draft.id); setStep("review"); if (groupId) setGroup(groupId, { status: "completed" });
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Quotation extraction failed."; setError(message); if (groupId) setGroup(groupId, { status: "failed", error: message }); }
    finally { setBusy(false); }
  };
  const startManual = async (group?: Group) => {
    setBusy(true); setError("");
    try { const documents = group?.files.length ? await saveQuoteFiles(group.files) : []; const draft = blankQuote(id, documents); if (await saveDraft(draft)) { setActiveDraftId(draft.id); setStep("review"); setManualSourcesOpen(false); if (group) setGroup(group.id, { status: "completed" }); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Manual quotation could not be started."); }
    finally { setBusy(false); }
  };
  const extractReady = async () => {
    const ready = groups.filter(group => group.files.length && (group.status === "ready" || group.status === "failed"));
    setBatchBusy(true);
    try { for (const group of ready) await extract(group.files, undefined, undefined, group.id); }
    finally { setBatchBusy(false); }
  };
  const removeDraft = async (quote: Quote) => {
    if (!await confirm("Delete this quotation draft?", `${supplierName(state, quote)} and its unsaved review fields will be removed. Finalized quotations are unaffected.`, "Delete draft", true)) return;
    const result = await run({ type: "deleteQuoteDraft", id: quote.id });
    if (!result.ok) setError(result.message);
    else {
      const stillUsed = new Set(result.snapshot.quotes.flatMap(value => value.documents.map(document => document.fileId)));
      for (const document of quote.documents) if (document.fileId && !stillUsed.has(document.fileId)) void deleteLocalFile(document.fileId).catch(() => {});
      setError(""); if (activeDraftId === quote.id) setActiveDraftId("");
    }
  };
  const revise = async (quote: Quote) => {
    const draft: Quote = { ...structuredClone(quote), id: newId("quote"), supersedesId: quote.id, reviewStatus: "draft", version: (quote.version || 1) + 1, reviewedAt: undefined, supplierDetails: quote.supplierDetails || { name: supplierName(state, quote), address: "", tin: "", contactName: "", email: "", phone: "" }, lines: quote.lines?.map(line => ({ ...line, id: newId("offer") })), adjustments: quote.adjustments?.map(value => ({ ...value, id: newId("adjustment") })) };
    if (await saveDraft(draft)) { setActiveDraftId(draft.id); setStep("review"); }
  };
  const reanalyze = async (quote: Quote) => {
    try { const files: File[] = []; for (const document of quote.documents) if (document.fileId) { const blob = await readQuoteFile(document.fileId); if (!blob) throw new Error("The original quotation file is unavailable. Attach it again."); files.push(new File([blob], document.name, { type: document.type })); } if (!files.length) throw new Error("This quote has no original file. Create a manual revision instead."); await extract(files, quote.documents, quote.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Reanalysis failed."); }
  };
  const stage = async (quote: Quote, line: QuoteLine, quantity: number) => { const result = await run({ type: "stageAward", requestId: id, quoteId: quote.id, quoteLineId: line.id, quantity }); setError(result.ok ? "" : result.message); };
  const generate = async () => { if (!await confirm("Generate supplier PO drafts?", `${staged.length} staged awards will become purchase order drafts for review.`, "Generate PO drafts")) return; const result = await run({ type: "generateAwardPOs", requestId: id, reasons }); if (result.ok) { setStep("po"); setError(""); } else setError(result.message); };

  return <>
    <RecordHeader backHref={`/requests/${id}`} backLabel={request.ref} eyebrow="PROCUREMENT · QUOTATION REVIEW" title="Compare supplier quotations" badges={<Badge value={request.status}/>}/>
    <p className="muted">Review each supplier offer, confirm its MRF matches, allocate quantities, and prepare supplier purchase orders.</p>
    {request.status === "approved" && (request.correction || request.archive?.status === "pending") && <div className="callout warn"><strong>Purchasing is paused</strong><p>{request.correction ? "Procurement is waiting for a corrected MRF and its new Drive archive." : "The approved MRF is waiting for its Google Drive archive. Procurement or an Administrator can retry from the request page."}</p></div>}
    <nav className="procurement-steps" aria-label="Procurement steps">{(["review", "compare", "allocation", "po"] as const).map((value, index) => <button key={value} type="button" className={step === value ? "active" : ""} onClick={() => { setStep(value); setError(""); }}><span>{String(index + 1).padStart(2, "0")}</span>{({ review: "Upload & review", compare: "Compare", allocation: "Allocate", po: "PO preparation" })[value]}<small>{({ review: `${drafts.length} draft · ${finalized.length} finalized`, compare: `${finalized.length} suppliers`, allocation: `${staged.length} staged`, po: `${pos.length} POs` })[value]}</small></button>)}</nav>
    {step === "review" && <>
      {canEdit && <section className="panel"><h2 className="panel-title">Add supplier quotations</h2><p className="helper-note">Create one group for each supplier. Add PDF or image files in page order, then extract ready groups together or use Enter manually. Keep each supplier&apos;s files together.</p><div className="button-row"><button className="button secondary" type="button" onClick={() => setGroups(current => [...current, { id: newId("group"), files: [], status: "ready" }])}>+ Supplier quotation group</button><button className="button secondary" type="button" disabled={busy || batchBusy} onClick={() => { if (groups.some(group => group.files.length && group.status !== "completed")) setManualSourcesOpen(current => !current); else void startManual(); }}>Enter manually</button></div>
        {manualSourcesOpen && <div className="quote-manual-sources"><div className="panel-heading"><div><strong>Choose files for the manual draft</strong><p className="helper-note">Use an uploaded group to keep its original files with the quotation.</p></div><button type="button" className="text-link" onClick={() => setManualSourcesOpen(false)}>Cancel</button></div><div className="quote-manual-source-list">{groups.map((group, index) => group.files.length && group.status !== "completed" ? <button className="quote-manual-source" type="button" key={group.id} disabled={busy || batchBusy || group.status === "processing"} onClick={() => void startManual(group)}><strong>Supplier quotation {index + 1}</strong><span>{group.files.length} {group.files.length === 1 ? "file" : "files"}{group.status === "failed" ? " · AI extraction failed" : ""}</span></button> : null)}<button className="quote-manual-source" type="button" disabled={busy || batchBusy} onClick={() => void startManual()}><strong>Start without files</strong><span>Enter supplier details and offered lines yourself</span></button></div></div>}
        {groups.map((group, groupIndex) => <article className={`quote-upload-group status-${group.status} ${dragGroupId === group.id ? "is-dragging" : ""}`} key={group.id}><div className="quote-group-header"><div className="quote-group-heading"><span className="quote-group-number">{groupIndex + 1}</span><div><strong>Supplier quotation {groupIndex + 1}</strong><small>{group.files.length} {group.files.length === 1 ? "file" : "files"} · {group.status === "completed" ? "Draft created" : group.status === "failed" ? "Needs attention" : group.status === "processing" ? "AI is reading the files" : "Ready for extraction"}</small></div></div><div className="quote-group-actions">{group.status === "processing" ? <span className="quote-processing" role="status"><span className="quote-spinner" aria-hidden="true"/>Extracting</span> : <Badge value={group.status}/>}<button type="button" className="text-link" disabled={batchBusy || group.status === "processing"} onClick={() => setGroups(current => current.filter(value => value.id !== group.id))}>Remove group</button></div></div>
          {(group.status === "ready" || group.status === "failed") && !batchBusy && <div className="quote-group-drop" onDragEnter={event => { event.preventDefault(); enterDrop(group.id); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); leaveDrop(group.id); }} onDrop={event => { event.preventDefault(); clearDrop(group.id); addGroupFiles(group, Array.from(event.dataTransfer.files)); }}><span>Drop PDF or image files here</span><label className="button secondary file-button">Choose files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={event => { addGroupFiles(group, Array.from(event.target.files || [])); event.target.value = ""; }}/></label></div>}
          <ol className="quote-file-order">{group.files.map((file, index) => <li key={`${file.name}-${index}`}><span>{index + 1}. {file.name}</span>{!batchBusy && (group.status === "ready" || group.status === "failed") && <span className="button-row"><button type="button" aria-label={`Move ${file.name} earlier`} disabled={index === 0} onClick={() => setGroup(group.id, { files: group.files.map((value, position) => position === index - 1 ? file : position === index ? group.files[index - 1] : value) })}>↑</button><button type="button" aria-label={`Move ${file.name} later`} disabled={index === group.files.length - 1} onClick={() => setGroup(group.id, { files: group.files.map((value, position) => position === index + 1 ? file : position === index ? group.files[index + 1] : value) })}>↓</button><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setGroup(group.id, { files: group.files.filter((_, fileIndex) => fileIndex !== index) })}>×</button></span>}</li>)}</ol>
          {group.error && <p className="field-error" role="alert">{group.error}</p>}</article>)}
        <div className="quote-queue-footer"><span>{groups.filter(group => group.files.length && (group.status === "ready" || group.status === "failed")).length} quotation groups ready</span><button className="button primary" type="button" disabled={busy || batchBusy || !groups.some(group => group.files.length && (group.status === "ready" || group.status === "failed"))} onClick={() => void extractReady()}>{batchBusy ? "Extracting quotations…" : "Extract with AI"}</button></div>
      </section>}
      <section className="panel"><div className="panel-heading"><h2>Quotation review queue</h2>{drafts.length > 1 && <div className="button-row"><button className={`button secondary ${reviewMode === "focused" ? "is-selected" : ""}`} onClick={() => setReviewMode("focused")}>Focused</button><button className={`button secondary ${reviewMode === "all" ? "is-selected" : ""}`} onClick={() => setReviewMode("all")}>All suppliers</button></div>}</div>{!quotes.length && <Empty detail="Add a supplier quotation to start the review."/>}<div className="quote-source-list">{quotes.map(quote => {
        const details = <><strong>{supplierName(state, quote)} · {quote.ref || "Reference needed"}</strong><small>Version {quote.version || 1} · {quote.reviewStatus || "finalized (legacy)"} · {quote.extraction === "gemini" ? "AI extracted" : quote.extraction || "legacy"}</small><small>{quote.documents.length ? `${quote.documents.length} ${quote.documents.length === 1 ? "document" : "documents"} attached` : quote.reviewStatus === "draft" ? "Attach supplier file before finalizing" : "Legacy quotation · no original file"}</small>{quote.archive && <small>Drive archive: {quote.archive.status === "complete" ? "Complete" : quote.archive.error ? "Needs retry" : "Pending"}</small>}</>;
        return <article className={`quote-source ${activeDraft?.id === quote.id && quote.reviewStatus === "draft" ? "is-active" : ""}`} key={quote.id}>{quote.reviewStatus === "draft" && canEdit ? <button type="button" className="quote-source-main" aria-label={`Review draft for ${supplierName(state, quote)}`} onClick={() => { setActiveDraftId(quote.id); setReviewMode("focused"); }}>{details}<span aria-hidden="true" className="quote-source-arrow">→</span></button> : <div className="quote-source-main">{details}</div>}<div className="quote-source-actions">{quote.reviewStatus === "draft" && canEdit && <button type="button" className="text-link" onClick={() => void removeDraft(quote)}>Delete draft</button>}{quote.reviewStatus !== "draft" && canEdit && <><button type="button" className="button secondary" onClick={() => void revise(quote)}>Create revision</button><button type="button" className="text-link" onClick={() => void reanalyze(quote)}>Reanalyze</button></>}{quote.documents.length > 0 && <button type="button" className="button secondary" onClick={() => setPreviewQuote(quote)}>View documents</button>}{quote.archive?.status === "pending" && (state.role === "Procurement" || state.role === "Administrator") && <button type="button" className="button secondary" disabled={!!archivingQuoteId} onClick={() => void archiveQuote(quote)}>{archivingQuoteId === quote.id ? "Archiving…" : "Retry Drive archive"}</button>}{quote.archive?.files.map(file => <a className="text-link" href={file.url} target="_blank" rel="noopener noreferrer" key={file.driveFileId}>Drive: {file.name}</a>)}</div>{quote.archive?.error && <p className="field-error" role="alert">{quote.archive.error}</p>}</article>;
      })}</div></section>
      {canEdit && (reviewMode === "all" ? drafts : activeDraft ? [activeDraft] : []).map(draft => <QuoteDraftEditor key={draft.id} state={state} request={request} quote={draft} onSave={saveDraft} onAttach={files => attachDraftFiles(draft, files)} onRemoveDocument={fileId => removeDraftDocument(draft, fileId)} onFinalize={async () => { if (draft.documents.some(document => !document.fileId || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.type)) || !draft.documents.length) { setError("Attach the supplier quotation PDF or image before finalizing."); return; } for (const document of draft.documents) if (!await readQuoteFile(document.fileId!)) { setError(`The original quotation file ${document.name} is unavailable. Remove it and attach it again.`); return; } if (!await confirm(`Finalize ${supplierName(state, draft)} quotation?`, "The supplier files will be archived to Google Drive before awards can be made.", "Finalize quotation")) return; const result = await run({ type: "finalizeQuote", id: draft.id }); if (result.ok) { setActiveDraftId(""); setStep("compare"); const finalizedQuote = result.snapshot.quotes.find(value => value.id === draft.id); if (finalizedQuote) await archiveQuote(finalizedQuote, result.snapshot); } else setError(result.message); }}/>) }
    </>}
    {step === "compare" && <section className="panel"><h2 className="panel-title">Compare finalized offers</h2><p className="helper-note">Review offers by required MRF material. Procurement chooses awards in the next step.</p><Field label="Show MRF material"><select value={request.items.some(item => item.id === materialFilter) ? materialFilter : ""} onChange={event => setMaterialFilter(event.target.value)}><option value="">All materials</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{!finalized.length ? <Empty detail="Finalize at least one supplier quotation to compare offers."/> : <div className="material-comparison-list">{request.items.filter(item => !materialFilter || !request.items.some(value => value.id === materialFilter) || item.id === materialFilter).map(item => <article className={`material-comparison ${materialFilter === item.id ? "is-focused" : ""}`} key={item.id}><header><div><span className="eyebrow">MRF MATERIAL</span><h3>{item.name}</h3><small>{item.quantity} {item.unit} requested · {Math.max(0, item.quantity - ordered(item.id) - stagedFor(item.id))} unawarded</small></div></header><div className="table-frame"><table className="quote-material-table"><thead><tr><th>Supplier</th><th>Offered material</th><th>Quantity</th><th>Unit price</th><th>Difference</th></tr></thead><tbody>{finalized.flatMap(quote => { const offers = (quote.lines || []).filter(line => line.requestItemId === item.id); return offers.length ? offers.map(line => <tr key={line.id}><td><strong>{supplierName(state, quote)}</strong><small>{quote.ref} · v{quote.version || 1}</small></td><td>{line.description}{line.brand && <small>{line.brand}</small>}</td><td>{line.quantity * line.conversionFactor} {item.unit}</td><td><strong>{format(quote.currency, quoteLineTotal(line) / (line.quantity * line.conversionFactor))} / {item.unit}</strong></td><td>{line.varianceReason || "—"}</td></tr>) : [<tr key={quote.id}><td>{supplierName(state, quote)}</td><td colSpan={4} className="muted">Not quoted</td></tr>]; })}</tbody></table></div></article>)}</div>}</section>}
    {step === "allocation" && <><section className="panel"><h2 className="panel-title">MRF award coverage</h2><div className="quote-coverage">{request.items.map(item => <div key={item.id}><strong>{item.name}</strong><span>{ordered(item.id)} ordered · {stagedFor(item.id)} staged · {Math.max(0, item.quantity - ordered(item.id) - stagedFor(item.id))} remaining {item.unit}</span></div>)}</div></section>{finalized.filter(quote => quote.currency === "PHP" || !quote.currency).map(quote => <section className="panel" key={quote.id}><h2 className="panel-title">{supplierName(state, quote)} · {quote.ref}</h2><p className="helper-note">Award up to the remaining MRF and supplier-offered quantities. Unmatched lines stay outside the award.</p>{quote.lines?.filter(line => line.requestItemId).map(line => { const item = request.items.find(value => value.id === line.requestItemId); if (!item) return null; const existing = pendingFor(line.id); const usedOffer = pos.filter(po => po.status !== "rejected" && po.quoteId === quote.id).reduce((sum, po) => sum + (po.lines || []).filter(value => value.quoteLineId === line.id).reduce((count, value) => count + value.quantity, 0), 0); const max = Math.max(0, Math.min(item.quantity - ordered(item.id) - stagedFor(item.id) + existing, line.quantity * line.conversionFactor - usedOffer)); return <div className="quote-award-line" key={line.id}><div><strong>{item.name}</strong><small>{line.description} · {format(quote.currency, line.unitPrice / line.conversionFactor)} / {item.unit}</small><small>Up to {max} {item.unit} available</small></div><Field label={`Award quantity (${item.unit})`}><input type="number" min="0" max={max} step="any" disabled={!canEdit || quote.archive?.status === "pending"} value={existing} onChange={event => void stage(quote, line, num(event.target.value))}/></Field></div>; })}{!quote.lines && <p className="helper-note">Legacy quotation · existing linked POs remain available.</p>}{canEdit && staged.some(value => value.quoteId === quote.id) && <Field label="Supplier selection reason (optional)"><textarea value={reasons[quote.supplierId] || ""} onChange={event => setReasons(current => ({ ...current, [quote.supplierId]: event.target.value }))}/></Field>}</section>)}{!finalized.length && <section className="panel"><Empty detail="Finalize a PHP quotation to allocate materials."/></section>}{canEdit && <div className="form-actions"><button className="button primary" disabled={!staged.length} onClick={() => void generate()}>Generate supplier PO drafts</button></div>}</>}
    {step === "po" && <section className="panel"><h2 className="panel-title">Purchase orders from this MRF</h2><p className="helper-note">Confirm each draft&apos;s line discounts and quote adjustments before submitting it to Accounting. Item delivery locations come from the approved MRF.</p>{!pos.length && <Empty detail="Stage supplier awards, then generate PO drafts."/>}{pos.map(po => { const quote = quotes.find(value => value.id === po.quoteId); return <Link className="data-link" href={`/purchase-orders/${po.id}`} key={po.id}><span>{po.ref} · {quote ? supplierName(state, quote) : "Supplier"}</span><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></Link>; })}</section>}
    {step === "compare" && <BidComparisonReports requestId={id}/>}
    {staged.filter(value => !finalized.some(quote => quote.id === value.quoteId)).map(value => { const quote = quotes.find(item => item.id === value.quoteId); const offer = quote?.lines?.find(item => item.id === value.quoteLineId); return quote && offer && <div className="callout warn" key={value.id}>A staged award from {quote.ref} uses an earlier quotation revision. <button className="text-link" onClick={() => void stage(quote, offer, 0)}>Remove stale award</button></div>; })}
    <InlineError message={error}/>
    {previewQuote && <QuoteDocumentsDialog key={previewQuote.id} quote={previewQuote} onClose={() => setPreviewQuote(null)}/>}
    {confirmation}
  </>;
}
