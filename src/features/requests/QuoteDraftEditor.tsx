"use client";

import { adjustmentClassification } from "@/src/domain/expense-classification";
import { useState } from "react";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { Badge, Field } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { quoteReviewIssues } from "@/src/domain/procurement";
import { quoteLineTotal } from "@/src/domain/pricing";
import { quoteTotal } from "@/src/domain/selectors";
import type { DemoSnapshot, MRF, Quote, QuoteAdjustment, QuoteLine, SupplierQuoteDetails } from "@/src/domain/types";

type Props = { state: DemoSnapshot; request: MRF; quote: Quote; onSave: (quote: Quote) => Promise<boolean>; onFinalize: () => Promise<void>; onAttach: (files: File[]) => Promise<void>; onRemoveDocument: (fileId: string) => Promise<void> };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (currency: string | undefined, value: number) => currency === "PHP" || !currency ? money(value) : `${currency} ${value.toFixed(2)}`;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const emptySupplier = (): SupplierQuoteDetails => ({ name: "", address: "", tin: "", contactName: "", email: "", phone: "" });

export function QuoteDraftEditor({ state, request, quote, onSave, onFinalize, onAttach, onRemoveDocument }: Props) {
  const [expandedLineId, setExpandedLineId] = useState<string | null>(quote.lines?.length === 1 && !quote.lines[0].description ? quote.lines[0].id : null);
  const issues = quoteReviewIssues(state, quote);
  const patch = (fields: Partial<Quote>) => void onSave({ ...quote, ...fields });
  const supplier = (fields: Partial<SupplierQuoteDetails>) => patch({ supplierDetails: { ...(quote.supplierDetails || emptySupplier()), ...fields } });
  const line = (lineId: string, fields: Partial<QuoteLine>) => patch({ lines: quote.lines?.map(value => value.id === lineId ? { ...value, ...fields, discrepancyReason: ["quantity", "unitPrice", "discountType", "discountValue", "taxRate", "printedTotal"].some(key => key in fields) ? "" : value.discrepancyReason } : value) });
  const adjustment = (adjustmentId: string, fields: Partial<QuoteAdjustment>) => patch({ adjustments: (quote.adjustments || []).map(value => value.id === adjustmentId ? { ...value, ...fields } : value) });
  return <section className="panel quote-review"><div className="panel-heading"><h2>Review {quote.supplierDetails?.name || "quotation"}</h2><small>Draft saved automatically</small></div><p className="helper-note">Confirm every suggested MRF match against the source. Unmatched extras remain on the quotation but cannot be awarded.</p>
    <CollapsibleSection title="Supplier and terms"><div className="form-grid">
      <Field label="Supplier name"><input value={quote.supplierDetails?.name || ""} onChange={event => supplier({ name: event.target.value })}/></Field>
      <Field label="Quotation reference"><input value={quote.ref} onChange={event => patch({ ref: event.target.value })}/></Field>
      <Field label="Currency"><input value={quote.currency || ""} onChange={event => patch({ currency: event.target.value.toUpperCase() })}/></Field>
      <Field label="Quote date"><input type="date" value={quote.quoteDate || ""} onChange={event => patch({ quoteDate: event.target.value })}/></Field>
      <Field label="Valid until"><input type="date" value={quote.validity || ""} onChange={event => patch({ validity: event.target.value })}/></Field>
    </div><CollapsibleSection title="Supplier contact details" defaultOpen={false}><div className="form-grid">
      <Field label="Supplier address"><input value={quote.supplierDetails?.address || ""} onChange={event => supplier({ address: event.target.value })}/></Field>
      <Field label="Supplier TIN"><input value={quote.supplierDetails?.tin || ""} onChange={event => supplier({ tin: event.target.value })}/></Field>
      <Field label="Contact name"><input value={quote.supplierDetails?.contactName || ""} onChange={event => supplier({ contactName: event.target.value })}/></Field>
      <Field label="Email"><input type="email" value={quote.supplierDetails?.email || ""} onChange={event => supplier({ email: event.target.value })}/></Field>
      <Field label="Phone"><input value={quote.supplierDetails?.phone || ""} onChange={event => supplier({ phone: event.target.value })}/></Field>
    </div></CollapsibleSection><div className="form-grid">
      <Field label="Availability"><input value={quote.available} onChange={event => patch({ available: event.target.value })}/></Field>
      <Field label="Lead days"><input type="number" min="0" value={quote.leadDays} onChange={event => patch({ leadDays: num(event.target.value) })}/></Field>
      <Field label="Payment terms"><input value={quote.terms} onChange={event => patch({ terms: event.target.value })}/></Field>
      <Field label="Delivery terms"><input value={quote.deliveryTerms || ""} onChange={event => patch({ deliveryTerms: event.target.value })}/></Field>
      <Field label="Quotation notes"><textarea value={quote.quoteNotes || ""} onChange={event => patch({ quoteNotes: event.target.value })}/></Field>
    </div>
    </CollapsibleSection><CollapsibleSection title="Supplier quotation documents" summary={`${quote.documents.length} files attached`}>
    <p className="helper-note">Attach the supplier&apos;s original PDF or images. A document is required before finalization, including for manually entered quotations.</p>
    <div className="quote-document-attachments">{quote.documents.map(document => <div className="quote-document-attachment" key={document.fileId || document.name}><span>{document.name}</span>{document.fileId && <button type="button" className="text-link" onClick={() => void onRemoveDocument(document.fileId!)}>Remove</button>}</div>)}<label className="button secondary file-button">+ Add supplier files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void onAttach(files); }}/></label></div>
    </CollapsibleSection><h3 className="subheading">Offered lines · Goods</h3>
    {quote.lines?.map((offer, index) => <article className={`quote-review-line ${offer.requestItemId ? "is-matched" : ""} ${offer.matchConfirmed ? "is-confirmed" : ""}`} key={offer.id}>
      <div className="quote-line-summary"><div><small>Offered line {index + 1}{offer.sourcePage ? ` / page ${offer.sourcePage}` : ""}</small><h3>{offer.description || "Unnamed offered material"}</h3><Badge>{offer.requestItemId ? offer.matchConfirmed ? "Match confirmed" : "Suggested match: review required" : "Unmatched extra: cannot award"}</Badge></div><div className="button-row"><button type="button" className="button secondary quote-line-toggle" aria-expanded={expandedLineId === offer.id} aria-controls={`offer-details-${offer.id}`} onClick={() => setExpandedLineId(current => current === offer.id ? null : offer.id)}>{expandedLineId === offer.id ? "Close details" : "Review line"}</button><button className="text-link" type="button" onClick={() => patch({ lines: quote.lines?.filter(value => value.id !== offer.id) })}>Remove line</button></div></div>
      <div className="quote-offer-basics"><div><small>Supplier offers</small><strong>{offer.quantity} {offer.unit || "units"}</strong></div><div><small>Unit price</small><strong>{format(quote.currency, offer.unitPrice)}</strong></div><div><small>MRF material</small><strong>{request.items.find(item => item.id === offer.requestItemId)?.name || "Not matched"}</strong></div></div>
    <div id={`offer-details-${offer.id}`} hidden={expandedLineId !== offer.id} className="quote-line-details"><div className="quote-match-row quote-match-context"><Field label="Required MRF material"><select value={offer.requestItemId} onChange={event => line(offer.id, { requestItemId: event.target.value, matchConfirmed: false })}><option value="">Unmatched / extra</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit} required</option>)}</select></Field>{offer.requestItemId && <p>Requested: {request.items.find(item => item.id === offer.requestItemId)?.quantity} {request.items.find(item => item.id === offer.requestItemId)?.unit}. Compare the supplier description, unit, and price before confirming.</p>}</div><div className="form-grid">
      <Field label="Description"><input value={offer.description} onChange={event => line(offer.id, { description: event.target.value })}/></Field>
      <Field label="Quoted quantity"><input type="number" min="0" step="any" value={offer.quantity} onChange={event => line(offer.id, { quantity: num(event.target.value) })}/></Field>
      <Field label="Quoted unit"><input value={offer.unit} onChange={event => line(offer.id, { unit: event.target.value, matchConfirmed: false })}/></Field>
      <Field label="Unit price"><input type="number" min="0" step="any" value={offer.unitPrice} onChange={event => line(offer.id, { unitPrice: num(event.target.value) })}/></Field>
      <Field label="MRF units per quoted unit"><input type="number" min="0.0001" step="any" value={offer.conversionFactor} onChange={event => line(offer.id, { conversionFactor: num(event.target.value), matchConfirmed: false })}/></Field>
      <Field label="Unit or specification difference"><input value={offer.varianceReason} onChange={event => line(offer.id, { varianceReason: event.target.value })}/></Field>
