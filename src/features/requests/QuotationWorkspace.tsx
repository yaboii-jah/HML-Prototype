"use client";
import { applyCommand } from "@/src/domain/commands";
import { moveQuotationServices } from "@/src/domain/quotation-services";
import { defaultQuotationFinancial } from "@/src/domain/pricing";
import { RowActions } from "@/src/components/ui/RowActions";

import { useArchive } from "@/src/app-state/ArchiveProvider";
import Link from "next/link";
import { poStatusLabel } from "@/src/domain/workflow";
import { useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, InlineError, RecordHeader } from "@/src/components/ui/Primitives";
import { useConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { MissingRecord } from "@/src/components/ui/States";
import { newId } from "@/src/domain/ids";
import { latestFinalizedQuotes } from "@/src/domain/procurement";
import { procurementReady } from "@/src/domain/request-archive";
import type { DemoSnapshot, DocumentRef, Quote, QuoteAdjustment, QuoteLine } from "@/src/domain/types";
import { QuoteDraftEditor } from "./QuoteDraftEditor";
import { QuotationReviewNavigation } from "./QuotationReviewNavigation";
import { QuoteDocumentsDialog } from "./QuoteDocumentsDialog";
import { deleteLocalFile, readQuoteFile, saveQuoteFiles } from "./quote-files";
import { syncFinalizedQuote } from "./archive-purchasing";
import { CompareAllocate } from "./CompareAllocate";
import { SupplierQuotationUploads, type QuotationUploadGroup as Group } from "./SupplierQuotationUploads";

type Step = "review" | "compare" | "po";
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const supplierName = (state: DemoSnapshot, quote: Quote) => quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier";
const blankQuote = (requestId: string, documents: DocumentRef[] = [], supplier = ""): Quote => ({ id: newId("quote"), mrfId: requestId, supplierId: "", ref: "", prices: {}, available: "", leadDays: 0, terms: "", documents, lines: [blankLine()], currency: "PHP", tax: 0, freight: 0, discount: 0, validity: "", extraction: "manual", reviewStatus: "draft", supplierDetails: { name: supplier, address: "", tin: "", contactName: "", email: "", phone: "" }, adjustments: [], quoteDate: "", deliveryTerms: "", quoteNotes: "", financial: defaultQuotationFinancial() });
function extractedAdjustments(value: Record<string, unknown>): QuoteAdjustment[] {
  const list = Array.isArray(value.adjustments) ? value.adjustments : [];
  if (list.length) return list.map((raw: Record<string, unknown>) => ({ id: newId("adjustment"), label: String(raw.label || "Adjustment"), kind: (["discount", "tax", "shipping", "other"].includes(String(raw.kind)) ? raw.kind : "other") as QuoteAdjustment["kind"], calculation: (raw.calculation === "percentage" ? "percentage" : "fixed"), value: num(raw.value) }));
  return [["tax", "Tax", value.tax], ["shipping", "Freight", value.freight], ["discount", "Discount", value.discount]].filter(row => num(row[2]) > 0).map(row => ({ id: newId("adjustment"), kind: row[0] as QuoteAdjustment["kind"], label: row[1] as string, calculation: "fixed", value: num(row[2]) }));
}

export function QuotationWorkspace({ id, initialMaterialId = "" }: { id: string; initialMaterialId?: string }) {
  const { perform } = useArchive();
  const { snapshot: state, run, beginOperation } = useDemo();
  const [step, setStep] = useState<Step>(initialMaterialId ? "compare" : "review");
  const [groups, setGroups] = useState<Group[]>([]);
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [reviewMode, setReviewMode] = useState<"focused" | "all">("focused");
  const [activeQuoteId, setActiveQuoteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number; label: string; completed: number; failed: number } | null>(null);
  const [error, setError] = useState("");
  const [bulkReport, setBulkReport] = useState<string[]>([]);
  const [bulkCounts, setBulkCounts] = useState<{ finalized: number; archived: number; pending: number; failed: number; skipped: number } | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const preflight = useRef(false);
  const { confirmAction, working, confirmation } = useConfirmedAction(setError);
  const [archivingQuoteId, setArchivingQuoteId] = useState("");
  if (!state) return null;
  const request = state.requests.find(value => value.id === id);
  if (!request) return <MissingRecord name="MRF" listHref="/requests"/>;
  const canEdit = state.role === "Procurement" && procurementReady(request);
  const quotes = state.quotes.filter(value => value.mrfId === id);
  const finalized = latestFinalizedQuotes(state, id);
  const drafts = quotes.filter(value => value.reviewStatus === "draft");
  const selectedQuote = quotes.find(value => value.id === activeQuoteId) || drafts[0] || finalized[0] || quotes[0];
  const pos = state.pos.filter(value => value.mrfId === id);
  const staged = state.pendingAwards.filter(value => value.requestId === id);
  const setGroup = (groupId: string, patch: Partial<Group>) => setGroups(current => current.map(group => group.id === groupId ? { ...group, ...patch } : group));
  const saveDraft = async (quote: Quote) => { const result = await run({ type: "saveQuoteDraft", quote }); if (!result.ok) setError(result.message); return result.ok; };
  const attachDraftFiles = async (quote: Quote, files: File[]) => {
    if (working || busy || batchBusy) return;
    const combined = [...quote.documents, ...files];
    const existingSizes = await Promise.all(quote.documents.map(async document => document.fileId ? (await readQuoteFile(document.fileId))?.size || 0 : 0));
    if (combined.length > 12 || files.some(file => !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) || [...existingSizes, ...files.map(file => file.size)].reduce((sum, size) => sum + size, 0) > 45 * 1024 * 1024) { setError("Use up to 12 PDF, JPG, PNG, or WebP files, at most 20 MB each and 45 MB total."); return; }
    try { const documents = await saveQuoteFiles(files); if (await saveDraft({ ...quote, documents: [...quote.documents, ...documents] })) setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The quotation files could not be attached."); }
  };
  const removeDraftDocument = async (quote: Quote, fileId: string) => {
    await confirmAction("Remove this quotation attachment?", `${quote.documents.find(document => document.fileId === fileId)?.name || "Attachment"} will be removed from ${supplierName(state, quote)}. Shared files remain available to other quotations.`, "Remove attachment", async () => {
    if (!await saveDraft({ ...quote, documents: quote.documents.filter(document => document.fileId !== fileId) })) return;
    const shared = state.quotes.some(value => value.id !== quote.id && value.documents.some(document => document.fileId === fileId));
    if (!shared) void deleteLocalFile(fileId).catch(() => {});
    setError("");
    }, true);
  };
  const archiveQuote = async (quote: Quote, snapshot: DemoSnapshot = state) => {
    setArchivingQuoteId(quote.id); setError("");
    try { const result = await perform(`quote-${quote.id}`, `Quotation ${quote.ref || quote.supplierDetails?.name || "files"}`, async progress => syncFinalizedQuote(snapshot, quote, await beginOperation({kind:"quote",id:quote.id}), progress)); if (!result.ok) setError(result.message); return result.ok; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Archive needs retry."); return false; }
    finally { setArchivingQuoteId(""); }
  };
  const addGroupFiles = (group: Group, files: File[]) => {
    if (working || busy || batchBusy) return;
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
      draft.financial = { ...defaultQuotationFinancial(), vatStatus: found.vatStatus === "NON-VAT" ? "NON-VAT" : "VAT", priceBasis: found.priceBasis === "exclusive" ? "exclusive" : "inclusive", vatRate: Number.isFinite(Number(found.vatRate)) && Number(found.vatRate) > 0 ? Number(found.vatRate) : 12, reviewed: false };
      const serviceIds = draft.lines!.filter((_, index) => (found.lines as Record<string, unknown>[])[index].classification === "Services").map(line => line.id);
      const normalizedDraft = moveQuotationServices(draft, serviceIds);
      if (!await saveDraft(normalizedDraft)) throw new Error("The extracted draft could not be saved.");
      setActiveQuoteId(draft.id); setStep("review"); if (groupId) setGroup(groupId, { status: "completed" }); return true;
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Quotation extraction failed."; setError(message); if (groupId) setGroup(groupId, { status: "failed", error: message }); return false; }
    finally { setBusy(false); }
  };
  const startManual = async (group?: Group) => {
    await confirmAction("Create a manual quotation draft?", `${group ? `${group.files.length} source files will be attached to the new draft.` : "A new draft will be created without source files."} Enter and review its supplier details before finalizing.`, "Create draft", async () => {
    setBusy(true); setError("");
    try { const documents = group?.files.length ? await saveQuoteFiles(group.files) : []; const draft = blankQuote(id, documents); if (await saveDraft(draft)) { setActiveQuoteId(draft.id); setStep("review"); if (group) setGroup(group.id, { status: "completed" }); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Manual quotation could not be started."); }
    finally { setBusy(false); }
    });
  };
  const extractReady = async () => {
    const ready = groups.filter(group => group.files.length && (group.status === "ready" || group.status === "failed"));
    if (!ready.length) return;
    await confirmAction("Extract supplier quotations with AI?", `${ready.length} supplier groups containing ${ready.reduce((count, group) => count + group.files.length, 0)} files will be sent for AI extraction and saved as quotation drafts for review.`, "Extract quotations", async () => {
    setBatchBusy(true);
    let completed = 0, failed = 0;
    try { for (const [index, group] of ready.entries()) {
      setExtractionProgress({ current: index + 1, total: ready.length, label: group.files.map(file => file.name).join(" · "), completed, failed });
      if (await extract(group.files, undefined, undefined, group.id)) completed++; else failed++;
    } }
    finally { setBatchBusy(false); setExtractionProgress(null); }
    });
  };
  const removeDraft = async (quote: Quote) => {
    await confirmAction("Delete this quotation draft?", `${supplierName(state, quote)} (${quote.ref || "no reference"}) and its saved draft fields will be removed. Finalized quotations remain available.`, "Delete draft", async () => {
    const result = await run({ type: "deleteQuoteDraft", id: quote.id });
    if (!result.ok) setError(result.message);
    else {
      const stillUsed = new Set(result.snapshot.quotes.flatMap(value => value.documents.map(document => document.fileId)));
      for (const document of quote.documents) if (document.fileId && !stillUsed.has(document.fileId)) void deleteLocalFile(document.fileId).catch(() => {});
      setError(""); if (activeQuoteId === quote.id) setActiveQuoteId("");
    }
    }, true);
  };
  const revise = async (quote: Quote) => {
    await confirmAction("Create a quotation revision?", `${supplierName(state, quote)} · ${quote.ref || "no reference"}: a new draft revision will copy this quotation. The finalized version remains available until the revision is finalized.`, "Create revision", async () => {
    const draft: Quote = { ...structuredClone(quote), financial: { ...(quote.financial || defaultQuotationFinancial()), reviewed: false }, id: newId("quote"), supersedesId: quote.id, reviewStatus: "draft", version: (quote.version || 1) + 1, reviewedAt: undefined, supplierDetails: quote.supplierDetails || { name: supplierName(state, quote), address: "", tin: "", contactName: "", email: "", phone: "" }, lines: quote.lines?.map(line => ({ ...line, id: newId("offer") })), adjustments: quote.adjustments?.map(value => ({ ...value, id: newId("adjustment") })) };
    if (await saveDraft(draft)) { setActiveQuoteId(draft.id); setStep("review"); }
    });
  };
  const reanalyze = async (quote: Quote) => {
    await confirmAction("Reanalyze this quotation with AI?", `${supplierName(state, quote)} · ${quote.ref || "no reference"}: ${quote.documents.length} original files will be sent to AI to create a new draft revision. The current finalized quotation remains available.`, "Reanalyze quotation", async () => {
    try { const files: File[] = []; for (const document of quote.documents) if (document.fileId) { const blob = await readQuoteFile(document.fileId); if (!blob) throw new Error("The original quotation file is unavailable. Attach it again."); files.push(new File([blob], document.name, { type: document.type })); } if (!files.length) throw new Error("This quote has no original file. Create a manual revision instead."); await extract(files, quote.documents, quote.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Reanalysis failed."); }
    });
  };
  const removeGroup = async (group: Group, position: number) => {
    const remove = () => setGroups(current => current.filter(value => value.id !== group.id));

    await confirmAction("Remove this supplier upload group?", `Supplier quotation ${position + 1} and its ${group.files.length} queued files will be removed from the upload list. Any quotation draft already created from them remains available.`, "Remove group", remove, true);
  };
  const removeGroupFile = async (group: Group, position: number) => {
    await confirmAction("Remove this queued file?", `${group.files[position].name} will be removed from this supplier's upload group.`, "Remove file", () => setGroup(group.id, { files: group.files.filter((_, index) => index !== position) }), true);
  };
  const retryArchive = (quote: Quote) => confirmAction("Retry quotation Drive archive?", `${supplierName(state, quote)} · ${quote.ref || "no reference"}: retry archiving ${quote.documents.length} original supplier files to the project folder.`, "Retry archive", () => archiveQuote(quote));
  const finalize = (draft: Quote) => confirmAction(`Finalize ${supplierName(state, draft)} quotation?`, `${draft.ref || "No reference"} · ${draft.documents.length} supplier files. This finalizes the quotation and archives its source files to Google Drive before awards can be made.`, "Finalize quotation", async () => {
    if (draft.documents.some(document => !document.fileId || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.type)) || !draft.documents.length) { setError("Attach the supplier quotation PDF or image before finalizing."); return; }
    for (const document of draft.documents) if (!await readQuoteFile(document.fileId!)) { setError(`The original quotation file ${document.name} is unavailable. Remove it and attach it again.`); return; }
    const result = await run({ type: "finalizeQuote", id: draft.id });
    if (result.ok) { setActiveQuoteId(draft.id); if (!result.snapshot.quotes.some(value => value.mrfId === id && value.reviewStatus === "draft")) setStep("compare"); const finalizedQuote = result.snapshot.quotes.find(value => value.id === draft.id); if (finalizedQuote) await archiveQuote(finalizedQuote, result.snapshot); } else setError(result.message);
  });

  const finalizeReady = async () => {
    if (!canEdit || working || busy || batchBusy || preflight.current) return;
    preflight.current = true; setPreflighting(true);
    let preview = state;
    const eligible: Quote[] = [], skipped: string[] = [];
    try { for (const draft of drafts) {
      const name = supplierName(state, draft);
      const checked = applyCommand(preview, { type: "finalizeQuote", id: draft.id });
      if (!checked.ok) { skipped.push(`${name}: ${checked.message}`); continue; }
      let missing = "";
      for (const document of draft.documents) {
        if (!document.fileId || !await readQuoteFile(document.fileId).catch(() => null)) { missing = `Original file unavailable: ${document.name}`; break; }
      }
      if (missing) { skipped.push(`${name}: ${missing}`); continue; }
      eligible.push(draft); preview = checked.snapshot;
    } } finally { preflight.current = false; setPreflighting(false); }
    setBulkReport(skipped); setBulkCounts(null);
    if (!eligible.length) { setError("No drafts are ready. Complete the listed review items first."); return; }
    await confirmAction(`Finalize ${eligible.length} ready drafts?`, `${eligible.map(value => supplierName(state, value)).join(" · ")}\n${skipped.length} draft(s) need further review. Each finalized quotation is archived separately; failed archives remain retryable.`, "Finalize ready drafts", async () => {
      const report = [...skipped];
      const counts = { finalized: 0, archived: 0, pending: 0, failed: 0, skipped: skipped.length };
      for (const [index, draft] of eligible.entries()) {
        const result = await run({ type: "finalizeQuote", id: draft.id });
        if (!result.ok) { counts.failed++; report.push(`${supplierName(state, draft)}: ${result.message}`); setBulkReport([...report]); if (result.message.includes("account changed")) { counts.skipped += eligible.length - index - 1; setBulkCounts({ ...counts }); break; } setBulkCounts({ ...counts }); continue; }
        const quote = result.snapshot.quotes.find(value => value.id === draft.id)!;
        counts.finalized++;
        const archived = await archiveQuote(quote, result.snapshot);
        if (archived) counts.archived++; else counts.pending++;
        report.push(`${supplierName(state, draft)}: finalized · ${archived ? "archived" : "archive needs retry"}`);
        setBulkReport([...report]); setBulkCounts({ ...counts });
      }
    });
  };

  const quotationSecondaryActions = (quote: Quote) => {
    const actions = [];
    if (quote.reviewStatus !== "draft" && canEdit) {
      actions.push(<button key="revision" type="button" className="button secondary" disabled={working} onClick={() => void revise(quote)}>Create revision</button>);
      actions.push(<button key="reanalyze" type="button" className="button secondary" disabled={working} onClick={() => void reanalyze(quote)}>Reanalyze</button>);
    }
    if (quote.archive?.status === "pending" && (state.role === "Procurement" || state.role === "Administrator")) actions.push(<button key="retry" type="button" className="button secondary" disabled={working || !!archivingQuoteId} onClick={() => void retryArchive(quote)}>{archivingQuoteId === quote.id ? "Archiving?" : "Retry Drive archive"}</button>);
    for (const file of quote.archive?.files || []) actions.push(<a className="button secondary" href={file.url} target="_blank" rel="noopener noreferrer" key={file.driveFileId}>Drive: {file.name}</a>);
    return actions.length > 1 ? <RowActions><div className="quote-source-actions">{actions}</div></RowActions> : actions[0] || null;
  };

  return <>
    <fieldset className="quotation-operation-fields" disabled={working || preflighting}>
    <RecordHeader backHref={`/requests/${id}`} backLabel={request.ref} eyebrow="PROCUREMENT · QUOTATION REVIEW" title="Compare supplier quotations" badges={<Badge value={request.status}/>}/>
    <p className="muted">Review each supplier offer, confirm its MRF matches, allocate quantities, and prepare supplier purchase orders.</p>
    {request.status === "approved" && (request.correction || request.archive?.status === "pending") && <div className="callout warn"><strong>Purchasing is paused</strong><p>{request.correction ? "Procurement is waiting for a corrected MRF and its new Drive archive." : "The approved MRF is waiting for its Google Drive archive. Procurement or an Administrator can retry from the request page."}</p></div>}
    <nav className="procurement-steps" aria-label="Procurement steps">{(["review", "compare", "po"] as const).map((value, index) => <button key={value} type="button" className={step === value ? "active" : ""} onClick={() => { setStep(value); setError(""); }}><span>{String(index + 1).padStart(2, "0")}</span>{({ review: "Upload & review", compare: "Compare & allocate", po: "PO preparation" })[value]}<small>{({ review: `${drafts.length} draft · ${finalized.length} finalized`, compare: `${finalized.length} suppliers · ${staged.length} saved awards`, po: `${pos.length} POs` })[value]}</small></button>)}</nav>
    {step === "review" && <>
      {canEdit && <SupplierQuotationUploads groups={groups} locked={working || busy || batchBusy} extracting={batchBusy} progress={extractionProgress} onAdd={() => { const group: Group = { id: newId("group"), files: [], status: "ready" }; setGroups(current => [...current, group]); return group.id; }} onFiles={addGroupFiles} onOrder={(group, files) => setGroup(group.id, { files })} onRemove={removeGroup} onRemoveFile={removeGroupFile} onManual={startManual} onExtract={extractReady}/>}
      {canEdit && drafts.length > 0 && <div className="qa-bulk-toolbar"><p className="helper-note">{drafts.length} draft(s) remain. Finalized quotations can already be compared.</p><button className="button secondary" type="button" disabled={working || busy || batchBusy} onClick={() => void finalizeReady()}>Finalize ready drafts</button></div>}
      {preflighting && <p className="qa-upload-status" role="status"><span className="qa-spinner" aria-hidden="true"/> Checking drafts and original files…</p>}
      {bulkCounts && <p role="status">{bulkCounts.finalized} finalized · {bulkCounts.archived} archived · {bulkCounts.pending} archives need retry · {bulkCounts.failed} failed · {bulkCounts.skipped} skipped</p>}
      {bulkReport.length > 0 && <details className="subform" open><summary>Bulk finalization results</summary><ul aria-live="polite">{bulkReport.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
      {!quotes.length ? <section className="panel"><Empty detail="Add a supplier quotation to start the review."/></section> : <>
        <QuotationReviewNavigation entries={quotes.map(quote => ({ id: quote.id, name: supplierName(state, quote), ref: quote.ref, version: quote.version || 1, status: quote.reviewStatus || "finalized" }))} current={selectedQuote.id} mode={reviewMode} disabled={working} onSelect={value => { setActiveQuoteId(value); setReviewMode("focused"); }} onMode={setReviewMode}/>
        {(reviewMode === "all" ? quotes : [selectedQuote]).map(quote => <QuoteDraftEditor key={quote.id} state={state} request={request} quote={quote} onSave={saveDraft} onAttach={files => attachDraftFiles(quote, files)} onRemoveDocument={fileId => removeDraftDocument(quote, fileId)} disabled={working} readOnly={!canEdit || quote.reviewStatus !== "draft"} compact={reviewMode === "all"} onConfirmAction={confirmAction} onFinalize={() => finalize(quote)} actions={<>
          {quote.documents.length > 0 && <button type="button" className="button secondary" onClick={() => setPreviewQuote(quote)}>View documents</button>}
          {quote.reviewStatus === "draft" && canEdit && <button type="button" className="button danger-outline" disabled={working} onClick={() => void removeDraft(quote)}>Delete draft</button>}
          {quotationSecondaryActions(quote)}
          {quote.archive?.error && <span className="field-error">{quote.archive.error}</span>}
        </>}/>) }
      </>}
    </>}
    <div hidden={step !== "compare"}>{drafts.length > 0 && <p className="callout warn">{drafts.length} quotation draft(s) still need review. Comparison includes current finalized quotations.</p>}<CompareAllocate state={state} request={request} initialMaterialId={initialMaterialId} canEdit={canEdit} working={working} confirmAction={confirmAction} onGenerated={() => { setStep("po"); setError(""); }} onReview={quote => { setActiveQuoteId(quote.id); setReviewMode("focused"); setStep("review"); }} onPreview={setPreviewQuote}/></div>
    {step === "po" && <section className="panel"><h2 className="panel-title">Purchase orders from this MRF</h2><p className="helper-note">Confirm each draft&apos;s line discounts and quote adjustments before submitting it to Accounting. Item delivery locations come from the approved MRF.</p>{!pos.length && <Empty detail="Stage supplier awards, then generate PO drafts."/>}{pos.map(po => { const quote = quotes.find(value => value.id === po.quoteId); return <Link className="data-link" href={`/purchase-orders/${po.id}`} key={po.id}><span>{po.ref} · {state.suppliers.find(value => value.id === po.supplierId)?.name || (quote ? supplierName(state, quote) : "Supplier")}</span><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></Link>; })}</section>}
    <InlineError message={error}/>
    </fieldset>
    {previewQuote && <QuoteDocumentsDialog key={previewQuote.id} quote={previewQuote} onClose={() => setPreviewQuote(null)}/>}
    {confirmation}
  </>;
}
