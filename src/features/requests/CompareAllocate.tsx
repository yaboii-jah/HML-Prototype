"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Badge, Empty, Field, InlineError } from "@/src/components/ui/Primitives";
import type { ConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { normalizedQuantity } from "@/src/domain/delivery-flow";
import { money } from "@/src/domain/format";
import { latestFinalizedQuotes } from "@/src/domain/procurement";
import { quoteLineTotal } from "@/src/domain/pricing";
import { QuotationFinancialSummary } from "./QuotationFinancialFields";
import { orderedFor, poSupplierId } from "@/src/domain/selectors";
import type { DemoSnapshot, MRF, Quote, QuoteLine } from "@/src/domain/types";
import { BidComparisonReports } from "./BidComparisonReports";

type Offer = { quote: Quote; line: QuoteLine };
const supplier = (state: DemoSnapshot, quote: Quote) => quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier";
const price = (quote: Quote, value: number) => !quote.currency || quote.currency === "PHP" ? money(value) : `${quote.currency} ${value.toFixed(2)}`;

export function CompareAllocate({ state, request, initialMaterialId, canEdit, working, confirmAction, onGenerated, onPreview, onReview }: {
  state: DemoSnapshot; request: MRF; initialMaterialId: string; canEdit: boolean; working: boolean;
  confirmAction: ConfirmedAction; onGenerated: () => void; onPreview: (quote: Quote) => void; onReview: (quote: Quote) => void;
}) {
  const { run } = useDemo();
  const { notify, update } = useActionFeedback();
  const [selectedId, setSelectedId] = useState(initialMaterialId || request.items[0]?.id || "");
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [mobileDetail, setMobileDetail] = useState(!!initialMaterialId);
  const [edits, setEdits] = useState<Record<string, string>>({}), [errors, setErrors] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({}), [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false), [generating, setGenerating] = useState(false), [details, setDetails] = useState<Offer | null>(null);
  const pending = useRef(false), reviewTrigger = useRef<HTMLButtonElement>(null), materialTitle = useRef<HTMLHeadingElement>(null);
  const quotes = state.quotes.filter(quote => quote.mrfId === request.id), finalized = latestFinalizedQuotes(state, request.id);
  const staged = state.pendingAwards.filter(award => award.requestId === request.id);
  const pos = state.pos.filter(po => po.mrfId === request.id && po.status !== "rejected");
  const selected = request.items.find(item => item.id === selectedId) || request.items[0];
  const saved = (lineId: string) => staged.find(award => award.quoteLineId === lineId)?.quantity || 0;
  const value = (lineId: string) => edits[lineId] ?? String(saved(lineId));
  const dirty = (lineId: string) => edits[lineId] !== undefined && (!edits[lineId].trim() || !Number.isFinite(Number(edits[lineId])) || Number(edits[lineId]) !== saved(lineId));
  const materialLines = (itemId: string) => quotes.flatMap(quote => (quote.lines || []).filter(line => line.requestItemId === itemId).map(line => ({ quote, line })));
  const materialEdited = (itemId: string) => materialLines(itemId).some(({ line }) => dirty(line.id));
  const ordered = (itemId: string) => normalizedQuantity(pos.reduce((sum, po) => sum + orderedFor(state, po, itemId), 0));
  const allocated = (itemId: string) => normalizedQuantity(staged.filter(award => award.itemId === itemId).reduce((sum, award) => sum + award.quantity, 0));
  const remaining = (itemId: string) => Math.max(0, normalizedQuantity((request.items.find(item => item.id === itemId)?.quantity || 0) - ordered(itemId) - allocated(itemId)));
  const editedCount = request.items.filter(item => materialEdited(item.id)).length;
  const blocked = working || generating;
  const activePO = (quote: Quote) => pos.find(po => poSupplierId(state, po) === quote.supplierId);
  const eligibility = (quote: Quote) => !finalized.some(current => current.id === quote.id) ? "Earlier quotation revision" : quote.currency && quote.currency !== "PHP" ? "Only PHP offers can be allocated" : quote.archive?.status === "pending" ? "Quotation archive pending" : activePO(quote) ? "An active PO already exists" : "";
  const capacity = ({ quote, line }: Offer) => Math.max(0, normalizedQuantity(line.quantity * line.conversionFactor - pos.filter(po => po.quoteId === quote.id).reduce((sum, po) => sum + (po.lines || []).filter(row => row.quoteLineId === line.id).reduce((total, row) => total + row.quantity, 0), 0)));
  const offers = selected ? materialLines(selected.id).filter(({ quote, line }) => finalized.some(current => current.id === quote.id) || saved(line.id) > 0 || dirty(line.id)) : [];
  const reset = (itemId: string) => {
    const ids = new Set(materialLines(itemId).map(({ line }) => line.id));
    setEdits(current => Object.fromEntries(Object.entries(current).filter(([key]) => !ids.has(key))));
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !ids.has(key)))); setError("");
  };
  const edit = (lineId: string, quantity: string) => { setEdits(current => ({ ...current, [lineId]: quantity })); setErrors(current => ({ ...current, [lineId]: "" })); setError(""); };
  const choose = (itemId: string) => { setSelectedId(itemId); setMobileDetail(true); setError(""); requestAnimationFrame(() => materialTitle.current?.focus({ preventScroll: true })); };
  const fillRemaining = (offer: Offer) => {
    if (!selected) return;
    const other = offers.filter(row => row.line.id !== offer.line.id).reduce((sum, row) => sum + Math.max(0, Number(value(row.line.id)) || 0), 0);
    edit(offer.line.id, String(Math.max(0, Math.min(capacity(offer), normalizedQuantity(selected.quantity - ordered(selected.id) - other)))));
  };
  const apply = async () => {
    if (!selected || !canEdit || blocked) return;
    const invalid: Record<string, string> = {};
    for (const offer of offers) {
      const raw = value(offer.line.id), quantity = Number(raw), max = capacity(offer);
      if (!raw.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > max + 0.000001) invalid[offer.line.id] = `Enter a quantity between 0 and ${max}.`;
      else if (quantity > 0 && eligibility(offer.quote)) invalid[offer.line.id] = eligibility(offer.quote);
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) { setError("Correct the highlighted award quantities before applying."); return; }
    if (offers.reduce((sum, offer) => sum + Number(value(offer.line.id)), 0) + ordered(selected.id) > selected.quantity + 0.000001) { setError("Awarded quantities exceed the remaining MRF quantity. Reduce an allocation before applying."); return; }
    const changed = offers.filter(offer => dirty(offer.line.id));
    await confirmAction(`Apply allocations for ${selected.name}?`, changed.map(({ quote, line }) => `${supplier(state, quote)} · ${quote.ref}: ${saved(line.id)} → ${value(line.id)} ${selected.unit}`).join("\n") + "\nPurchase orders are generated separately.", "Apply allocations", async () => {
      const toast = notify({ tone: "progress", title: `Applying allocations for ${selected.name}…`, detail: `${changed.length} supplier line${changed.length === 1 ? "" : "s"} changed` });
      const result = await run({ type: "replaceMaterialAwards", requestId: request.id, itemId: selected.id, awards: offers.filter(offer => Number(value(offer.line.id)) > 0).map(({ quote, line }) => ({ quoteId: quote.id, quoteLineId: line.id, quantity: Number(value(line.id)) })) });
      if (result.ok) { reset(selected.id); update(toast, { tone: "success", title: "Allocations applied.", detail: selected.name }); } else { setError(result.message); update(toast, { tone: "error", title: result.message, detail: selected.name }); }
    });
  };
  const generate = async () => {
    if (!canEdit || editedCount || !staged.length || pending.current || working) return;
    pending.current = true; setGenerating(true); setError("");
    const toast = notify({ tone: "progress", title: "Generating supplier PO drafts…", detail: `${staged.length} saved award${staged.length === 1 ? "" : "s"}` });
    try {
      const result = await run({ type: "generateAwardPOs", requestId: request.id, reasons });
      if (result.ok) { update(toast, { tone: "success", title: result.message, detail: request.ref }); setReviewOpen(false); onGenerated(); }
      else { setError(result.message); update(toast, { tone: "error", title: result.message, detail: request.ref }); }
    } catch (cause) { const text = cause instanceof Error ? cause.message : "PO drafts could not be generated. Try again."; setError(text); update(toast, { tone: "error", title: text, detail: request.ref }); }
    finally { pending.current = false; setGenerating(false); }
  };
  const applyAll = async () => {
    if (!canEdit || blocked || !editedCount) return;
    const materials = request.items.filter(item => materialEdited(item.id));
    const invalid: Record<string, string> = {};
    for (const item of materials) {
      const rows = materialLines(item.id);
      for (const offer of rows) {
        const raw = value(offer.line.id), quantity = Number(raw);
        if (!raw.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > capacity(offer) + 0.000001) invalid[offer.line.id] = `Enter a quantity between 0 and ${capacity(offer)}.`;
        else if (quantity > 0 && eligibility(offer.quote)) invalid[offer.line.id] = eligibility(offer.quote);
      }
      if (rows.reduce((sum, row) => sum + Number(value(row.line.id)), 0) + ordered(item.id) > item.quantity + 0.000001) { choose(item.id); setError(`Allocations exceed the requested quantity for ${item.name}.`); return; }
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) { const first = materials.find(item => materialLines(item.id).some(row => invalid[row.line.id])); if (first) choose(first.id); setError("Correct the highlighted quantities before applying all edits."); return; }
    const batch = materials.map(item => ({ itemId: item.id, awards: materialLines(item.id).filter(row => Number(value(row.line.id)) > 0).map(({ quote, line }) => ({ quoteId: quote.id, quoteLineId: line.id, quantity: Number(value(line.id)) })) }));
    await confirmAction(`Apply edits for ${materials.length} materials?`, `${materials.map(item => item.name).join(" · ")}\nAll edits are saved together. Partial purchasing is allowed; POs are generated separately.`, "Apply all edits", async () => {
      const result = await run({ type: "replaceMaterialAwardBatch", requestId: request.id, materials: batch });
      if (result.ok) { setEdits({}); setErrors({}); setError(""); notify({ tone: "success", title: result.message }); }
      else { setError(result.message); notify({ tone: "error", title: result.message }); }
    });
  };
  const visibleMaterials = request.items.filter(item => (!search.trim() || `${item.name} ${item.unit}`.toLowerCase().includes(search.trim().toLowerCase())) && (filter === "all" || filter === "remaining" && remaining(item.id) > 0 || filter === "edited" && materialEdited(item.id)));
  const next = selected && [...request.items.slice(request.items.indexOf(selected) + 1), ...request.items.slice(0, request.items.indexOf(selected))].find(item => remaining(item.id) > 0);
  const grouped = quotes.filter(quote => staged.some(award => award.quoteId === quote.id));
  return <>
    <CollapsibleSection title="Comparison reports" summary="PDF / Excel exports and saved versions" defaultOpen><BidComparisonReports requestId={request.id}/></CollapsibleSection>
    <section className={`panel compare-allocate ${mobileDetail ? "is-detail" : "is-list"}`} aria-label="Compare and allocate materials">
      <div className="panel-heading"><div><h2>Compare &amp; allocate</h2><p className="helper-note">Choose offers and apply allocations one material at a time.</p></div><Badge>{request.items.length} materials</Badge></div>
      <div className="allocation-workspace">
        <aside className="allocation-materials" aria-label="MRF materials">
          <input type="search" aria-label="Search allocation materials" placeholder="Search material" value={search} onChange={event => setSearch(event.target.value)}/>
          <div className="view-tabs" aria-label="Filter allocation materials">{["all", "remaining", "edited"].map(option => <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>{option === "all" ? "All" : option === "remaining" ? "Remaining" : "Edited"}</button>)}</div>
          <div className="allocation-material-list">{visibleMaterials.map(item => <button key={item.id} type="button" data-allocation-material={item.id} aria-current={selected?.id === item.id ? "true" : undefined} onClick={() => choose(item.id)}><strong>{item.name}</strong><small>{remaining(item.id)} of {item.quantity} {item.unit} remaining</small>{materialEdited(item.id) && <span className="badge warn">Edited</span>}</button>)}{!visibleMaterials.length && <Empty detail="No materials match these filters."/>}</div>
        </aside>
        <div className="allocation-offers">
          <button type="button" className="button secondary allocation-back" onClick={() => { setMobileDetail(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-allocation-material="${selected?.id}"]`)?.focus()); }}>← Materials</button>
          {selected ? <>
            <h3 ref={materialTitle} tabIndex={-1}>{selected.name}</h3>
            <div className="allocation-coverage">{[["Requested", selected.quantity], ["Ordered", ordered(selected.id)], ["Saved allocation", allocated(selected.id)], ["Remaining", remaining(selected.id)]].map(([label, quantity]) => <div key={label}><small>{label}</small><strong>{quantity} {selected.unit}</strong></div>)}</div>
            <p className="helper-note">Base prices are converted to {selected.unit}; discounts, tax and fees are shown in offer details.</p>
            <div className="table-frame allocation-offer-table"><table className="quote-material-table"><thead><tr><th>Supplier / offer</th><th className="numeric">Base price / {selected.unit}</th><th className="numeric">Available ({selected.unit})</th><th>Award ({selected.unit})</th><th>Details</th></tr></thead><tbody>
              {offers.map(offer => { const { quote, line } = offer, reason = eligibility(quote), existingPO = activePO(quote); return <tr key={line.id} data-allocation-offer={line.id} data-quote-ref={quote.ref}>
                <td><strong>{supplier(state, quote)}</strong><small>{quote.ref} · v{quote.version || 1} · {quote.financial?.vatStatus === "NON-VAT" ? "NON VAT" : quote.financial?.vatStatus || "VAT not reviewed"}</small><span>{line.description}</span>{reason && <small className="field-error">{reason}</small>}{existingPO && <Link className="text-link" href={`/purchase-orders/${existingPO.id}`}>Open {existingPO.ref}</Link>}</td>
                <td className="numeric">{price(quote, line.unitPrice / line.conversionFactor)}</td><td className="numeric">{capacity(offer)}</td>
                <td><div className="quote-award-edit"><Field label={`Award quantity (${selected.unit})`} error={errors[line.id]}><input aria-label={`Award ${quote.ref} ${line.description}`} type="number" min="0" max={capacity(offer)} step="any" disabled={!canEdit || blocked || !!reason} value={value(line.id)} onChange={event => edit(line.id, event.target.value)}/></Field>{canEdit && !reason && <button type="button" className="text-link" disabled={blocked} onClick={() => fillRemaining(offer)}>Fill remaining</button>}{canEdit && reason && saved(line.id) > 0 && <button type="button" className="text-link" disabled={blocked} onClick={() => edit(line.id, "0")}>Remove allocation</button>}</div></td>
                <td><button type="button" className="text-link" onClick={() => setDetails(offer)}>Details</button></td>
              </tr>; })}
              {finalized.filter(quote => !quote.lines?.some(line => line.requestItemId === selected.id)).map(quote => <tr key={quote.id}><td>{supplier(state, quote)}<small>{quote.ref}</small></td><td colSpan={4} className="muted">Not quoted</td></tr>)}
              {!offers.length && !finalized.length && <tr><td colSpan={5}>Finalize supplier quotations to compare offers.</td></tr>}
            </tbody></table></div>
            <InlineError message={error}/>
            <div className="allocation-material-actions">{canEdit && <><button type="button" className="button primary" disabled={blocked || !materialEdited(selected.id)} onClick={() => void apply()}>Apply allocations</button><button type="button" className="button secondary" disabled={blocked || !materialEdited(selected.id)} onClick={() => reset(selected.id)}>Reset</button></>}{next && <button type="button" className="text-link" onClick={() => choose(next.id)}>Next remaining material →</button>}</div>
          </> : <Empty detail="This request has no materials."/>}
        </div>
      </div>
      <footer className="allocation-footer"><div><strong>{request.items.filter(item => remaining(item.id) === 0).length} of {request.items.length} materials covered</strong><small>{staged.length} saved awards · {editedCount} materials with unapplied edits</small><small>Applied allocations survive refresh. Unapplied edits last while this workspace is open.</small></div><div className="button-row">{canEdit && editedCount > 0 && <button type="button" className="button primary" disabled={blocked} onClick={() => void applyAll()}>Apply all edits ({editedCount})</button>}<button ref={reviewTrigger} type="button" className="button secondary" disabled={!staged.length || blocked} onClick={() => { setError(""); setReviewOpen(true); }}>Review allocations</button></div></footer>
    </section>
    <CollapsibleSection title="Quotation financial summaries" defaultOpen={false}>{finalized.map(quote => <section className="panel" key={quote.id}><h3>{supplier(state, quote)} · {quote.ref}</h3><QuotationFinancialSummary quote={quote}/><button type="button" className="button secondary" onClick={() => onReview(quote)}>Review VAT / NON VAT</button></section>)}</CollapsibleSection>
    <RecordModal open={reviewOpen} title="Review supplier allocations" onClose={() => { if (!generating) setReviewOpen(false); }} returnFocus={() => reviewTrigger.current}>
      <div className="allocation-review"><p>These saved awards will become supplier PO drafts. Partial purchasing is allowed; taxes, discounts and charges are reviewed during PO preparation.</p>
        {editedCount > 0 && <div className="callout warn">Apply or reset edits for {editedCount} materials before generating PO drafts.</div>}
        {grouped.map(quote => { const awards = staged.filter(award => award.quoteId === quote.id); return <section key={quote.id}><h3>{supplier(state, quote)} · {quote.ref}</h3><div className="table-frame"><table><thead><tr><th>Material</th><th>Saved quantity</th><th>Base estimate</th></tr></thead><tbody>{awards.map(award => { const item = request.items.find(value => value.id === award.itemId), line = quote.lines?.find(value => value.id === award.quoteLineId); return <tr key={award.id}><td>{item?.name}</td><td>{award.quantity} {item?.unit}</td><td>{line ? price(quote, award.quantity * line.unitPrice / line.conversionFactor) : "Unavailable"}</td></tr>; })}</tbody></table></div>{eligibility(quote) && <p className="field-error">{eligibility(quote)}. Return to the material to remove or replace these allocations.</p>}{canEdit && <Field label="Supplier selection reason (optional)"><textarea data-supplier-reason={quote.supplierId} disabled={generating} value={reasons[quote.supplierId] || ""} onChange={event => setReasons(current => ({ ...current, [quote.supplierId]: event.target.value }))}/></Field>}</section>; })}
        <InlineError message={error}/><div className="form-actions">{canEdit && <button type="button" className="button primary" disabled={blocked || !!editedCount || !staged.length || grouped.some(quote => !!eligibility(quote))} onClick={() => void generate()}>{generating ? "Generating…" : "Generate supplier PO drafts"}</button>}</div>
      </div>
    </RecordModal>
    <RecordModal open={!!details} title="Supplier offer details" onClose={() => setDetails(null)}>{details && <><h3>{supplier(state, details.quote)} · {details.quote.ref}</h3><p>{details.line.description}</p><div className="data-rows">
      <div><span>Quoted price / unit</span><strong>{price(details.quote, details.line.unitPrice)} / {details.line.unit}</strong></div><div><span>Conversion factor</span><strong>{details.line.conversionFactor}</strong></div><div><span>Adjusted line price / MRF unit</span><strong>{price(details.quote, quoteLineTotal(details.line) / (details.line.quantity * details.line.conversionFactor))}</strong></div><div><span>Discount</span><strong>{details.line.discountValue || 0} ({details.line.discountType || "none"})</strong></div><div><span>Line tax</span><strong>{details.line.taxRate || 0}%</strong></div><div><span>Difference / specification</span><strong>{details.line.varianceReason || details.line.specification || "—"}</strong></div><div><span>Availability / lead time</span><strong>{details.quote.available || "—"} · {details.quote.leadDays} days</strong></div><div><span>Payment / delivery terms</span><strong>{details.quote.terms || "—"} · {details.quote.deliveryTerms || "—"}</strong></div>
      {(details.quote.adjustments || []).map(adjustment => <div key={adjustment.id}><span>{adjustment.label}</span><strong>{adjustment.value} {adjustment.calculation === "percentage" ? "%" : details.quote.currency || "PHP"}</strong></div>)}
    </div>{details.quote.documents.length > 0 && <button type="button" className="button secondary" onClick={() => { const quote = details.quote; setDetails(null); onPreview(quote); }}>View supplier documents</button>}</>}</RecordModal>
  </>;
}
