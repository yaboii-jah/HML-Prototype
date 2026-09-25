"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { orderedFor } from "@/src/domain/selectors";

export function AwardPurchaseOrderEdit({ id }: { id: string }) {
  const { snapshot: state, run } = useDemo();
  const router = useRouter();
  const [quoteId, setQuoteId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  if (!state) return null;
  const po = state.pos.find(value => value.id === id);
  if (!po?.lines) return <MissingRecord name="Awarded purchase order" listHref="/purchase-orders"/>;
  const request = state.requests.find(value => value.id === po.mrfId);
  if (!request) return <MissingRecord name="MRF" listHref="/purchase-orders"/>;
  const selectedId = quoteId || po.quoteId;
  const quote = state.quotes.find(value => value.id === selectedId);
  if (!quote?.lines) return <MissingRecord name="Quotation" listHref="/purchase-orders"/>;
  const available = (itemId: string) => Math.max(0, (request.items.find(item => item.id === itemId)?.quantity || 0) - state.pos.filter(value => value.mrfId === request.id && value.id !== po.id && value.status !== "rejected").reduce((sum, value) => sum + orderedFor(state, value, itemId), 0));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const finalize = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "finalize";
    const lines = quote.lines!.filter(line => line.requestItemId && Number(quantities[line.id] ?? (selectedId === po.quoteId ? po.lines?.find(value => value.quoteLineId === line.id)?.quantity : 0)) > 0).map(line => ({ itemId: line.requestItemId, quoteLineId: line.id, quantity: Number(quantities[line.id] ?? (selectedId === po.quoteId ? po.lines?.find(value => value.quoteLineId === line.id)?.quantity : 0)), unitPrice: line.unitPrice / line.conversionFactor }));
    const result = await run({ type: "savePO", id, quoteId: quote.id, lines, tax: Number(form.get("tax")), freight: Number(form.get("freight")), discount: Number(form.get("discount")), reason: String(form.get("reason")), notes: String(form.get("notes")), finalize });
    if (result.ok) router.push(`/purchase-orders/${id}`); else setError(result.message);
  };
  return <><PageHeader eyebrow={`${po.ref} · PROCUREMENT`} title="Edit awarded purchase order" description="Adjust draft quantities and charges before Finance review."/>
    <form className="form-stack" onSubmit={event => void submit(event)}><section className="panel"><h2 className="panel-title">Supplier and awarded materials</h2>
      <Field label="Quotation revision"><select value={selectedId} onChange={event => { setQuoteId(event.target.value); setQuantities({}); }}>
        {state.quotes.filter(value => value.mrfId === request.id && value.lines).map(value => <option key={value.id} value={value.id}>{state.suppliers.find(supplier => supplier.id === value.supplierId)?.name} · {value.ref} · version {value.version || 1}</option>)}
      </select></Field>
      {quote.lines.filter(line => line.requestItemId).map(line => { const item = request.items.find(value => value.id === line.requestItemId); if (!item) return null; const current = selectedId === po.quoteId ? po.lines?.find(value => value.quoteLineId === line.id)?.quantity || 0 : 0; const used = state.pos.filter(value => value.id !== po.id && value.status !== "rejected" && value.quoteId === quote.id).reduce((sum, value) => sum + (value.lines || []).filter(award => award.quoteLineId === line.id).reduce((n, award) => n + award.quantity, 0), 0); const max = Math.max(0, Math.min(available(item.id), line.quantity * line.conversionFactor - used)); return <div className="quote-award-line" key={line.id}><div><strong>{item.name}</strong><small>{line.description} · {money(line.unitPrice / line.conversionFactor)} / {item.unit}</small><small>Up to {max} {item.unit}</small></div><Field label={`Quantity (${item.unit})`}><input type="number" min="0" max={max} step="any" value={quantities[line.id] ?? current} onChange={event => setQuantities({ ...quantities, [line.id]: Number(event.target.value) })}/></Field></div>; })}
      <div className="form-grid"><Field label="PO tax"><input name="tax" type="number" min="0" step="0.01" defaultValue={po.tax || 0}/></Field><Field label="PO freight"><input name="freight" type="number" min="0" step="0.01" defaultValue={po.freight || 0}/></Field><Field label="PO discount"><input name="discount" type="number" min="0" step="0.01" defaultValue={po.discount || 0}/></Field><Field label="Selection reason"><textarea name="reason" minLength={5} required defaultValue={po.selectionReason}/></Field><Field label="PO notes"><textarea name="notes" defaultValue={po.notes}/></Field></div>
      {po.reviewReason && <div className="callout warn"><strong>Finance return reason</strong><p>{po.reviewReason}</p></div>}
    </section><InlineError message={error}/><div className="form-actions"><Link className="button secondary" href={`/purchase-orders/${id}`}>Cancel</Link><button className="button secondary" value="draft">Save draft</button><button className="button primary" value="finalize">Finalize for Finance</button></div></form></>;
}