</div><CollapsibleSection title="Pricing details" defaultOpen={!!offer.discountValue || !!offer.taxRate || offer.printedTotal != null}><div className="form-grid">
      <Field label="Discount type"><select value={offer.discountType || "none"} onChange={event => line(offer.id, { discountType: event.target.value as QuoteLine["discountType"] })}><option value="none">None</option><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></Field>
      <Field label="Discount value"><input type="number" min="0" step="any" value={offer.discountValue || 0} onChange={event => line(offer.id, { discountValue: num(event.target.value) })}/></Field>
      <Field label="Tax rate %"><input type="number" min="0" step="any" value={offer.taxRate || 0} onChange={event => line(offer.id, { taxRate: num(event.target.value) })}/></Field>
      <Field label="Printed line total"><input type="number" min="0" step="any" value={offer.printedTotal ?? ""} onChange={event => line(offer.id, { printedTotal: event.target.value ? num(event.target.value) : null })}/></Field>
</div></CollapsibleSection><CollapsibleSection title="Specifications and notes" defaultOpen={false}><div className="form-grid">
      <Field label="Supplier item code"><input value={offer.supplierItemCode || ""} onChange={event => line(offer.id, { supplierItemCode: event.target.value })}/></Field>
      <Field label="Brand"><input value={offer.brand} onChange={event => line(offer.id, { brand: event.target.value })}/></Field>
      <Field label="Specification"><input value={offer.specification} onChange={event => line(offer.id, { specification: event.target.value })}/></Field>
      <Field label="Lead time"><input value={offer.leadTime || ""} onChange={event => line(offer.id, { leadTime: event.target.value })}/></Field>
      <Field label="Line notes"><input value={offer.notes || ""} onChange={event => line(offer.id, { notes: event.target.value })}/></Field>
