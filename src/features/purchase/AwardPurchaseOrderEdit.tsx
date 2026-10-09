"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { adjustmentClassification } from "@/src/domain/expense-classification";
import { useDemo } from "@/src/app-state/DemoProvider";
import { CollapsibleSection, revealField } from "@/src/components/ui/CollapsibleSection";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { hasFinalizedSuccessor, latestFinalizedQuotes } from "@/src/domain/procurement";
import { poFinancialBreakdown, poLineTotal } from "@/src/domain/pricing";
import { orderedFor } from "@/src/domain/selectors";
import type { POAdjustment, POFinancial, POLine, QuoteLine } from "@/src/domain/types";

import { PoDocumentFields, readPoDocument, readPoFinancial } from "./PoDocumentFields";
import { newPoDocument } from "@/src/domain/po-document";

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function AwardPurchaseOrderEdit({ id }: { id: string }) {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot: state, run } = useDemo();
  const router = useRouter();
  const [quoteId, setQuoteId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fixedDiscounts, setFixedDiscounts] = useState<Record<string, number>>({});
  const [fixedConfirmed, setFixedConfirmed] = useState<Record<string, boolean>>({});
  const [adjustmentEdits, setAdjustmentEdits] = useState<Record<string, Partial<POAdjustment>>>({});
  const [financialReviewed, setFinancialReviewed] = useState(false);
  const [financialDraft, setFinancialDraft] = useState<POFinancial | null>(null);
  const [error, setError] = useState("");
  if (!state) return null;
  const po = state.pos.find(value => value.id === id);
  if (!po?.lines) return <MissingRecord name="Awarded purchase order" listHref="/purchase-orders"/>;
  const request = state.requests.find(value => value.id === po.mrfId);
  if (!request) return <MissingRecord name="MRF" listHref="/purchase-orders"/>;
  const selectedId = quoteId || po.quoteId;
  const quote = state.quotes.find(value => value.id === selectedId);
  if (!quote?.lines) return <MissingRecord name="Quotation" listHref="/purchase-orders"/>;
  const latest = latestFinalizedQuotes(state, request.id).filter(value => value.currency === "PHP" || !value.currency);
  const choices = [quote, ...latest.filter(value => value.id !== quote.id)];
  const available = (itemId: string) => Math.max(0, (request.items.find(value => value.id === itemId)?.quantity || 0) - state.pos.filter(value => value.mrfId === request.id && value.id !== po.id && value.status !== "rejected").reduce((sum, value) => sum + orderedFor(state, value, itemId), 0));
  const savedLine = (line: QuoteLine) => selectedId === po.quoteId ? po.lines?.find(value => value.quoteLineId === line.id) : undefined;
  const displayedAdjustments: POAdjustment[] = selectedId === po.quoteId ? po.adjustments || [] : (quote.adjustments || []).map(value => ({ ...value, included: true, confirmed: false }));
  const adjustment = (value: POAdjustment) => ({ ...value, ...adjustmentEdits[value.id] });
  const currentLines = (): POLine[] => quote.lines!.filter(line => line.requestItemId).map(line => {
    const old = savedLine(line);
    return { itemId: line.requestItemId, quoteLineId: line.id, quantity: num(quantities[line.id] ?? old?.quantity ?? 0), unitPrice: line.unitPrice / line.conversionFactor, discountType: line.discountType || "none", discountValue: line.discountType === "fixed" ? num(fixedDiscounts[line.id] ?? old?.discountValue ?? 0) : line.discountValue || 0, taxRate: line.taxRate || 0, fixedDiscountConfirmed: line.discountType !== "fixed" || (fixedConfirmed[line.id] ?? old?.fixedDiscountConfirmed ?? false) };
  }).filter(line => line.quantity > 0);
  const liveFinancial = po.financial ? poFinancialBreakdown({ ...po, financial: financialDraft || po.financial, lines: currentLines(), adjustments: displayedAdjustments.map(adjustment) }) : undefined;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const finalize = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "finalize";
    if (finalize && !await confirm(`Finalize ${po.ref}?`, "Accounting will receive this supplier purchase order for budget review.", "Submit to Accounting")) return;
    const lines = currentLines();
    const result = await run({ type: "savePO", id, document: po.financial ? readPoDocument(form) : undefined, financial: po.financial ? readPoFinancial(form) : undefined, quoteId: quote.id, lines, adjustments: po.adjustments ? displayedAdjustments.map(adjustment) : undefined, tax: po.adjustments ? 0 : num(form.get("tax")), freight: po.adjustments ? 0 : num(form.get("freight")), discount: po.adjustments ? 0 : num(form.get("discount")), reason: String(form.get("reason")), notes: String(form.get("notes")), supersededReason: String(form.get("supersededReason") || ""), finalize });
    if (result.ok) router.push(`/purchase-orders/${id}`); else {
      setError(result.message);
      let target: HTMLElement | null = formElement.querySelector(":invalid");
      if (result.message.startsWith("Complete the PO date")) {
        target = ["date", "vendorName", "shipToName", "shipToAddress", "requisitioner", "terms"].map(key => formElement.querySelector<HTMLInputElement>(`[name="poDocument.${key}"]`)).find(field => !field?.value.trim() || !field.validity.valid) || null;
      } else if (result.message.startsWith("Confirm the VAT basis")) {
        target = formElement.querySelector('[name="financialReviewed"]');
      } else if (result.message.startsWith("EWT deductions")) {
        target = formElement.querySelector('[name="ewtGoods"]');
      }
      requestAnimationFrame(() => revealField(target || formElement.querySelector<HTMLElement>(".po-edit-error")));
    }
  };
  return <><PageHeader eyebrow={`${po.ref} · PROCUREMENT`} title="Edit supplier purchase order" description="Confirm awarded quantities and commercial terms before submitting to Accounting."/>
    <form className="form-stack po-edit-form" onChange={event => { if ((event.target instanceof Element ? event.target.getAttribute("name") : "") !== "financialReviewed") setFinancialReviewed(false);  }} onSubmit={event => void submit(event)}><section className="panel"><CollapsibleSection title="Supplier and materials"><Field label="Quotation revision"><select value={selectedId} onChange={event => { setQuoteId(event.target.value); setQuantities({}); setFixedDiscounts({}); setFixedConfirmed({}); setAdjustmentEdits({}); setFinancialDraft(null); }}>{choices.map(value => <option key={value.id} value={value.id}>{value.supplierDetails?.name || state.suppliers.find(supplier => supplier.id === value.supplierId)?.name} · {value.ref} · version {value.version || 1}</option>)}</select></Field>
      {quote.lines.filter(line => line.requestItemId).map(line => { const item = request.items.find(value => value.id === line.requestItemId); if (!item) return null; const old = savedLine(line); const current = num(quantities[line.id] ?? old?.quantity ?? 0); const used = state.pos.filter(value => value.id !== po.id && value.status !== "rejected" && value.quoteId === quote.id).reduce((sum, value) => sum + (value.lines || []).filter(award => award.quoteLineId === line.id).reduce((n, award) => n + award.quantity, 0), 0); const max = Math.max(0, Math.min(available(item.id), line.quantity * line.conversionFactor - used)); const preview: POLine = { itemId: item.id, quoteLineId: line.id, quantity: current, unitPrice: line.unitPrice / line.conversionFactor, discountType: line.discountType, discountValue: line.discountType === "fixed" ? num(fixedDiscounts[line.id] ?? old?.discountValue ?? 0) : line.discountValue, taxRate: line.taxRate }; return <div className="quote-award-line" key={line.id}><div><strong>{item.name}</strong><small>{line.description} · {money(preview.unitPrice)} / {item.unit} · delivery: {item.location}</small><small>Up to {max} {item.unit} · estimated line total {money(liveFinancial ? liveFinancial.lines.find(value => value.line.quoteLineId === line.id)?.amount || 0 : poLineTotal(preview))}</small><small>{line.discountType === "percentage" ? `${line.discountValue || 0}% line discount` : ""}{line.taxRate ? ` · ${line.taxRate}% line tax` : ""}</small></div><div><Field label={`Quantity (${item.unit})`}><input type="number" min="0" max={max} step="any" value={current} onChange={event => setQuantities(value => ({ ...value, [line.id]: num(event.target.value) }))}/></Field>{line.discountType === "fixed" && <><Field label="Fixed line discount for this PO"><input type="number" min="0" step="any" value={fixedDiscounts[line.id] ?? old?.discountValue ?? 0} onChange={event => { setFixedDiscounts(value => ({ ...value, [line.id]: num(event.target.value) })); setFixedConfirmed(value => ({ ...value, [line.id]: false })); }}/></Field><label className="quote-check"><input type="checkbox" checked={fixedConfirmed[line.id] ?? old?.fixedDiscountConfirmed ?? false} onChange={event => setFixedConfirmed(value => ({ ...value, [line.id]: event.target.checked }))}/> Confirm fixed discount for awarded quantity</label></>}</div></div>; })}
      </CollapsibleSection>{po.adjustments ? <><CollapsibleSection title="PO adjustments" defaultOpen={displayedAdjustments.length > 0}>{po.financial && <p className="helper-note">Source tax adjustments are shown for review and replaced by the VAT setting below.</p>}<p className="helper-note">Confirm or exclude every quoted charge. Partial awards may need different fixed amounts.</p>{displayedAdjustments.map(value => { const current = adjustment(value); return <div className="po-adjustment-row" key={value.id}><div><strong>{value.label}</strong><small>{adjustmentClassification(value.kind)} · {value.kind} · {value.calculation}</small></div><Field label="Amount"><input type="number" min="0" step="any" value={current.value} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], value: num(event.target.value), confirmed: false } }))}/></Field><label className="quote-check"><input type="checkbox" checked={current.included} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], included: event.target.checked, confirmed: false } }))}/> Include</label>{po.financial && value.kind !== "tax" && <label className="quote-check"><input type="checkbox" checked={current.taxable !== false} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], taxable: event.target.checked, confirmed: false } }))}/> Taxable</label>}<label className="quote-check"><input type="checkbox" checked={current.confirmed} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], confirmed: event.target.checked } }))}/> Confirm</label></div>; })}</CollapsibleSection></> : <div className="form-grid"><Field label="PO tax"><input name="tax" type="number" min="0" step="0.01" defaultValue={po.tax || 0}/></Field><Field label="PO freight"><input name="freight" type="number" min="0" step="0.01" defaultValue={po.freight || 0}/></Field><Field label="PO discount"><input name="discount" type="number" min="0" step="0.01" defaultValue={po.discount || 0}/></Field></div>}
      <CollapsibleSection title="Selection reason and notes" defaultOpen={hasFinalizedSuccessor(state, quote.id)}><div className="form-grid"><Field label="Supplier selection reason (optional)"><textarea name="reason" defaultValue={po.selectionReason}/></Field><Field label="PO notes"><textarea name="notes" defaultValue={po.notes}/></Field>{hasFinalizedSuccessor(state, quote.id) && <Field label="Reason for retaining the older quote revision"><textarea name="supersededReason" minLength={5} defaultValue={po.supersededReason || ""} placeholder="Or select the latest quotation above"/></Field>}</div>
      </CollapsibleSection>{po.reviewReason && <div className="callout warn"><strong>Accounting return reason</strong><p>{po.reviewReason}</p></div>}
    </section>{po.financial && <PoDocumentFields key={selectedId} document={selectedId === po.quoteId && po.document ? po.document : newPoDocument(request, quote, state.sites.find(site => site.id === request.siteId)!, po.createdAt)} financial={financialDraft || po.financial} reviewed={financialReviewed} onReview={setFinancialReviewed} onFinancialChange={setFinancialDraft} breakdown={liveFinancial}/>}{liveFinancial && <section className="panel"><h2 className="panel-title">Payable total</h2><div className="data-rows"><div><span>Gross purchase value</span><strong>{money(liveFinancial.gross)}</strong></div><div><span>EWT goods / services</span><strong>{money(liveFinancial.ewtGoods)} / {money(liveFinancial.ewtServices)}</strong></div><div><span>Net supplier payable</span><strong>{money(liveFinancial.net)}</strong></div></div></section>}<div className="po-edit-error" tabIndex={-1}><InlineError message={error}/></div><div className="form-actions po-edit-actions">{liveFinancial && <div className="po-action-total"><small>Net supplier payable</small><strong>{money(liveFinancial.net)}</strong></div>}<Link className="button secondary" href={`/purchase-orders/${id}`}>Cancel</Link><button className="button secondary" value="draft">Save draft</button><button className="button primary" value="finalize">Submit to Accounting</button></div></form>{confirmation}</>;
}
