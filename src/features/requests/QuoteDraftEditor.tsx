"use client";

import { useState } from "react";
import { Field } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { quoteReviewIssues } from "@/src/domain/procurement";
import { quoteLineTotal } from "@/src/domain/pricing";
import { quoteTotal } from "@/src/domain/selectors";
import type { DemoSnapshot, MRF, Quote, QuoteAdjustment, QuoteLine, SupplierQuoteDetails } from "@/src/domain/types";

type Props = { state: DemoSnapshot; request: MRF; quote: Quote; onSave: (quote: Quote) => Promise<boolean>; onFinalize: () => Promise<void> };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (currency: string | undefined, value: number) => currency === "PHP" || !currency ? money(value) : `${currency} ${value.toFixed(2)}`;
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 0, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "", matchConfirmed: false, matchConfidence: "low", discountType: "none", discountValue: 0, taxRate: 0, printedTotal: null });
const emptySupplier = (): SupplierQuoteDetails => ({ name: "", address: "", tin: "", contactName: "", email: "", phone: "" });

export function QuoteDraftEditor({ state, request, quote, onSave, onFinalize }: Props) {
  const [expandedLineId, setExpandedLineId] = useState<string | null>(quote.lines?.length === 1 && !quote.lines[0].description ? quote.lines[0].id : null);
  const issues = quoteReviewIssues(state, quote);
  const patch = (fields: Partial<Quote>) => void onSave({ ...quote, ...fields });
  const supplier = (fields: Partial<SupplierQuoteDetails>) => patch({ supplierDetails: { ...(quote.supplierDetails || emptySupplier()), ...fields } });
  const line = (lineId: string, fields: Partial<QuoteLine>) => patch({ lines: quote.lines?.map(value => value.id === lineId ? { ...value, ...fields, discrepancyReason: ["quantity", "unitPrice", "discountType", "discountValue", "taxRate", "printedTotal"].some(key => key in fields) ? "" : value.discrepancyReason } : value) });
  const adjustment = (adjustmentId: string, fields: Partial<QuoteAdjustment>) => patch({ adjustments: (quote.adjustments || []).map(value => value.id === adjustmentId ? { ...value, ...fields } : value) });
  return <section className="panel quote-review"><div className="panel-heading"><h2>Review {quote.supplierDetails?.name || "quotation"}</h2><small>Draft saved automatically in this browser</small></div><p className="helper-note">Confirm every suggested MRF match against the source. Unmatched extras remain on the quotation but cannot be awarded.</p>
    <div className="form-grid">
      <Field label="Supplier name"><input value={quote.supplierDetails?.name || ""} onChange={event => supplier({ name: event.target.value })}/></Field>
      <Field label="Quotation reference"><input value={quote.ref} onChange={event => patch({ ref: event.target.value })}/></Field>
      <Field label="Currency"><input value={quote.currency || ""} onChange={event => patch({ currency: event.target.value.toUpperCase() })}/></Field>
      <Field label="Quote date"><input type="date" value={quote.quoteDate || ""} onChange={event => patch({ quoteDate: event.target.value })}/></Field>
      <Field label="Valid until"><input type="date" value={quote.validity || ""} onChange={event => patch({ validity: event.target.value })}/></Field>
      <Field label="Supplier address"><input value={quote.supplierDetails?.address || ""} onChange={event => supplier({ address: event.target.value })}/></Field>
      <Field label="Supplier TIN"><input value={quote.supplierDetails?.tin || ""} onChange={event => supplier({ tin: event.target.value })}/></Field>
      <Field label="Contact name"><input value={quote.supplierDetails?.contactName || ""} onChange={event => supplier({ contactName: event.target.value })}/></Field>
      <Field label="Email"><input type="email" value={quote.supplierDetails?.email || ""} onChange={event => supplier({ email: event.target.value })}/></Field>
      <Field label="Phone"><input value={quote.supplierDetails?.phone || ""} onChange={event => supplier({ phone: event.target.value })}/></Field>
      <Field label="Availability"><input value={quote.available} onChange={event => patch({ available: event.target.value })}/></Field>
      <Field label="Lead days"><input type="number" min="0" value={quote.leadDays} onChange={event => patch({ leadDays: num(event.target.value) })}/></Field>
      <Field label="Payment terms"><input value={quote.terms} onChange={event => patch({ terms: event.target.value })}/></Field>
      <Field label="Delivery terms"><input value={quote.deliveryTerms || ""} onChange={event => patch({ deliveryTerms: event.target.value })}/></Field>
      <Field label="Quotation notes"><textarea value={quote.quoteNotes || ""} onChange={event => patch({ quoteNotes: event.target.value })}/></Field>
    </div>
    <h3 className="subheading">Offered lines</h3>
    {quote.lines?.map((offer, index) => <article className="quote-review-line" key={offer.id}><div className="quote-line-summary"><button type="button" className="quote-line-toggle" aria-expanded={expandedLineId === offer.id} onClick={() => setExpandedLineId(current => current === offer.id ? null : offer.id)}><span>Line {index + 1}{offer.sourcePage ? ` · page ${offer.sourcePage}` : ""}</span><strong>{offer.description || "Unnamed offered material"}</strong><small>{offer.quantity} {offer.unit || "units"} · {format(quote.currency, offer.unitPrice)} each · {offer.requestItemId ? `Matched to ${request.items.find(item => item.id === offer.requestItemId)?.name || "MRF material"}` : "Unmatched / extra"}</small><small>{offer.requestItemId ? offer.matchConfirmed ? "MRF match confirmed" : "MRF match needs review" : "Cannot be awarded"}</small></button><button className="text-link" type="button" onClick={() => patch({ lines: quote.lines?.filter(value => value.id !== offer.id) })}>Remove line</button></div><div hidden={expandedLineId !== offer.id} className="quote-line-details"><div className="quote-match-row"><Field label="Required MRF material"><select value={offer.requestItemId} onChange={event => line(offer.id, { requestItemId: event.target.value, matchConfirmed: false })}><option value="">Unmatched / extra</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit} required</option>)}</select></Field>{offer.requestItemId && <p>Requested: {request.items.find(item => item.id === offer.requestItemId)?.quantity} {request.items.find(item => item.id === offer.requestItemId)?.unit}. Compare the supplier description, unit, and price before confirming.</p>}</div><div className="form-grid">
      <Field label="Description"><input value={offer.description} onChange={event => line(offer.id, { description: event.target.value })}/></Field>
      <Field label="Supplier item code"><input value={offer.supplierItemCode || ""} onChange={event => line(offer.id, { supplierItemCode: event.target.value })}/></Field>
      <Field label="Quoted quantity"><input type="number" min="0" step="any" value={offer.quantity} onChange={event => line(offer.id, { quantity: num(event.target.value) })}/></Field>
      <Field label="Quoted unit"><input value={offer.unit} onChange={event => line(offer.id, { unit: event.target.value, matchConfirmed: false })}/></Field>
      <Field label="Unit price"><input type="number" min="0" step="any" value={offer.unitPrice} onChange={event => line(offer.id, { unitPrice: num(event.target.value) })}/></Field>
      <Field label="MRF units per quoted unit"><input type="number" min="0.0001" step="any" value={offer.conversionFactor} onChange={event => line(offer.id, { conversionFactor: num(event.target.value), matchConfirmed: false })}/></Field>
      <Field label="Brand"><input value={offer.brand} onChange={event => line(offer.id, { brand: event.target.value })}/></Field>
      <Field label="Specification"><input value={offer.specification} onChange={event => line(offer.id, { specification: event.target.value })}/></Field>
      <Field label="Unit or specification difference"><input value={offer.varianceReason} onChange={event => line(offer.id, { varianceReason: event.target.value })}/></Field>
      <Field label="Discount type"><select value={offer.discountType || "none"} onChange={event => line(offer.id, { discountType: event.target.value as QuoteLine["discountType"] })}><option value="none">None</option><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></Field>
      <Field label="Discount value"><input type="number" min="0" step="any" value={offer.discountValue || 0} onChange={event => line(offer.id, { discountValue: num(event.target.value) })}/></Field>
      <Field label="Tax rate %"><input type="number" min="0" step="any" value={offer.taxRate || 0} onChange={event => line(offer.id, { taxRate: num(event.target.value) })}/></Field>
      <Field label="Printed line total"><input type="number" min="0" step="any" value={offer.printedTotal ?? ""} onChange={event => line(offer.id, { printedTotal: event.target.value ? num(event.target.value) : null })}/></Field>
      <Field label="Lead time"><input value={offer.leadTime || ""} onChange={event => line(offer.id, { leadTime: event.target.value })}/></Field>
      <Field label="Line notes"><input value={offer.notes || ""} onChange={event => line(offer.id, { notes: event.target.value })}/></Field>
    </div><p className="helper-note">Calculated: {format(quote.currency, quoteLineTotal(offer))}{offer.printedTotal !== null && offer.printedTotal !== undefined ? ` · Printed: ${format(quote.currency, offer.printedTotal)}` : ""}</p>
      {offer.requestItemId && <label className="quote-check"><input type="checkbox" checked={offer.matchConfirmed === true} onChange={event => line(offer.id, { matchConfirmed: event.target.checked })}/> Confirm MRF match{offer.matchConfidence ? ` · AI confidence: ${offer.matchConfidence}` : ""}{offer.matchRationale ? ` · ${offer.matchRationale}` : ""}</label>}
      {offer.printedTotal !== null && offer.printedTotal !== undefined && Math.abs(quoteLineTotal(offer) - offer.printedTotal) > 0.01 && <Field label="Reason for accepting printed total difference"><input value={offer.discrepancyReason || ""} onChange={event => line(offer.id, { discrepancyReason: event.target.value })}/></Field>}
    </div></article>)}
    <button className="button secondary" type="button" onClick={() => patch({ lines: [...(quote.lines || []), blankLine()] })}>+ Add offered line</button>
    <h3 className="subheading">Quotation adjustments</h3>{(quote.adjustments || []).map(value => <div className="quote-adjustment-row" key={value.id}><input aria-label="Adjustment label" value={value.label} onChange={event => adjustment(value.id, { label: event.target.value })}/><select aria-label="Adjustment kind" value={value.kind} onChange={event => adjustment(value.id, { kind: event.target.value as QuoteAdjustment["kind"] })}><option value="discount">Discount</option><option value="tax">Tax</option><option value="shipping">Shipping</option><option value="other">Other</option></select><select aria-label="Adjustment calculation" value={value.calculation} onChange={event => adjustment(value.id, { calculation: event.target.value as QuoteAdjustment["calculation"] })}><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select><input aria-label="Adjustment value" type="number" min="0" step="any" value={value.value} onChange={event => adjustment(value.id, { value: num(event.target.value) })}/><button className="text-link" onClick={() => patch({ adjustments: quote.adjustments?.filter(item => item.id !== value.id) })}>Remove</button></div>)}<button className="button secondary" type="button" onClick={() => patch({ adjustments: [...(quote.adjustments || []), { id: newId("adjustment"), label: "", kind: "other", calculation: "fixed", value: 0 }] })}>+ Add adjustment</button>
    <div className="quote-review-issues"><strong>{issues.length ? `${issues.length} items to resolve` : `Ready to finalize · quoted total ${format(quote.currency, quoteTotal(state, quote))}`}</strong>{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}</div>
    <div className="form-actions"><button className="button primary" type="button" disabled={issues.length > 0} onClick={() => void onFinalize()}>Finalize quotation</button></div>
  </section>;
}
