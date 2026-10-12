"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { adjustmentClassification } from "@/src/domain/expense-classification";
import { CollapsibleSection, revealField } from "@/src/components/ui/CollapsibleSection";
import { RegisterFrame } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { MaterialDetailsRow, MaterialDetailsTrigger } from "@/src/components/ui/MaterialDetails";
import { Badge, Field } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import type { ConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { foreignQuotationMessage, quotationCurrency, quoteReviewIssues } from "@/src/domain/procurement";
import { quotationLineAmount } from "@/src/domain/pricing";
import { quotationReviewMoney, quotationReviewSummary } from "./quotation-review-summary";
import { quoteTotal } from "@/src/domain/selectors";
import { QuotationFinancialConfirmation, QuotationFinancialFields, QuotationReviewSummary } from "./QuotationFinancialFields";
import { moveQuotationServices } from "@/src/domain/quotation-services";
import { quotationMatchReview } from "./quotation-match-review";
import { QuoteSourcePanel, useWideQuotationSource } from "./QuoteSourcePreview";
import { QuoteDocumentsDialog } from "./QuoteDocumentsDialog";
import type { DemoSnapshot, MRF, Quote, QuoteAdjustment, QuoteLine, SupplierQuoteDetails } from "@/src/domain/types";

type Props = { state: DemoSnapshot; request: MRF; quote: Quote; onSave: (quote: Quote) => Promise<boolean>; onFinalize: () => Promise<void>; onAttach: (files: File[]) => Promise<void>; onRemoveDocument: (fileId: string) => Promise<void>; onConfirmAction: ConfirmedAction; disabled?: boolean; readOnly?: boolean; compact?: boolean; actions?: ReactNode; documentError?: string };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (currency: string | undefined, value: number) => currency === "PHP" || !currency ? money(value) : `${currency} ${value.toFixed(2)}`;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const emptySupplier = (): SupplierQuoteDetails => ({ name: "", address: "", tin: "", contactName: "", email: "", phone: "" });

export function QuoteDraftEditor({ state, request, quote, onSave, onFinalize, onAttach, onRemoveDocument, onConfirmAction, disabled = false, readOnly = false, compact = false, actions, documentError = "" }: Props) {
  const root = useRef<HTMLElement>(null), detailFocus = useRef<string | null>(null), detailsInvoker = useRef<string | null>(null);
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(1), [size, setSize] = useState(25);
  const wideSource = useWideQuotationSource();
  const [sourceHidden, setSourceHidden] = useState(false), [expandedSource, setExpandedSource] = useState<number | null>(null);
  const [matchReport, setMatchReport] = useState<{ message: string; skipped: string[]; error?: boolean } | null>(null);
  const latestReview = useRef({ state, request, quote, readOnly, onSave });
  useEffect(() => { latestReview.current = { state, request, quote, readOnly, onSave }; }, [state, request, quote, readOnly, onSave]);
  const issuesId = useId(), issuesPanel = useRef<HTMLDivElement>(null), issuesTrigger = useRef<HTMLButtonElement>(null);
  const navigatingIssue = useRef(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const lines = quote.lines || [], issues = quoteReviewIssues(state, quote), editable = !readOnly && !disabled;
  const fieldId = (name: string) => `quote-${quote.id}-${name}`;
  const lineFieldId = (id: string, name: string) => fieldId(`${id}-${name}`);
  const locations = issues.map(message => {
    const index = /^Line (\d+):/.exec(message), offer = index ? lines[Number(index[1]) - 1] : undefined;
    let field = "total", secondary = false;
    if (offer) {
      if (message.includes("description, positive quantity")) field = !offer.description.trim() ? "description" : !(offer.quantity > 0) ? "quantity" : !offer.unit.trim() ? "unit" : "unitPrice";
      else if (message.includes("select a valid MRF")) field = "requestItemId";
      else if (message.includes("confirm the suggested")) field = "matchConfirmed";
      else { secondary = true; field = message.includes("unit conversion") ? "conversionFactor" : message.includes("unit difference") ? "varianceReason" : message.includes("discount") ? "discountValue" : message.includes("tax rate") ? "taxRate" : "discrepancyReason"; }
    } else field = message.includes("VAT") ? "financial" : message.includes("supplier name") ? "supplierName" : message.includes("quotation reference") ? "ref" : message.includes("supplier quotation PDF") ? "documents" : message.includes("Only PHP") ? "currency" : message.includes("offered line") ? "materials" : message.includes("adjustment") ? "adjustments" : "total";
    return { message, offer, field, secondary };
  });
  const reviewIds = new Set(locations.flatMap(location => location.offer ? [location.offer.id] : []));
  const query = search.trim().toLowerCase();
  const filtered = lines.map((offer, index) => ({ offer, index })).filter(({ offer }) => (!query || `${offer.description} ${offer.supplierItemCode || ""} ${offer.brand} ${offer.specification}`.toLowerCase().includes(query)) && (filter === "all" || filter === "review" && reviewIds.has(offer.id) || filter === "unmatched" && !offer.requestItemId));
  const pageCount = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.min(page, pageCount), start = (currentPage - 1) * size, shown = filtered.slice(start, start + size);
  const financialSummary = quotationReviewSummary(quote);
  const activeLine = lines.find(offer => offer.id === detailsId);
  const matches = quotationMatchReview(state, request, quote), eligibleCount = matches.filter(match => match.eligible).length;
  const showSource = !compact && wideSource && !sourceHidden;
  const patch = (fields: Partial<Quote>) => { if (editable) void onSave({ ...quote, ...fields }); };
  const supplier = (fields: Partial<SupplierQuoteDetails>) => patch({ supplierDetails: { ...(quote.supplierDetails || emptySupplier()), ...fields } });
  const line = (id: string, fields: Partial<QuoteLine>) => patch({ lines: lines.map(value => value.id === id ? { ...value, ...fields, discrepancyReason: ["quantity", "unitPrice", "discountType", "discountValue", "taxRate", "printedTotal"].some(key => key in fields) ? "" : fields.discrepancyReason ?? value.discrepancyReason } : value) });
  const adjustment = (id: string, fields: Partial<QuoteAdjustment>) => patch({ adjustments: (quote.adjustments || []).map(value => value.id === id ? { ...value, ...fields } : value) });
  const closeDetails = () => { setDetailsId(null); detailFocus.current = null; };
  const openDetails = (id: string) => { detailFocus.current = null; detailsInvoker.current = id; detailsTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetailsId(id); };
  useEffect(() => {
    if (!detailsId || !detailFocus.current) return;
    const frame = requestAnimationFrame(() => revealField(document.getElementById(detailFocus.current!)));
    return () => cancelAnimationFrame(frame);
  }, [detailsId]);
  useEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(pendingFocus);
      if (target) { revealField(target); setPendingFocus(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, currentPage, lines.length, search, filter]);
  useEffect(() => {
    if (!issuesOpen) return;
    const position = () => {
      const panel = issuesPanel.current, trigger = issuesTrigger.current;
      if (!panel || !trigger || !panel.matches(":popover-open")) return;
      const anchor = trigger.getBoundingClientRect(), rect = panel.getBoundingClientRect();
      panel.style.left = Math.max(8, Math.min(innerWidth - rect.width - 8, anchor.right - rect.width)) + "px";
      const below = anchor.bottom + 8;
      panel.style.top = Math.max(8, Math.min(innerHeight - rect.height - 8, below + rect.height <= innerHeight - 8 ? below : anchor.top - rect.height - 8)) + "px";
    };
    position();
    issuesPanel.current?.querySelector<HTMLButtonElement>("li button")?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [issuesOpen]);
  const jump = (location: typeof locations[number]) => {
    navigatingIssue.current = true;
    issuesPanel.current?.hidePopover();
    if (location.offer) {
      setSearch(""); setFilter("all"); setPage(Math.floor(lines.findIndex(offer => offer.id === location.offer!.id) / size) + 1);
      if (location.secondary) { detailsTrigger.current = null; detailFocus.current = lineFieldId(location.offer.id, location.field); detailsInvoker.current = location.offer.id; setDetailsId(location.offer.id); }
      else setPendingFocus(lineFieldId(location.offer.id, location.field));
    } else if (location.field === "documents") setExpandedSource(0);
    else setPendingFocus(fieldId(location.field));
  };
  const addLine = async () => {
    if (!editable) return;
    const added = blankLine();
    if (await onSave({ ...quote, lines: [...lines, added] })) { setSearch(""); setFilter("all"); setPage(Math.floor(lines.length / size) + 1); setPendingFocus(lineFieldId(added.id, "description")); }
  };
  const removeLine = (offer: QuoteLine) => onConfirmAction("Remove this offered line?", `${offer.description || "Unnamed offered material"} will be removed from ${quote.supplierDetails?.name || "this quotation"}.`, "Remove line", async () => { if (await onSave({ ...quote, lines: lines.filter(value => value.id !== offer.id) }) && detailsId === offer.id) closeDetails(); }, true);
  const addAdjustment = async () => {
    if (!editable) return;
    const added: QuoteAdjustment = { id: newId("adjustment"), label: "", kind: "other", calculation: "fixed", value: 0 };
    if (await onSave({ ...quote, adjustments: [...(quote.adjustments || []), added] })) setPendingFocus(fieldId(`adjustment-${added.id}-label`));
  };
  const confirmMatches = () => onConfirmAction("Confirm eligible item matches?", `Confirm ${eligibleCount} suggested item links after checking the supplier source. These lines have matching quantities and units. Partial quantities, uncertain matches and lines with discrepancies stay for individual review. This confirms item links only; review prices separately.`, "Confirm item matches", async () => {
    const current = latestReview.current;
    if (current.readOnly || current.quote.reviewStatus !== "draft") return;
    const review = quotationMatchReview(current.state, current.request, current.quote);
    const ids = new Set(review.filter(match => match.eligible).map(match => match.id));
    const skipped = review.filter(match => !match.confirmed && !match.eligible).map(match => `Line ${match.number}: ${match.reasons.join("; ")}.`);
    if (!ids.size) { setMatchReport({ message: "No eligible matches remain. Review the individual lines below.", skipped }); return; }
    try {
      const saved = await current.onSave({ ...current.quote, lines: current.quote.lines?.map(offer => ids.has(offer.id) ? { ...offer, matchConfirmed: true } : offer) });
      setMatchReport({ message: saved ? `${ids.size} item ${ids.size === 1 ? "match" : "matches"} confirmed. ${skipped.length} ${skipped.length === 1 ? "line needs" : "lines need"} individual review.` : "Item matches could not be saved. Please try again.", skipped, error: !saved });
    } catch { setMatchReport({ message: "Item matches could not be saved. Please try again.", skipped, error: true }); }
  });
  const nextCell = (event: KeyboardEvent<HTMLInputElement>, id: string, field: string) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const next = filtered.findIndex(({ offer }) => offer.id === id) + 1;
    if (next > 0 && next < filtered.length) { setPage(Math.floor(next / size) + 1); setPendingFocus(lineFieldId(filtered[next].offer.id, field)); }
  };
  const headerField = (name: string, label: string, value: string | number, change: (value: string) => void, type = "text") => <Field key={name} label={label}><input id={fieldId(name)} type={type} min={type === "number" ? 0 : undefined} value={value} onChange={event => change(event.target.value)}/></Field>;
  return <>
    <section ref={root} id={`quote-panel-${quote.id}`} className={`panel quote-review quote-editor-panel${readOnly ? " is-readonly" : ""}`} data-quotation-id={quote.id}>
      <header className="quote-editor-header"><div className="quote-editor-title"><div><h2>{quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier"}</h2><Badge>{quote.reviewStatus || "finalized"}</Badge><Badge>{quote.extraction === "gemini" ? "AI extracted" : quote.extraction === "manual" ? "Manual entry" : "Legacy"}</Badge></div><p title={quote.documents.map(document => document.name).join(" · ")}>{quote.documents[0]?.name || "No supplier files attached"}{quote.documents.length > 1 ? ` · +${quote.documents.length - 1} files` : ""} · {quote.ref || "Reference needed"} · v{quote.version || 1}</p><small>{readOnly ? "Read-only quotation" : "Draft saved automatically"}</small></div><div className="quote-editor-header-actions">{!readOnly && <><button type="button" data-add-line className="button secondary" disabled={disabled} onClick={() => void addLine()}>+ Add line</button><span className="quote-review-count-status" role="status">{issues.length > 0 ? issues.length + " review " + (issues.length === 1 ? "item" : "items") + " before finalizing" : "Quotation ready to finalize"}</span>{issues.length > 0 && <button ref={issuesTrigger} className="button quote-review-trigger" type="button" popoverTarget={issuesId} aria-expanded={issuesOpen} aria-controls={issuesId}>{issues.length} review {issues.length === 1 ? "item" : "items"}</button>}</>}{actions}</div></header>
      {!readOnly && issues.length > 0 && <div ref={issuesPanel} id={issuesId} popover="auto" className="quote-editor-issues" aria-labelledby={issuesId + "-title"} onBeforeToggle={event => {
        if (event.newState === "open") navigatingIssue.current = false;
        else if (!navigatingIssue.current) issuesTrigger.current?.focus({ preventScroll: true });
      }} onToggle={event => setIssuesOpen(event.newState === "open")}><strong id={issuesId + "-title"}>{issues.length} review {issues.length === 1 ? "item" : "items"} before finalizing</strong><ul>{locations.map((location, index) => <li key={location.message + "-" + index}><button type="button" className="text-link" onClick={() => jump(location)}>{location.message}</button></li>)}</ul></div>}
      {quotationCurrency(quote.currency) !== "PHP" && <p id={fieldId("currency")} tabIndex={-1} className="callout bad" role={readOnly ? undefined : "alert"}>{readOnly ? `Recorded currency: ${quote.currency}. This historical quotation is read-only.` : `${foreignQuotationMessage} Detected currency: ${quote.currency}.`}</p>}
      <CollapsibleSection key={`${quote.id}-${compact}`} className="quote-core-details" title="Supplier and quotation details" defaultOpen={false}><fieldset className="quotation-operation-fields" disabled={!editable}><div className="quote-editor-field-grid">
        {headerField("supplierName", "Supplier name", quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "", value => supplier({ name: value }))}
        {headerField("ref", "Quotation reference", quote.ref, value => patch({ ref: value }))}
        {headerField("quoteDate", "Quotation date", quote.quoteDate || "", value => patch({ quoteDate: value }), "date")}
        {headerField("terms", "Payment terms", quote.terms, value => patch({ terms: value }))}
        {headerField("validity", "Valid until", quote.validity || "", value => patch({ validity: value }), "date")}
        {headerField("available", "Availability", quote.available, value => patch({ available: value }))}
        {headerField("leadDays", "Lead days", quote.leadDays, value => patch({ leadDays: num(value) }), "number")}
        {headerField("address", "Supplier address", quote.supplierDetails?.address || "", value => supplier({ address: value }))}
        {headerField("tin", "Supplier TIN", quote.supplierDetails?.tin || "", value => supplier({ tin: value }))}
        {headerField("contactName", "Contact name", quote.supplierDetails?.contactName || "", value => supplier({ contactName: value }))}
        {headerField("email", "Email", quote.supplierDetails?.email || "", value => supplier({ email: value }), "email")}
        {headerField("phone", "Phone", quote.supplierDetails?.phone || "", value => supplier({ phone: value }))}
        {headerField("deliveryTerms", "Delivery terms", quote.deliveryTerms || "", value => patch({ deliveryTerms: value }))}
        <Field label="Quotation notes"><textarea id={fieldId("quoteNotes")} value={quote.quoteNotes || ""} onChange={event => patch({ quoteNotes: event.target.value })}/></Field>
      </div></fieldset></CollapsibleSection>
      <div className={`quote-material-workspace${showSource ? " has-source" : ""}`}>
        <div className="quote-material-sheet">
          <div id={fieldId("materials")} tabIndex={-1} className="quote-editor-material-heading"><div><h3>Offered materials · {lines.length}</h3><p className="helper-note">Check the supplier source, then confirm each item link. Review quantities and prices separately.</p></div><div className="quote-material-review-actions">{!readOnly && <button type="button" className="button secondary" disabled={!editable || !eligibleCount} onClick={() => void confirmMatches()}>Confirm eligible matches ({eligibleCount})</button>}{!compact && wideSource && sourceHidden && <button type="button" className="button secondary" onClick={() => setSourceHidden(false)}>Show source</button>}</div></div>
          <div className="quote-editor-material-tools"><input type="search" aria-label={`Search materials in ${quote.ref || quote.id}`} placeholder="Search materials, codes or specifications" value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }}/><select aria-label={`Filter material review in ${quote.ref || quote.id}`} value={filter} disabled={disabled} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">All materials</option><option value="review">Needs review</option><option value="unmatched">Unmatched / extra</option></select></div>
          {matchReport && <div className={`quote-match-report${matchReport.error ? " is-error" : ""}`}><p role={matchReport.error ? "alert" : "status"}>{matchReport.message}</p>{matchReport.skipped.length > 0 && <details><summary>Why some items need individual review</summary><ul>{matchReport.skipped.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}</div>}
          <RegisterFrame embedded className="quote-material-register" scrollClassName="quote-editor-lines" resetKey={`${quote.id}-${currentPage}-${size}-${search}-${filter}`} footer={<div className="register-footer quote-editor-pagination">{lines.length > 10 && <label>Per page <select aria-label={`Materials per page for ${quote.id}`} value={size} disabled={disabled} onChange={event => { setSize(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="25">25</option></select></label>}<span>{filtered.length ? start + 1 : 0}–{Math.min(start + size, filtered.length)} of {filtered.length} materials</span>{pageCount > 1 && <div><button type="button" className="button secondary" aria-label={`Previous material page for ${quote.id}`} disabled={disabled || currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage} / {pageCount}</span><button type="button" className="button secondary" aria-label={`Next material page for ${quote.id}`} disabled={disabled || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}</div>}>
            <table><colgroup>{[36, 300, 70, 64, 84, 100, 136, 110].map((width, index) => <col key={index} style={{ width }}/>)}</colgroup><thead><tr><th>#</th><th>Material</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Amount</th><th>Item match</th><th>Actions</th></tr></thead><tbody>{shown.map(({ offer, index }) => {
              const problems = locations.filter(location => location.offer?.id === offer.id);
              const attention = problems.filter(problem => problem.field !== "matchConfirmed");
              const requested = request.items.find(item => item.id === offer.requestItemId);
              const invalidDescription = !offer.description.trim(), invalidQuantity = !Number.isFinite(offer.quantity) || offer.quantity <= 0, invalidUnit = !offer.unit.trim(), invalidPrice = !Number.isFinite(offer.unitPrice) || offer.unitPrice <= 0;
              const printedDifference = offer.printedTotal != null && Math.abs(quotationLineAmount(quote, offer) - offer.printedTotal) > 0.01;
              const unitDifference = requested && offer.unit.trim().toLowerCase() !== requested.unit.trim().toLowerCase();
              return <MaterialDetailsRow key={offer.id} data-line-id={offer.id} disabled={disabled} className={!readOnly && (attention.length > 0 || printedDifference || unitDifference) ? "needs-review" : undefined} onOpen={() => openDetails(offer.id)}>
                <td data-label="#"><MaterialDetailsTrigger className="quote-line-number" disabled={disabled} aria-label={`View material details for line ${index + 1}: ${offer.description || "Unnamed material"}`} onClick={() => openDetails(offer.id)}>{index + 1}</MaterialDetailsTrigger></td>
                <td data-label="Material"><Field label="Supplier description"><textarea id={lineFieldId(offer.id,"description")} rows={2} disabled={!editable} value={offer.description} aria-describedby={!readOnly && invalidDescription ? lineFieldId(offer.id,"description-error") : undefined} aria-invalid={!readOnly && invalidDescription || undefined} onChange={event => line(offer.id, { description: event.target.value })}/></Field>{!readOnly && invalidDescription && <small id={lineFieldId(offer.id,"description-error")} className="field-error">Enter the material description.</small>}<label className="quote-requested-item"><span>Requested item</span><select id={lineFieldId(offer.id,"requestItemId")} aria-label={`Requested item for line ${index + 1}`} disabled={!editable} value={offer.requestItemId} onChange={event => line(offer.id, { requestItemId: event.target.value, matchConfirmed: false })}><option value="">Unmatched / extra</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{offer.supplierItemCode && <small className="quote-supplier-code">Code: {offer.supplierItemCode}</small>}{!readOnly && problems.some(problem => problem.field === "requestItemId") && <small className="field-error">Choose a valid requested item.</small>}</td>
                <td data-label="Quantity" className="quote-number-cell"><Field label="Quoted quantity"><input id={lineFieldId(offer.id,"quantity")} type="number" min="0" step="any" disabled={!editable} value={offer.quantity || ""} aria-describedby={!readOnly && invalidQuantity ? lineFieldId(offer.id,"quantity-error") : undefined} aria-invalid={!readOnly && invalidQuantity || undefined} onChange={event => line(offer.id, { quantity: num(event.target.value) })} onKeyDown={event => nextCell(event, offer.id, "quantity")}/></Field>{requested && offer.quantity * offer.conversionFactor !== requested.quantity && <small className="quote-requested-quantity" title={`Requested: ${requested.quantity} ${requested.unit}`}>Requested: {requested.quantity}</small>}{!readOnly && invalidQuantity && <small id={lineFieldId(offer.id,"quantity-error")} className="field-error" title="Enter a positive quantity.">Enter quantity</small>}</td>
                <td data-label="Unit"><Field label="Quoted unit"><input id={lineFieldId(offer.id,"unit")} disabled={!editable} value={offer.unit} aria-describedby={!readOnly && invalidUnit ? lineFieldId(offer.id,"unit-error") : undefined} aria-invalid={!readOnly && invalidUnit || undefined} onChange={event => line(offer.id, { unit: event.target.value, matchConfirmed: false })} onKeyDown={event => nextCell(event, offer.id, "unit")}/></Field>{unitDifference && <small className="quote-unit-difference" title={`Requested unit: ${requested.unit}`}>Requested: {requested.unit}</small>}{!readOnly && invalidUnit && <small id={lineFieldId(offer.id,"unit-error")} className="field-error">Enter unit</small>}</td>
                <td data-label="Unit price" className="quote-number-cell"><Field label="Unit price"><input id={lineFieldId(offer.id,"unitPrice")} type="number" min="0" step="any" disabled={!editable} value={offer.unitPrice || ""} aria-describedby={!readOnly && invalidPrice ? lineFieldId(offer.id,"unitPrice-error") : undefined} aria-invalid={!readOnly && invalidPrice || undefined} onChange={event => line(offer.id, { unitPrice: num(event.target.value) })} onKeyDown={event => nextCell(event, offer.id, "unitPrice")}/></Field>{!readOnly && invalidPrice && <small id={lineFieldId(offer.id,"unitPrice-error")} className="field-error" title="Enter a positive unit price.">Enter price</small>}</td>
                <td data-label="Amount" className="quote-number-cell"><strong>{format(quote.currency, quotationLineAmount(quote, offer))}</strong>{printedDifference && <small className="quote-printed-difference" title={`Printed: ${format(quote.currency, offer.printedTotal!)}`}>Printed: {format(quote.currency, offer.printedTotal!)}</small>}</td>
                <td data-label="Item match">{requested ? <label className={`quote-check${offer.matchConfirmed ? " is-confirmed" : ""}`}><input id={lineFieldId(offer.id,"matchConfirmed")} type="checkbox" disabled={!editable} checked={offer.matchConfirmed === true} onChange={event => line(offer.id, { matchConfirmed: event.target.checked })}/>{offer.matchConfirmed ? "Item confirmed" : "Confirm item"}</label> : <span className="quote-unmatched">Unmatched / extra<small>Cannot be awarded</small></span>}{!readOnly && attention.some(problem => problem.secondary) && <small className="quote-review-note" title={attention.filter(problem => problem.secondary).map(problem => problem.message).join(" ")}>Check Details</small>}</td>
                <td data-label="Actions"><div className="quote-line-actions"><button type="button" data-line-details className="button secondary" aria-label={`Details for line ${index + 1}`} disabled={disabled} aria-haspopup="dialog" onClick={event => { event.currentTarget.focus({ preventScroll: true }); openDetails(offer.id); }}>Details</button>{!readOnly && <button className="text-link" type="button" aria-label={`Delete line ${index + 1}`} disabled={disabled} onClick={() => void removeLine(offer)}>Delete</button>}</div></td>
              </MaterialDetailsRow>;
            })}</tbody></table>{!shown.length && <p className="quote-editor-no-lines">{!lines.length ? readOnly ? "Detailed offered lines were not recorded for this legacy quotation." : "Add an offered material to start this quotation." : "No materials match this view."}</p>}
          </RegisterFrame>
        </div>
        {showSource && <QuoteSourcePanel quote={quote} onHide={() => { setSourceHidden(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(".quote-material-review-actions button:last-child")?.focus({ preventScroll: true })); }} onExpand={setExpandedSource}/>}
      </div>

      <div className="quote-financial-workspace">
        <div className="quote-financial-inputs">
          {(quote.financial || !readOnly) && <QuotationFinancialFields quote={quote} disabled={!editable} onChange={financial => patch({ financial })}/>}
        <section id={fieldId("adjustments")} tabIndex={-1} className="quote-editor-adjustments" aria-labelledby={fieldId("adjustments-heading")}>
          <div className="panel-heading"><div><h3 id={fieldId("adjustments-heading")}>Quote-level adjustments</h3><p className="helper-note">Delivery charges, other services and quotation discounts.</p></div>{!readOnly && <button type="button" className="button secondary" disabled={disabled} onClick={() => void addAdjustment()}>+ Add adjustment</button>}</div>
          {!quote.adjustments?.length ? <p className="quote-adjustments-empty">No quotation discounts or extra charges.</p> : <div className="quote-adjustment-list">{quote.adjustments.map((value, index) => {
            const amount = financialSummary?.adjustments.find(item => item.adjustment.id === value.id);
            const invalidLabel = !value.label.trim(), invalidValue = !Number.isFinite(value.value) || value.value < 0 || (value.calculation === "percentage" && value.value > 100);
            return <fieldset key={value.id} className="quotation-operation-fields quote-adjustment-card" disabled={!editable} aria-label={`Adjustment ${index + 1}`}>
              <div className="quote-adjustment-title"><Field label="Adjustment label"><input id={fieldId(`adjustment-${value.id}-label`)} aria-label="Adjustment label" value={value.label} aria-invalid={!readOnly && invalidLabel || undefined} placeholder="e.g. Delivery fee" onChange={event => adjustment(value.id, { label: event.target.value })}/></Field>{!readOnly && <button type="button" className="text-link" aria-label={`Remove adjustment ${index + 1}`} onClick={() => void onConfirmAction("Remove this financial adjustment?", `${value.label || "Unnamed adjustment"} (${value.kind}) will be removed from ${quote.supplierDetails?.name || "this quotation"}.`, "Remove adjustment", async () => { if (await onSave({ ...quote, adjustments: quote.adjustments?.filter(item => item.id !== value.id) })) requestAnimationFrame(() => (root.current?.querySelector<HTMLInputElement>(".quote-adjustment-title input") || root.current?.querySelector<HTMLButtonElement>(".quote-editor-adjustments>.panel-heading button"))?.focus({ preventScroll: true })); }, true)}>Remove</button>}</div>
              <div className="quote-adjustment-fields"><Field label="Type"><select aria-label="Adjustment kind" value={value.kind} onChange={event => adjustment(value.id, { kind: event.target.value as QuoteAdjustment["kind"] })}><option value="discount">Discount</option><option value="shipping">Delivery</option><option value="other">Other service</option><option value="tax">Tax</option></select></Field><Field label="Calculation"><select aria-label="Adjustment calculation" value={value.calculation} onChange={event => adjustment(value.id, { calculation: event.target.value as QuoteAdjustment["calculation"] })}><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></Field><Field label={value.calculation === "percentage" ? "Value (%)" : `Amount (${quotationCurrency(quote.currency) === "PHP" ? "PHP" : quote.currency})`}><input aria-label="Adjustment value" type="number" min="0" max={value.calculation === "percentage" ? 100 : undefined} step="any" value={Number.isFinite(value.value) ? value.value : ""} aria-invalid={!readOnly && invalidValue || undefined} onChange={event => adjustment(value.id, { value: num(event.target.value) })}/></Field></div>
              <div className="quote-adjustment-contribution"><small>{amount?.ignored ? "Not added separately; VAT settings apply." : value.taxable === false && (value.kind === "shipping" || value.kind === "other") ? "Non-taxable service" : adjustmentClassification(value.kind)}{value.calculation === "percentage" && !amount?.ignored ? " · Based on materials after item discounts" : ""}</small>{amount && <span className="quote-adjustment-amount">{!amount.ignored && <small>{quote.financial?.vatStatus === "VAT" && quote.financial.vatRate > 0 && value.taxable !== false ? "Including VAT" : "In total"}</small>}<strong>{amount.ignored ? "Not added" : quotationReviewMoney(quote, amount.contribution)}</strong></span>}</div>
              {!readOnly && (invalidLabel || invalidValue) && <p className="field-error">{invalidLabel ? "Enter an adjustment label." : "Enter a valid nonnegative amount or percentage up to 100%."}</p>}
            </fieldset>;
          })}</div>}
        </section>
        </div>
        <aside className="quote-financial-card" aria-label="Quotation financial review">
          <QuotationReviewSummary quote={quote} recordedTotal={quoteTotal(state, quote)}/>
          {!readOnly && <footer className="quote-finalize-actions"><QuotationFinancialConfirmation quote={quote} disabled={!editable} onChange={financial => patch({ financial })}/><p className="helper-note" role="status">{issues.length ? `${issues.length} review ${issues.length === 1 ? "item remains" : "items remain"} before finalizing.` : "Quotation ready to finalize."}</p><button className="button primary" type="button" disabled={disabled || issues.length > 0} onClick={() => void onFinalize()}>Finalize quotation</button></footer>}
        </aside>
      </div>
    </section>
    {expandedSource !== null && <QuoteDocumentsDialog quote={quote} initialIndex={expandedSource} disabled={disabled} error={documentError} onAttach={readOnly ? undefined : onAttach} onRemoveDocument={readOnly ? undefined : onRemoveDocument} onClose={() => setExpandedSource(null)}/> }
    <RecordModal open={!!activeLine} title={`Line ${lines.findIndex(value => value.id === detailsId) + 1} · ${activeLine?.description || "Material details"}`} onClose={closeDetails} returnFocus={() => detailsTrigger.current?.isConnected && detailsTrigger.current.checkVisibility() ? detailsTrigger.current : root.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(detailsInvoker.current || "")}"] [data-line-details]`) || root.current?.querySelector<HTMLElement>("[data-add-line]") || null}>
      {activeLine && <div className="quote-material-details"><div className="data-rows"><div><span>Supplier item</span><strong>{activeLine.description || "Unnamed material"}</strong></div><div><span>Quoted quantity</span><strong>{activeLine.quantity} {activeLine.unit}</strong></div><div><span>Unit price</span><strong>{format(quote.currency, activeLine.unitPrice)}</strong></div><div><span>AI match confidence</span><strong>{activeLine.matchConfidence || "Not recorded"}</strong></div><div><span>Matched MRF material</span><strong>{request.items.find(item => item.id === activeLine.requestItemId)?.name || "Unmatched / extra"}</strong></div></div><fieldset className="quotation-operation-fields" disabled={!editable}>
        <button type="button" className="button secondary" onClick={() => void onSave(moveQuotationServices(quote, [activeLine.id])).then(saved => { if (saved) closeDetails(); })}>Move to delivery / other services</button><div className="form-grid">
        <Field label="Supplier item code"><input id={lineFieldId(activeLine.id,"supplierItemCode")} value={activeLine.supplierItemCode || ""} onChange={event => line(activeLine.id, { supplierItemCode: event.target.value })}/></Field>
        <Field label="Brand"><input value={activeLine.brand} onChange={event => line(activeLine.id, { brand: event.target.value })}/></Field>
        <Field label="Specification"><input value={activeLine.specification} onChange={event => line(activeLine.id, { specification: event.target.value })}/></Field>
        <Field label="MRF units per quoted unit"><input id={lineFieldId(activeLine.id,"conversionFactor")} type="number" min="0.0001" step="any" value={activeLine.conversionFactor} onChange={event => line(activeLine.id, { conversionFactor: num(event.target.value), matchConfirmed: false })}/></Field>
        <Field label="Unit or specification difference"><input id={lineFieldId(activeLine.id,"varianceReason")} value={activeLine.varianceReason} onChange={event => line(activeLine.id, { varianceReason: event.target.value })}/></Field>
        <Field label="Lead time"><input value={activeLine.leadTime || ""} onChange={event => line(activeLine.id, { leadTime: event.target.value })}/></Field>
        <Field label="Discount type"><select id={lineFieldId(activeLine.id,"discountType")} value={activeLine.discountType || "none"} onChange={event => line(activeLine.id, { discountType: event.target.value as QuoteLine["discountType"] })}><option value="none">None</option><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></Field>
        <Field label="Discount value"><input id={lineFieldId(activeLine.id,"discountValue")} type="number" min="0" step="any" value={activeLine.discountValue || 0} onChange={event => line(activeLine.id, { discountValue: num(event.target.value) })}/></Field>
        <Field label="Tax rate %"><input id={lineFieldId(activeLine.id,"taxRate")} type="number" min="0" step="any" value={activeLine.taxRate || 0} onChange={event => line(activeLine.id, { taxRate: num(event.target.value) })}/></Field>
        <Field label="Printed line total"><input id={lineFieldId(activeLine.id,"printedTotal")} type="number" min="0" step="any" value={activeLine.printedTotal ?? ""} onChange={event => line(activeLine.id, { printedTotal: event.target.value ? num(event.target.value) : null })}/></Field>
        <Field label="Reason for accepting printed total difference"><input id={lineFieldId(activeLine.id,"discrepancyReason")} value={activeLine.discrepancyReason || ""} onChange={event => line(activeLine.id, { discrepancyReason: event.target.value })}/></Field>
        <Field label="Line notes"><textarea value={activeLine.notes || ""} onChange={event => line(activeLine.id, { notes: event.target.value })}/></Field>
      </div></fieldset><p className="helper-note">Source page: {activeLine.sourcePage || "Not recorded"} · {activeLine.matchRationale || "No match explanation recorded."}</p><p className="helper-note">Calculated: {format(quote.currency, quotationLineAmount(quote, activeLine))}{activeLine.printedTotal != null ? ` · Printed: ${format(quote.currency, activeLine.printedTotal)}` : ""}</p></div>}
    </RecordModal>
  </>;
}