</div></CollapsibleSection><p className="helper-note">Calculated: {format(quote.currency, quoteLineTotal(offer))}{offer.printedTotal !== null && offer.printedTotal !== undefined ? ` · Printed: ${format(quote.currency, offer.printedTotal)}` : ""}</p>
      {offer.requestItemId && <label className="quote-check"><input type="checkbox" checked={offer.matchConfirmed === true} onChange={event => line(offer.id, { matchConfirmed: event.target.checked })}/> Confirm MRF match{offer.matchConfidence ? ` · AI confidence: ${offer.matchConfidence}` : ""}{offer.matchRationale ? ` · ${offer.matchRationale}` : ""}</label>}
      {offer.printedTotal !== null && offer.printedTotal !== undefined && Math.abs(quoteLineTotal(offer) - offer.printedTotal) > 0.01 && <Field label="Reason for accepting printed total difference"><input value={offer.discrepancyReason || ""} onChange={event => line(offer.id, { discrepancyReason: event.target.value })}/></Field>}
    </div></article>)}
    <button className="button secondary" type="button" onClick={() => { const added = blankLine(); setExpandedLineId(added.id); patch({ lines: [...(quote.lines || []), added] }); }}>+ Add offered line</button>
    <CollapsibleSection title="Services and financial adjustments" defaultOpen={!!quote.adjustments?.length}>{(quote.adjustments || []).map(value => <div className="quote-adjustment-row" key={value.id}><div><input aria-label="Adjustment label" value={value.label} onChange={event => adjustment(value.id, { label: event.target.value })}/><small className="expense-classification">{adjustmentClassification(value.kind)}</small></div><select aria-label="Adjustment kind" value={value.kind} onChange={event => adjustment(value.id, { kind: event.target.value as QuoteAdjustment["kind"] })}><option value="discount">Discount</option><option value="tax">Tax</option><option value="shipping">Shipping</option><option value="other">Other</option></select><select aria-label="Adjustment calculation" value={value.calculation} onChange={event => adjustment(value.id, { calculation: event.target.value as QuoteAdjustment["calculation"] })}><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select><input aria-label="Adjustment value" type="number" min="0" step="any" value={value.value} onChange={event => adjustment(value.id, { value: num(event.target.value) })}/><button className="text-link" onClick={() => patch({ adjustments: quote.adjustments?.filter(item => item.id !== value.id) })}>Remove</button></div>)}<button className="button secondary" type="button" onClick={() => patch({ adjustments: [...(quote.adjustments || []), { id: newId("adjustment"), label: "", kind: "other", calculation: "fixed", value: 0 }] })}>+ Add adjustment</button>
    </CollapsibleSection><div className="quote-review-issues"><strong>{issues.length ? `${issues.length} items to resolve` : `Ready to finalize · quoted total ${format(quote.currency, quoteTotal(state, quote))}`}</strong>{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}</div>
    <div className="form-actions"><button className="button primary" type="button" disabled={issues.length > 0} onClick={() => void onFinalize()}>Finalize quotation</button></div>
  </section>;
}
