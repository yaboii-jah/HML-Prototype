"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { adjustmentClassification } from "@/src/domain/expense-classification";
import { CollapsibleSection, revealField } from "@/src/components/ui/CollapsibleSection";
import { RegisterFrame } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Badge, Field } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import type { ConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { foreignQuotationMessage, quotationCurrency, quoteReviewIssues } from "@/src/domain/procurement";
import { quotationLineAmount } from "@/src/domain/pricing";
import { quoteTotal } from "@/src/domain/selectors";
import { QuotationFinancialFields } from "./QuotationFinancialFields";
import { moveQuotationServices } from "@/src/domain/quotation-services";
import type { DemoSnapshot, MRF, Quote, QuoteAdjustment, QuoteLine, SupplierQuoteDetails } from "@/src/domain/types";

type Props = { state: DemoSnapshot; request: MRF; quote: Quote; onSave: (quote: Quote) => Promise<boolean>; onFinalize: () => Promise<void>; onAttach: (files: File[]) => Promise<void>; onRemoveDocument: (fileId: string) => Promise<void>; onConfirmAction: ConfirmedAction; disabled?: boolean; readOnly?: boolean; compact?: boolean; actions?: ReactNode };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (currency: string | undefined, value: number) => currency === "PHP" || !currency ? money(value) : `${currency} ${value.toFixed(2)}`;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const emptySupplier = (): SupplierQuoteDetails => ({ name: "", address: "", tin: "", contactName: "", email: "", phone: "" });

export function QuoteDraftEditor({ state, request, quote, onSave, onFinalize, onAttach, onRemoveDocument, onConfirmAction, disabled = false, readOnly = false, compact = false, actions }: Props) {
  const root = useRef<HTMLElement>(null), detailFocus = useRef<string | null>(null), detailsInvoker = useRef<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(1), [size, setSize] = useState(10);
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
  const activeLine = lines.find(offer => offer.id === detailsId);
  const patch = (fields: Partial<Quote>) => { if (editable) void onSave({ ...quote, ...fields }); };
  const supplier = (fields: Partial<SupplierQuoteDetails>) => patch({ supplierDetails: { ...(quote.supplierDetails || emptySupplier()), ...fields } });
  const line = (id: string, fields: Partial<QuoteLine>) => patch({ lines: lines.map(value => value.id === id ? { ...value, ...fields, discrepancyReason: ["quantity", "unitPrice", "discountType", "discountValue", "taxRate", "printedTotal"].some(key => key in fields) ? "" : fields.discrepancyReason ?? value.discrepancyReason } : value) });
  const adjustment = (id: string, fields: Partial<QuoteAdjustment>) => patch({ adjustments: (quote.adjustments || []).map(value => value.id === id ? { ...value, ...fields } : value) });
  const closeDetails = () => { setDetailsId(null); detailFocus.current = null; };
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
      if (location.secondary) { detailFocus.current = lineFieldId(location.offer.id, location.field); detailsInvoker.current = location.offer.id; setDetailsId(location.offer.id); }
      else setPendingFocus(lineFieldId(location.offer.id, location.field));
    } else setPendingFocus(fieldId(location.field));
  };
  const addLine = async () => {
    if (!editable) return;
    const added = blankLine();
    if (await onSave({ ...quote, lines: [...lines, added] })) { setSearch(""); setFilter("all"); setPage(Math.floor(lines.length / size) + 1); setPendingFocus(lineFieldId(added.id, "description")); }
  };
  const removeLine = (offer: QuoteLine) => onConfirmAction("Remove this offered line?", `${offer.description || "Unnamed offered material"} will be removed from ${quote.supplierDetails?.name || "this quotation"}.`, "Remove line", async () => { if (await onSave({ ...quote, lines: lines.filter(value => value.id !== offer.id) }) && detailsId === offer.id) closeDetails(); }, true);
  const headerField = (name: string, label: string, value: string | number, change: (value: string) => void, type = "text") => <Field key={name} label={label}><input id={fieldId(name)} type={type} min={type === "number" ? 0 : undefined} value={value} onChange={event => change(event.target.value)}/></Field>;
  return <>
    <section ref={root} id={`quote-panel-${quote.id}`} className={`panel quote-review quote-editor-panel${readOnly ? " is-readonly" : ""}`} data-quotation-id={quote.id}>
      <header className="quote-editor-header"><div className="quote-editor-title"><div><h2>{quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier"}</h2><Badge>{quote.reviewStatus || "finalized"}</Badge><Badge>{quote.extraction === "gemini" ? "AI extracted" : quote.extraction === "manual" ? "Manual entry" : "Legacy"}</Badge></div><p title={quote.documents.map(document => document.name).join(" · ")}>{quote.documents[0]?.name || "No supplier files attached"}{quote.documents.length > 1 ? ` · +${quote.documents.length - 1} files` : ""} · {quote.ref || "Reference needed"} · v{quote.version || 1}</p><small>{readOnly ? "Read-only quotation" : "Draft saved automatically"}</small></div><div className="quote-editor-header-actions">{!readOnly && <><button type="button" data-add-line className="button secondary" disabled={disabled} onClick={() => void addLine()}>+ Add line</button><span className="quote-review-count-status" role="status">{issues.length > 0 ? issues.length + " review " + (issues.length === 1 ? "item" : "items") + " before finalizing" : "Quotation ready to finalize"}</span>{issues.length > 0 && <button ref={issuesTrigger} className="button quote-review-trigger" type="button" popoverTarget={issuesId} aria-expanded={issuesOpen} aria-controls={issuesId}>{issues.length} review {issues.length === 1 ? "item" : "items"}</button>}<button className="button primary" type="button" disabled={disabled || issues.length > 0} onClick={() => void onFinalize()}>Finalize quotation</button></>}{actions}</div></header>
      {!readOnly && issues.length > 0 && <div ref={issuesPanel} id={issuesId} popover="auto" className="quote-editor-issues" aria-labelledby={issuesId + "-title"} onBeforeToggle={event => {
        if (event.newState === "open") navigatingIssue.current = false;
        else if (!navigatingIssue.current) issuesTrigger.current?.focus({ preventScroll: true });
      }} onToggle={event => setIssuesOpen(event.newState === "open")}><strong id={issuesId + "-title"}>{issues.length} review {issues.length === 1 ? "item" : "items"} before finalizing</strong><ul>{locations.map((location, index) => <li key={location.message + "-" + index}><button type="button" className="text-link" onClick={() => jump(location)}>{location.message}</button></li>)}</ul></div>}
      {quotationCurrency(quote.currency) !== "PHP" && <p id={fieldId("currency")} tabIndex={-1} className="callout bad" role={readOnly ? undefined : "alert"}>{readOnly ? `Recorded currency: ${quote.currency}. This historical quotation is read-only.` : `${foreignQuotationMessage} Detected currency: ${quote.currency}.`}</p>}
      <CollapsibleSection key={`${quote.id}-${compact}`} title="Supplier and quotation details" defaultOpen={!compact}><fieldset className="quotation-operation-fields" disabled={!editable}><div className="quote-editor-field-grid">
        {headerField("supplierName", "Supplier name", quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "", value => supplier({ name: value }))}
        {headerField("ref", "Quotation reference", quote.ref, value => patch({ ref: value }))}
        {headerField("quoteDate", "Quote date", quote.quoteDate || "", value => patch({ quoteDate: value }), "date")}
        {headerField("validity", "Valid until", quote.validity || "", value => patch({ validity: value }), "date")}
        {headerField("available", "Availability", quote.available, value => patch({ available: value }))}
        {headerField("leadDays", "Lead days", quote.leadDays, value => patch({ leadDays: num(value) }), "number")}
        {headerField("terms", "Payment terms", quote.terms, value => patch({ terms: value }))}
      </div><CollapsibleSection title="Contact, address and additional terms" defaultOpen={false}><div className="quote-editor-field-grid">
        {headerField("address", "Supplier address", quote.supplierDetails?.address || "", value => supplier({ address: value }))}
        {headerField("tin", "Supplier TIN", quote.supplierDetails?.tin || "", value => supplier({ tin: value }))}
        {headerField("contactName", "Contact name", quote.supplierDetails?.contactName || "", value => supplier({ contactName: value }))}
        {headerField("email", "Email", quote.supplierDetails?.email || "", value => supplier({ email: value }), "email")}
        {headerField("phone", "Phone", quote.supplierDetails?.phone || "", value => supplier({ phone: value }))}
        {headerField("deliveryTerms", "Delivery terms", quote.deliveryTerms || "", value => patch({ deliveryTerms: value }))}
        <Field label="Quotation notes"><textarea id={fieldId("quoteNotes")} value={quote.quoteNotes || ""} onChange={event => patch({ quoteNotes: event.target.value })}/></Field>
      </div></CollapsibleSection></fieldset></CollapsibleSection>
      <CollapsibleSection className="quote-documents-section" title="Supplier quotation documents" summary={`${quote.documents.length} ${quote.documents.length === 1 ? "file" : "files"} attached`} defaultOpen={!quote.documents.length && !readOnly}>
        <div id={fieldId("documents")} tabIndex={-1} className="quote-document-attachments">{quote.documents.map(document => <div className="quote-document-attachment" key={document.fileId || document.name}><span>{document.name}</span>{document.fileId && !readOnly && <button type="button" className="text-link" disabled={disabled} onClick={() => void onRemoveDocument(document.fileId!)}>Remove</button>}</div>)}{!readOnly && <label className="button secondary file-button">+ Add supplier files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={disabled} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void onAttach(files); }}/></label>}{!quote.documents.length && <p className="helper-note">No original supplier documents attached.</p>}</div>
      </CollapsibleSection>
      <div id={fieldId("materials")} tabIndex={-1} className="quote-editor-material-heading"><h3>Offered materials · {lines.length}</h3><p className="helper-note">Confirm suggested MRF matches against the source. Unmatched extras cannot be awarded.</p></div>
      <div className="quote-editor-material-tools"><input type="search" aria-label={`Search materials in ${quote.ref || quote.id}`} placeholder="Search materials, codes or specifications" value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }}/><select aria-label={`Filter material review in ${quote.ref || quote.id}`} value={filter} disabled={disabled} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">All materials</option><option value="review">Needs review</option><option value="unmatched">Unmatched / extra</option></select></div>
      <RegisterFrame embedded className="quote-material-register" scrollClassName="quote-editor-lines" resetKey={`${quote.id}-${currentPage}-${size}-${search}-${filter}`} footer={<div className="register-footer quote-editor-pagination"><label>Per page <select aria-label={`Materials per page for ${quote.id}`} value={size} disabled={disabled} onChange={event => { setSize(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="25">25</option></select></label><span>{filtered.length ? start + 1 : 0}–{Math.min(start + size, filtered.length)} of {filtered.length} materials</span><div><button type="button" className="button secondary" aria-label={`Previous material page for ${quote.id}`} disabled={disabled || currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage} / {pageCount}</span><button type="button" className="button secondary" aria-label={`Next material page for ${quote.id}`} disabled={disabled || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>}>
        <table><thead><tr><th>Match / confidence</th><th>Supplier item</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Calculated total</th><th>Actions</th></tr></thead><tbody>{shown.map(({ offer, index }) => {
        const problems = locations.filter(location => location.offer?.id === offer.id);
        return <tr key={offer.id} data-line-id={offer.id} className={!readOnly && problems.length ? "needs-review" : undefined}>
          <td data-label="Match / confidence"><Field label="Required MRF material"><select id={lineFieldId(offer.id,"requestItemId")} disabled={!editable} value={offer.requestItemId} onChange={event => line(offer.id, { requestItemId: event.target.value, matchConfirmed: false })}><option value="">Unmatched / extra</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit}</option>)}</select></Field><div className="quote-line-confidence"><span className="quote-line-number">Line {index + 1}</span><span className={`badge ${offer.matchConfidence === "high" ? "good" : offer.matchConfidence ? "warn" : ""}`}>{offer.matchConfidence ? `${offer.matchConfidence} confidence` : "Confidence not recorded"}</span></div>{offer.requestItemId && <label className="quote-check"><input id={lineFieldId(offer.id,"matchConfirmed")} type="checkbox" disabled={!editable} checked={offer.matchConfirmed === true} onChange={event => line(offer.id, { matchConfirmed: event.target.checked })}/> Confirm MRF match</label>}{!readOnly && problems.length > 0 && <small className="field-error">{problems[0].message}</small>}</td>
          <td data-label="Supplier item"><Field label="Description"><textarea id={lineFieldId(offer.id,"description")} rows={2} disabled={!editable} value={offer.description} onChange={event => line(offer.id, { description: event.target.value })}/></Field>{offer.supplierItemCode && <small>{offer.supplierItemCode}</small>}</td>
          <td data-label="Qty"><Field label="Quoted quantity"><input id={lineFieldId(offer.id,"quantity")} type="number" min="0" step="any" disabled={!editable} value={offer.quantity || ""} onChange={event => line(offer.id, { quantity: num(event.target.value) })}/></Field></td>
          <td data-label="Unit"><Field label="Quoted unit"><input id={lineFieldId(offer.id,"unit")} disabled={!editable} value={offer.unit} onChange={event => line(offer.id, { unit: event.target.value, matchConfirmed: false })}/></Field></td>
          <td data-label="Unit price"><Field label="Unit price"><input id={lineFieldId(offer.id,"unitPrice")} type="number" min="0" step="any" disabled={!editable} value={offer.unitPrice || ""} onChange={event => line(offer.id, { unitPrice: num(event.target.value) })}/></Field></td>
          <td data-label="Calculated total"><strong>{format(quote.currency, quotationLineAmount(quote, offer))}</strong></td>
          <td data-label="Actions"><div className="quote-line-actions"><button type="button" data-line-details className="button secondary" aria-label={`Details for line ${index + 1}`} disabled={disabled} onClick={() => { detailFocus.current = null; detailsInvoker.current = offer.id; setDetailsId(offer.id); }}>Details</button>{!readOnly && <button className="text-link" type="button" aria-label={`Delete line ${index + 1}`} disabled={disabled} onClick={() => void removeLine(offer)}>Delete</button>}</div></td>
        </tr>;
      })}</tbody></table>{!shown.length && <p className="quote-editor-no-lines">{!lines.length ? readOnly ? "Detailed offered lines were not recorded for this legacy quotation." : "Add an offered material to start this quotation." : "No materials match this view."}</p>}
      </RegisterFrame>

      <div id={fieldId("adjustments")} tabIndex={-1} className="quote-editor-adjustments"><div className="panel-heading"><h3>Quote-level adjustments</h3>{!readOnly && <button type="button" className="text-link" disabled={disabled} onClick={() => patch({ adjustments: [...(quote.adjustments || []), { id: newId("adjustment"), label: "", kind: "other", calculation: "fixed", value: 0 }] })}>+ Add adjustment</button>}</div>{!quote.adjustments?.length ? <p className="helper-note">No quote-level charges recorded.</p> : <div className="table-frame"><table><thead><tr><th>Label / classification</th><th>Kind</th><th>Calculation</th><th>Value</th>{!readOnly && <th>Actions</th>}</tr></thead><tbody>{quote.adjustments.map(value => <tr key={value.id} className="quote-adjustment-row"><td data-label="Label / classification"><input aria-label="Adjustment label" disabled={!editable} value={value.label} onChange={event => adjustment(value.id, { label: event.target.value })}/><small>{adjustmentClassification(value.kind)}</small></td><td data-label="Kind"><select aria-label="Adjustment kind" disabled={!editable} value={value.kind} onChange={event => adjustment(value.id, { kind: event.target.value as QuoteAdjustment["kind"] })}><option value="discount">Discount</option><option value="tax">Tax</option><option value="shipping">Shipping</option><option value="other">Other</option></select></td><td data-label="Calculation"><select aria-label="Adjustment calculation" disabled={!editable} value={value.calculation} onChange={event => adjustment(value.id, { calculation: event.target.value as QuoteAdjustment["calculation"] })}><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select></td><td data-label="Value"><input aria-label="Adjustment value" type="number" min="0" step="any" disabled={!editable} value={value.value} onChange={event => adjustment(value.id, { value: num(event.target.value) })}/></td>{!readOnly && <td data-label="Actions"><button type="button" className="text-link" disabled={disabled} onClick={() => void onConfirmAction("Remove this financial adjustment?", `${value.label || "Unnamed adjustment"} (${value.kind}) will be removed from ${quote.supplierDetails?.name || "this quotation"}, changing its quoted total.`, "Remove adjustment", () => onSave({ ...quote, adjustments: quote.adjustments?.filter(item => item.id !== value.id) }), true)}>Remove</button></td>}</tr>)}</tbody></table></div>}</div>
      {(quote.financial || !readOnly) && <QuotationFinancialFields quote={quote} disabled={!editable} onChange={financial => patch({ financial })}/>}
      <div id={fieldId("total")} tabIndex={-1} className="quote-editor-total"><span>Quotation total</span><strong>{format(quote.currency, quoteTotal(state, quote))}</strong></div>
    </section>
    <RecordModal open={!!activeLine} title={`Line ${lines.findIndex(value => value.id === detailsId) + 1} · ${activeLine?.description || "Material details"}`} onClose={closeDetails} returnFocus={() => root.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(detailsInvoker.current || "")}"] [data-line-details]`) || root.current?.querySelector<HTMLElement>("[data-add-line]") || null}>
      {activeLine && <div className="quote-material-details"><fieldset className="quotation-operation-fields" disabled={!editable}>
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
