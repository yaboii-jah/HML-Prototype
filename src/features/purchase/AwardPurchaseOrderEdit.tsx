"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { hasFinalizedSuccessor, latestFinalizedQuotes } from "@/src/domain/procurement";
import { poLineTotal } from "@/src/domain/pricing";
import { orderedFor } from "@/src/domain/selectors";
import type { POAdjustment, POLine, QuoteLine } from "@/src/domain/types";

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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const finalize = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "finalize";
    if (finalize && !await confirm(`Finalize ${po.ref}?`, "Finance will receive this supplier purchase order for budget review.", "Finalize for Finance")) return;
    const lines: POLine[] = quote.lines!.filter(line => line.requestItemId).map(line => {
      const old = savedLine(line);
      const quantity = num(quantities[line.id] ?? old?.quantity ?? 0);
      return { itemId: line.requestItemId, quoteLineId: line.id, quantity, unitPrice: line.unitPrice / line.conversionFactor, discountType: line.discountType || "none", discountValue: line.discountType === "fixed" ? num(fixedDiscounts[line.id] ?? old?.discountValue ?? 0) : line.discountValue || 0, taxRate: line.taxRate || 0, fixedDiscountConfirmed: line.discountType !== "fixed" || (fixedConfirmed[line.id] ?? old?.fixedDiscountConfirmed ?? false) };
    }).filter(line => line.quantity > 0);
    const result = await run({ type: "savePO", id, quoteId: quote.id, lines, adjustments: po.adjustments ? displayedAdjustments.map(adjustment) : undefined, tax: po.adjustments ? 0 : num(form.get("tax")), freight: po.adjustments ? 0 : num(form.get("freight")), discount: po.adjustments ? 0 : num(form.get("discount")), reason: String(form.get("reason")), notes: String(form.get("notes")), supersededReason: String(form.get("supersededReason") || ""), finalize });
    if (result.ok) router.push(`/purchase-orders/${id}`); else setError(result.message);
  };
  return <><PageHeader eyebrow={`${po.ref} · PROCUREMENT`} title="Edit supplier purchase order" description="Confirm awarded quantities and commercial terms before Finance review."/>
    <form className="form-stack" onSubmit={event => void submit(event)}><section className="panel"><h2 className="panel-title">Supplier and awarded materials</h2><Field label="Quotation revision"><select value={selectedId} onChange={event => { setQuoteId(event.target.value); setQuantities({}); setFixedDiscounts({}); setFixedConfirmed({}); setAdjustmentEdits({}); }}>{choices.map(value => <option key={value.id} value={value.id}>{value.supplierDetails?.name || state.suppliers.find(supplier => supplier.id === value.supplierId)?.name} · {value.ref} · version {value.version || 1}</option>)}</select></Field>
      {quote.lines.filter(line => line.requestItemId).map(line => { const item = request.items.find(value => value.id === line.requestItemId); if (!item) return null; const old = savedLine(line); const current = num(quantities[line.id] ?? old?.quantity ?? 0); const used = state.pos.filter(value => value.id !== po.id && value.status !== "rejected" && value.quoteId === quote.id).reduce((sum, value) => sum + (value.lines || []).filter(award => award.quoteLineId === line.id).reduce((n, award) => n + award.quantity, 0), 0); const max = Math.max(0, Math.min(available(item.id), line.quantity * line.conversionFactor - used)); const preview: POLine = { itemId: item.id, quoteLineId: line.id, quantity: current, unitPrice: line.unitPrice / line.conversionFactor, discountType: line.discountType, discountValue: line.discountType === "fixed" ? num(fixedDiscounts[line.id] ?? old?.discountValue ?? 0) : line.discountValue, taxRate: line.taxRate }; return <div className="quote-award-line" key={line.id}><div><strong>{item.name}</strong><small>{line.description} · {money(preview.unitPrice)} / {item.unit} · delivery: {item.location}</small><small>Up to {max} {item.unit} · estimated line total {money(poLineTotal(preview))}</small><small>{line.discountType === "percentage" ? `${line.discountValue || 0}% line discount` : ""}{line.taxRate ? ` · ${line.taxRate}% line tax` : ""}</small></div><div><Field label={`Quantity (${item.unit})`}><input type="number" min="0" max={max} step="any" value={current} onChange={event => setQuantities(value => ({ ...value, [line.id]: num(event.target.value) }))}/></Field>{line.discountType === "fixed" && <><Field label="Fixed line discount for this PO"><input type="number" min="0" step="any" value={fixedDiscounts[line.id] ?? old?.discountValue ?? 0} onChange={event => { setFixedDiscounts(value => ({ ...value, [line.id]: num(event.target.value) })); setFixedConfirmed(value => ({ ...value, [line.id]: false })); }}/></Field><label className="quote-check"><input type="checkbox" checked={fixedConfirmed[line.id] ?? old?.fixedDiscountConfirmed ?? false} onChange={event => setFixedConfirmed(value => ({ ...value, [line.id]: event.target.checked }))}/> Confirm fixed discount for awarded quantity</label></>}</div></div>; })}
      {po.adjustments ? <><h3 className="subheading">PO adjustments</h3><p className="helper-note">Confirm or exclude every quoted charge. Partial awards may need different fixed amounts.</p>{displayedAdjustments.map(value => { const current = adjustment(value); return <div className="po-adjustment-row" key={value.id}><div><strong>{value.label}</strong><small>{value.kind} · {value.calculation}</small></div><Field label="Amount"><input type="number" min="0" step="any" value={current.value} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], value: num(event.target.value), confirmed: false } }))}/></Field><label className="quote-check"><input type="checkbox" checked={current.included} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], included: event.target.checked, confirmed: false } }))}/> Include</label><label className="quote-check"><input type="checkbox" checked={current.confirmed} onChange={event => setAdjustmentEdits(edits => ({ ...edits, [value.id]: { ...edits[value.id], confirmed: event.target.checked } }))}/> Confirm</label></div>; })}</> : <div className="form-grid"><Field label="PO tax"><input name="tax" type="number" min="0" step="0.01" defaultValue={po.tax || 0}/></Field><Field label="PO freight"><input name="freight" type="number" min="0" step="0.01" defaultValue={po.freight || 0}/></Field><Field label="PO discount"><input name="discount" type="number" min="0" step="0.01" defaultValue={po.discount || 0}/></Field></div>}
      <div className="form-grid"><Field label="Supplier selection reason (optional)"><textarea name="reason" defaultValue={po.selectionReason}/></Field><Field label="PO notes"><textarea name="notes" defaultValue={po.notes}/></Field>{hasFinalizedSuccessor(state, quote.id) && <Field label="Reason for retaining the older quote revision"><textarea name="supersededReason" minLength={5} defaultValue={po.supersededReason || ""} placeholder="Or select the latest quotation above"/></Field>}</div>
      {po.reviewReason && <div className="callout warn"><strong>Finance return reason</strong><p>{po.reviewReason}</p></div>}
    </section><InlineError message={error}/><div className="form-actions"><Link className="button secondary" href={`/purchase-orders/${id}`}>Cancel</Link><button className="button secondary" value="draft">Save draft</button><button className="button primary" value="finalize">Finalize for Finance</button></div></form>{confirmation}</>;
}
