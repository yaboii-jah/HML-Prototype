"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { MaterialDetailsModal, MaterialDetailsRow, MaterialDetailsTrigger } from "@/src/components/ui/MaterialDetails";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Badge, Empty, Field, InlineError } from "@/src/components/ui/Primitives";
import type { ConfirmedAction } from "@/src/components/ui/useConfirmedAction";
import { normalizedQuantity } from "@/src/domain/delivery-flow";
import { money } from "@/src/domain/format";
import { comparableMaterialAmount, comparableUnitPrice, comparisonFinancialError, comparisonPriceText } from "@/src/domain/comparative-pricing";
import { activeSupplierPO, awardInputDirty, awardInputValue, chooseMaterialOffer, currentComparisonQuotes, materialAwardOffers, materialAwardStatus, offerAwardCapacity, offerAwardError, savedAwardQuantity, selectedMaterialOffer, wholeSupplierProposal } from "@/src/domain/comparative-awards";
import type { AwardEdits, ComparisonOffer } from "@/src/domain/comparative-awards";
import type { ComparisonSelections, DemoSnapshot, MRF, Quote } from "@/src/domain/types";
import { QuotationFinancialSummary } from "./QuotationFinancialFields";
import { BidComparisonReports } from "./BidComparisonReports";

const supplier = (state: DemoSnapshot, quote: Quote) => quote.supplierDetails?.name || state.suppliers.find(value => value.id === quote.supplierId)?.name || "Unnamed supplier";
const quotedPrice = (quote: Quote, value: number) => !quote.currency || quote.currency === "PHP" ? money(value) : quote.currency + " " + value.toFixed(2);
const vatLabel = (quote: Quote) => comparisonFinancialError(quote) || (quote.financial?.vatStatus === "NON-VAT" ? "NON-VAT" : "VAT " + quote.financial?.vatRate + "%");
const amountText = (value: number | undefined) => value === undefined ? "—" : money(value);
const positive = (value: string) => Math.max(0, Number(value) || 0);

export function CompareAllocate({ state, request, initialMaterialId, canEdit, working, confirmAction, onGenerated, onPreview, onReview }: {
  state: DemoSnapshot; request: MRF; initialMaterialId: string; canEdit: boolean; working: boolean;
  confirmAction: ConfirmedAction; onGenerated: () => void; onPreview: (quote: Quote) => void; onReview: (quote: Quote) => void;
}) {
  const { run } = useDemo();
  const { notify, update } = useActionFeedback();
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all");
  const [edits, setEdits] = useState<AwardEdits>({}), [error, setError] = useState("");
  const [selections, setSelections] = useState<ComparisonSelections>({});
  const [splitId, setSplitId] = useState(""), [splitEdits, setSplitEdits] = useState<AwardEdits>({}), [splitErrors, setSplitErrors] = useState<Record<string, string>>({});
  const [bulkId, setBulkId] = useState(""), [detailKey, setDetailKey] = useState<{ quoteId: string; lineId: string } | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false), [saving, setSaving] = useState(false), [generating, setGenerating] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const pending = useRef(false), reviewTrigger = useRef<HTMLButtonElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const resumeReview = useRef(false);
  const [scrollPosition, setScrollPosition] = useState({ left: 0, max: 0, nativeVisible: true });
  const blocked = working || saving || generating;
  const quotes = state.quotes.filter(quote => quote.mrfId === request.id);
  const suppliers = currentComparisonQuotes(state, request.id);
  const staged = state.pendingAwards.filter(award => award.requestId === request.id);
  const status = (item: MRF["items"][number], values = edits) => materialAwardStatus(state, request, item, values);
  const value = (lineId: string, values = edits) => awardInputValue(state, request.id, lineId, values);
  const editedItems = request.items.filter(item => status(item).edited);
  const visibleMaterials = request.items.filter(item => (!search.trim() || (item.name + " " + item.unit).toLowerCase().includes(search.trim().toLowerCase())) && (filter === "all" || filter === "remaining" && status(item).unassigned > 0 || filter === "edited" && status(item).edited));
  const splitItem = request.items.find(item => item.id === splitId);
  const splitOffers = splitItem ? materialAwardOffers(state, request.id, splitItem.id).filter(offer => suppliers.some(quote => quote.id === offer.quote.id) || savedAwardQuantity(state, request.id, offer.line.id) > 0 || awardInputDirty(state, request.id, offer.line.id, edits)) : [];
  const bulkQuote = suppliers.find(quote => quote.id === bulkId);
  const bulk = bulkQuote ? wholeSupplierProposal(state, request, bulkQuote, edits, selections) : undefined;
  const detailQuote = quotes.find(quote => quote.id === detailKey?.quoteId);
  const detailLine = detailQuote?.lines?.find(line => line.id === detailKey?.lineId);
  const details = detailQuote && detailLine ? { quote: detailQuote, line: detailLine } : undefined;
  const awards = request.items.flatMap(item => materialAwardOffers(state, request.id, item.id).filter(({ line }) => positive(value(line.id)) > 0).map(offer => ({ ...offer, item, quantity: positive(value(offer.line.id)) })));
  const grouped = quotes.filter(quote => awards.some(award => award.quote.id === quote.id));

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const sync = () => setScrollPosition({ left: element.scrollLeft, max: Math.max(0, element.scrollWidth - element.clientWidth), nativeVisible: element.offsetHeight - element.clientHeight >= 10 });
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", sync, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", sync); };
  }, [suppliers.length]);

  useEffect(() => {
    if (!initialMaterialId) return;
    const frame = requestAnimationFrame(() => {
      const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-comparison-material]") || []).find(element => element.dataset.comparisonMaterial === initialMaterialId);
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
      row?.querySelector<HTMLButtonElement>("[data-material-details-trigger]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialMaterialId]);

  const openDetails = (offer: ComparisonOffer) => { resumeReview.current = reviewOpen; if (reviewOpen) setReviewOpen(false); setDetailKey({ quoteId: offer.quote.id, lineId: offer.line.id }); };
  const closeDetails = () => {
    const lineId = detailKey?.lineId;
    setDetailKey(null);
    if (resumeReview.current) { resumeReview.current = false; setReviewOpen(true); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-review-offer="' + lineId + '"] [data-material-details-trigger]')?.focus({ preventScroll: true })); }
  };
  const openSplit = (itemId: string) => { setSplitEdits({ ...edits }); setSplitErrors({}); setError(""); setSplitId(itemId); };
  const validate = (items: MRF["items"], values: AwardEdits) => {
    const invalid: Record<string, string> = {};
    for (const item of items) {
      for (const offer of materialAwardOffers(state, request.id, item.id)) {
        const raw = value(offer.line.id, values), quantity = Number(raw), capacity = offerAwardCapacity(state, offer);
        if (!raw.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > capacity + 0.000001) invalid[offer.line.id] = "Enter a quantity between 0 and " + capacity + ".";
        else if (quantity > 0 && offerAwardError(state, offer.quote)) invalid[offer.line.id] = offerAwardError(state, offer.quote);
      }
      const coverage = status(item, values);
      if (coverage.proposed + coverage.ordered > item.quantity + 0.000001) invalid[item.id] = "Awards exceed the requested quantity for " + item.name + ".";
    }
    return invalid;
  };
  const applySplit = () => {
    if (!splitItem || !canEdit || blocked) return;
    const invalid = validate([splitItem], splitEdits);
    setSplitErrors(invalid);
    if (Object.keys(invalid).length) return;
    setEdits(current => {
      const next = { ...current };
      for (const { line } of materialAwardOffers(state, request.id, splitItem.id)) next[line.id] = value(line.id, splitEdits);
      return next;
    });
    setSplitId("");
  };
  const save = async () => {
    if (!canEdit || blocked || pending.current || !editedItems.length) return;
    const invalid = validate(editedItems, edits);
    if (Object.keys(invalid).length) { setError(Object.values(invalid)[0] + " Use Split quantity to correct this material."); return; }
    pending.current = true; setSaving(true); setError("");
    const toast = notify({ tone: "progress", title: "Saving supplier awards…", detail: editedItems.length + " materials" });
    try {
      const result = await run({ type: "replaceMaterialAwardBatch", requestId: request.id, materials: editedItems.map(item => ({ itemId: item.id, awards: materialAwardOffers(state, request.id, item.id).filter(({ line }) => positive(value(line.id)) > 0).map(({ quote, line }) => ({ quoteId: quote.id, quoteLineId: line.id, quantity: Number(value(line.id)) })) })) });
      if (result.ok) { setEdits({}); update(toast, { tone: "success", title: "Supplier awards saved.", detail: "Create PO drafts when you are ready." }); }
      else { setError(result.message); update(toast, { tone: "error", title: result.message }); }
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Awards could not be saved. Try again."; setError(message); update(toast, { tone: "error", title: message }); }
    finally { pending.current = false; setSaving(false); }
  };
  const generate = async () => {
    if (!canEdit || blocked || pending.current || editedItems.length || !staged.length) return;
    await confirmAction("Create supplier PO drafts?", "Create separate PO drafts from the saved awards. Partial purchasing is allowed. Confirm discounts, taxes and charges during PO preparation.", "Create PO drafts", async () => {
      pending.current = true; setGenerating(true); setError("");
      const toast = notify({ tone: "progress", title: "Creating supplier PO drafts…" });
      try {
        const result = await run({ type: "generateAwardPOs", requestId: request.id, reasons });
        if (result.ok) { update(toast, { tone: "success", title: result.message }); setReviewOpen(false); onGenerated(); }
        else { setError(result.message); update(toast, { tone: "error", title: result.message }); }
      } catch (cause) { const message = cause instanceof Error ? cause.message : "PO drafts could not be created. Try again."; setError(message); update(toast, { tone: "error", title: message }); }
      finally { pending.current = false; setGenerating(false); }
    });
  };
  const reset = () => void confirmAction("Discard unsaved award choices?", "Restore your saved awards. Comparison offer choices and existing POs are retained.", "Discard changes", () => { setEdits({}); setError(""); });
  const subtotal = (quote: Quote) => {
    let total = 0, complete = true;
    for (const item of request.items) {
      const line = selectedMaterialOffer(quote, item.id, selections);
      const amount = line ? comparableMaterialAmount(quote, line, item) : undefined;
      if (amount === undefined || !line || line.quantity * line.conversionFactor + 0.000001 < item.quantity) complete = false;
      if (amount !== undefined) total += amount;
    }
    return { total, complete };
  };
  const covered = request.items.filter(item => status(item).unassigned === 0).length;
  const oldAwards = staged.filter(award => !suppliers.some(quote => quote.id === award.quoteId));

  return <>
    <CollapsibleSection title="Comparison reports" summary="PDF / Excel exports and saved versions" defaultOpen={false}><BidComparisonReports requestId={request.id} comparisonSelections={selections} onComparisonSelectionsChange={setSelections}/></CollapsibleSection>
    <section className="panel compare-allocate comparative-bid" aria-label="Comparative bid and supplier awards">
      <div className="panel-heading"><div><h2>Compare &amp; award</h2><p className="helper-note">Compare all materials, then choose a supplier for each item or award available materials to one supplier.</p></div><Badge>{request.items.length} materials · {suppliers.length} suppliers</Badge></div>
      <div className="comparative-bid-toolbar">
        <input type="search" aria-label="Search comparison materials" placeholder="Search material" value={search} onChange={event => setSearch(event.target.value)}/>
        <div className="view-tabs" aria-label="Filter comparison materials">{["all", "remaining", "edited"].map(option => <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>{option === "all" ? "All materials" : option === "remaining" ? "Unassigned" : "Unsaved changes"}</button>)}</div>
        <button ref={reviewTrigger} type="button" className="button primary" disabled={blocked || (!staged.length && !editedItems.length)} onClick={() => { setError(""); setReviewOpen(true); }}>{editedItems.length ? "Review & save awards" : "Review saved awards"}</button>
      </div>
      <p className="comparative-bid-basis">Prices include VAT where applicable, after item discounts. Amounts use the full requested quantity. Quotation-level charges, discounts and EWT are separate.</p>
      {oldAwards.length > 0 && <p className="callout warn">Some saved awards use an earlier or unavailable quotation. Use Split quantity to remove or replace those awards before creating PO drafts.</p>}
      {!request.items.length ? <Empty detail="This request has no materials."/> : !suppliers.length ? <Empty detail="Finalize supplier quotations to compare their offers."/> : <>
        <div ref={scrollRef} className="comparative-bid-scroll" role="region" aria-label="Supplier comparison table, scroll horizontally for more suppliers" tabIndex={0}>
          <table className="comparative-bid-table" style={{ "--bid-supplier-count": suppliers.length } as CSSProperties}><caption className="sr-only">Material prices including VAT where applicable. Select suppliers manually; quoted amounts are comparison estimates.</caption>
            <colgroup><col className="bid-material-col"/><col className="bid-quantity-col"/><col className="bid-unit-col"/>{suppliers.map(quote => <Fragment key={quote.id}><col className="bid-price-col"/><col className="bid-amount-col"/></Fragment>)}<col className="bid-award-col"/></colgroup>
            <thead>
              <tr><th className="bid-fixed-material" rowSpan={2} scope="col">Material</th><th className="bid-fixed-quantity numeric" rowSpan={2} scope="col">Qty</th><th className="bid-fixed-unit" rowSpan={2} scope="col">Unit</th>
                {suppliers.map((quote, supplierIndex) => <th colSpan={2} scope="colgroup" key={quote.id} className="bid-supplier-heading" data-supplier-color={supplierIndex % 5}>
                  <strong>{supplier(state, quote)}</strong><small>{quote.ref} · {vatLabel(quote)}</small>
                  <div className="bid-supplier-actions"><button type="button" className="text-link" disabled={blocked} onClick={() => onReview(quote)}>Quotation details</button>{canEdit && <button type="button" className="button secondary" data-award-supplier={quote.id} disabled={blocked || !!offerAwardError(state, quote) || request.items.every(item => status(item).remainingToOrder === 0)} onClick={() => { setError(""); setBulkId(quote.id); }}>Award this supplier</button>}</div>
                  {offerAwardError(state, quote) && <small className="bid-warning">{offerAwardError(state, quote)}</small>}
                </th>)}<th rowSpan={2} scope="col" className="bid-award-heading">Award choices</th>
              </tr>
              <tr>{suppliers.map((quote, supplierIndex) => <Fragment key={quote.id}><th scope="col" className="numeric" data-supplier-color={supplierIndex % 5}>Unit price</th><th scope="col" className="numeric" data-supplier-color={supplierIndex % 5}>Amount</th></Fragment>)}</tr>
            </thead>
            <tbody>{visibleMaterials.map((item) => {
              const coverage = status(item);
              const cellOffers = suppliers.map(quote => { const line = selectedMaterialOffer(quote, item.id, selections); return { quote, line, price: line ? comparableUnitPrice(quote, line) : undefined }; });
              const eligiblePrices = cellOffers.filter(offer => offer.line && !offerAwardError(state, offer.quote) && offerAwardCapacity(state, { quote: offer.quote, line: offer.line }) > 0 && offer.price !== undefined).map(offer => Number(offer.price!.toFixed(6)));
              const lowest = eligiblePrices.length ? Math.min(...eligiblePrices) : undefined;
              const selectedAwards = awards.filter(award => award.item.id === item.id);
              return <MaterialDetailsRow key={item.id} data-comparison-material={item.id} className={coverage.edited ? "bid-row-edited" : ""} disabled={blocked} onOpen={() => setMaterialId(item.id)}>
                <th className="bid-fixed-material" scope="row"><MaterialDetailsTrigger onClick={() => setMaterialId(item.id)}>{request.items.indexOf(item) + 1}. {item.name}</MaterialDetailsTrigger><small>{coverage.ordered > 0 ? "Ordered " + coverage.ordered + " · " : ""}{coverage.unassigned} {item.unit} unassigned</small>{coverage.edited && <span className="bid-unsaved">Unsaved</span>}</th>
                <td className="bid-fixed-quantity numeric">{item.quantity}</td><td className="bid-fixed-unit">{item.unit}</td>
                {cellOffers.map(({ quote, line, price }, supplierIndex) => {
                  const lines = (quote.lines || []).filter(row => row.requestItemId === item.id);
                  const selected = line ? selectedAwards.some(award => award.line.id === line.id) : false;
                  const reason = offerAwardError(state, quote);
                  const capacity = line ? offerAwardCapacity(state, { quote, line }) : 0;
                  const isLowest = price !== undefined && lowest !== undefined && Number(price.toFixed(6)) === lowest && !reason && capacity > 0;
                  return <Fragment key={quote.id}>
                    <td className={"numeric bid-offer-price" + (selected ? " bid-offer-selected" : "")} data-supplier-color={supplierIndex % 5}>
                      {lines.length > 1 && <select aria-label={"Comparison offer for " + item.name + " from " + supplier(state, quote)} value={line?.id || ""} disabled={blocked} onChange={event => setSelections(current => ({ ...current, [quote.id]: { ...current[quote.id], [item.id]: event.target.value } }))}><option value="">Choose offer ({lines.length})</option>{lines.map(option => <option key={option.id} value={option.id}>{option.description + (option.brand ? " · " + option.brand : "")}</option>)}</select>}
                      {line ? <><strong>{price === undefined ? comparisonFinancialError(quote) || "Check offer price" : comparisonPriceText(price)}</strong><div className="bid-price-meta">{isLowest && <span className="bid-lowest">Lowest price</span>}<button type="button" className="text-link" aria-label={"Offer details for " + item.name + " from " + supplier(state, quote)} onClick={() => openDetails({ quote, line })}>Details</button></div></> : <span className="muted">{lines.length ? "Choose an offer" : "Not quoted"}</span>}
                    </td>
                    <td className={"numeric bid-offer-amount" + (selected ? " bid-offer-selected" : "")} data-supplier-color={supplierIndex % 5}>
                      {line && <><strong>{amountText(comparableMaterialAmount(quote, line, item))}</strong>{capacity + 0.000001 < item.quantity && <small className="bid-warning">Offered {capacity} {item.unit}</small>}
                        {canEdit && <button type="button" className={"button " + (selected ? "primary" : "secondary")} data-choose-offer={line.id} aria-label={"Choose " + supplier(state, quote) + " for " + item.name} aria-pressed={selected} disabled={blocked || !!reason || capacity <= 0 || coverage.remainingToOrder <= 0} onClick={() => { setEdits(current => chooseMaterialOffer(state, request, item, { quote, line }, current)); setError(""); }}>{selected ? "Selected" : "Choose"}</button>}
                      </>}
                    </td>
                  </Fragment>;
                })}
                <td className="bid-award-summary">{selectedAwards.length ? selectedAwards.map(award => <small key={award.line.id}><strong>{award.quantity} {item.unit}</strong> · {supplier(state, award.quote)}{offerAwardError(state, award.quote) && <span className="field-error">{offerAwardError(state, award.quote)}</span>}</small>) : <small className="muted">{coverage.remainingToOrder ? "No supplier selected" : "Already ordered"}</small>}
                  <button type="button" className="text-link" data-split-material={item.id} disabled={blocked} onClick={() => openSplit(item.id)}>{canEdit ? "Split quantity" : "View awards"}</button>
                </td>
              </MaterialDetailsRow>;
            })}{!visibleMaterials.length && <tr><td colSpan={4 + suppliers.length * 2}>No materials match these filters.</td></tr>}</tbody>
            <tfoot><tr><th colSpan={3}>Material subtotals · full MRF quantities</th>{suppliers.map((quote, supplierIndex) => { const total = subtotal(quote); return <td key={quote.id} colSpan={2} className="numeric" data-supplier-color={supplierIndex % 5}><strong>{comparisonFinancialError(quote) ? "VAT review needed" : amountText(total.total)}</strong><small>{total.complete ? "All requested quantities quoted" : "Incomplete comparison"}</small></td>; })}<td>Before quotation-level adjustments and EWT</td></tr></tfoot>
          </table>
        </div>
        {!scrollPosition.nativeVisible && scrollPosition.max > 0 && <div className="bid-horizontal-control"><label><span className="sr-only">Scroll supplier columns horizontally</span><input type="range" min="0" max={scrollPosition.max} step="1" value={scrollPosition.left} aria-label="Scroll supplier columns horizontally" onChange={event => { if (scrollRef.current) scrollRef.current.scrollLeft = Number(event.target.value); }}/></label></div>}
        <p className="helper-note comparative-scroll-note">Scroll sideways to compare suppliers. Lowest price does not assess specifications, availability or quotation-level charges.</p>
      </>}
      <InlineError message={error}/>
      <footer className="allocation-footer"><div><strong>{covered} of {request.items.length} materials covered</strong><small>{editedItems.length ? editedItems.length + " materials with unsaved choices" : staged.length + " saved awards"} · Saving awards does not create POs.</small><small>Unsaved choices remain while this workspace is open; saved awards survive refresh.</small></div>{canEdit && editedItems.length > 0 && <button type="button" className="text-link" disabled={blocked} onClick={reset}>Discard changes</button>}</footer>
    </section>

    <CollapsibleSection title="Quotation financial summaries" defaultOpen={false}>{suppliers.map(quote => <section className="panel" key={quote.id}><h3>{supplier(state, quote)} · {quote.ref}</h3><QuotationFinancialSummary quote={quote}/><button type="button" className="button secondary" onClick={() => onReview(quote)}>Review quotation</button></section>)}</CollapsibleSection>

    <MaterialDetailsModal item={request.items.find(item => item.id === materialId)} onClose={() => setMaterialId("")}>{canEdit && <button type="button" className="button secondary" onClick={() => { setMaterialId(""); openSplit(materialId); }}>Split quantity</button>}</MaterialDetailsModal>
    <RecordModal open={!!splitItem} title={splitItem ? "Award quantities · " + splitItem.name : "Award quantities"} onClose={() => { if (!blocked) setSplitId(""); }}>
      {splitItem && <div className="comparison-split">
        <p>Requested {splitItem.quantity} {splitItem.unit} · Ordered {status(splitItem, splitEdits).ordered} · Unassigned {status(splitItem, splitEdits).unassigned}. Changes are saved with the rest of your awards.</p>
        {splitOffers.map(offer => { const reason = offerAwardError(state, offer.quote); const existingPO = activeSupplierPO(state, offer.quote); return <section key={offer.line.id} data-split-offer={offer.line.id}><div><strong>{supplier(state, offer.quote)}</strong><small>{offer.line.description} · {offer.quote.ref}</small><small>{amountText(comparableUnitPrice(offer.quote, offer.line))} / {splitItem.unit} · Available {offerAwardCapacity(state, offer)} {splitItem.unit}</small>{reason && <p className="field-error">{reason}</p>}{existingPO && <Link href={"/purchase-orders/" + existingPO.id} className="text-link">Open {existingPO.ref}</Link>}<button type="button" className="text-link" onClick={() => openDetails(offer)}>Offer details</button></div>
          <div><Field label={"Award quantity (" + splitItem.unit + ")"} error={splitErrors[offer.line.id]}><input aria-label={"Award " + offer.quote.ref + " " + offer.line.description} type="number" min="0" max={offerAwardCapacity(state, offer)} step="any" disabled={!canEdit || blocked || !!reason} value={value(offer.line.id, splitEdits)} onChange={event => { setSplitEdits(current => ({ ...current, [offer.line.id]: event.target.value })); setSplitErrors({}); }}/></Field>
            {canEdit && <button type="button" className="text-link" disabled={blocked} onClick={() => { setSplitEdits(current => ({ ...current, [offer.line.id]: reason ? "0" : String(Math.min(offerAwardCapacity(state, offer), Math.max(0, normalizedQuantity(status(splitItem, current).remainingToOrder - splitOffers.filter(row => row.line.id !== offer.line.id).reduce((sum, row) => sum + positive(value(row.line.id, current)), 0))))) })); setSplitErrors({}); }}>{reason ? "Remove allocation" : "Fill remaining"}</button>}
          </div>
        </section>; })}
        {!splitOffers.length && <Empty detail="No supplier has offered this material."/>}
        {splitOffers.some(offer => offer.line.discountType === "fixed" && positive(value(offer.line.id, splitEdits)) > 0 && positive(value(offer.line.id, splitEdits)) < offer.line.quantity * offer.line.conversionFactor) && <p className="callout warn">A fixed item discount is spread across the full quoted quantity in the comparison. Confirm the applicable discount for this partial award during PO preparation.</p>}
        <InlineError message={splitErrors[splitItem.id]}/>
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setSplitId("")}>Cancel</button>{canEdit && <button type="button" className="button primary" disabled={blocked} onClick={applySplit}>Use these quantities</button>}</div>
      </div>}
    </RecordModal>

    <RecordModal open={!!bulkQuote} title={bulkQuote ? "Award available materials · " + supplier(state, bulkQuote) : "Award supplier"} onClose={() => setBulkId("")}>
      {bulkQuote && bulk && <div className="comparison-bulk"><p>This covers the whole MRF, including materials hidden by your search or filter. Existing choices are replaced where this supplier can supply quantities; other choices are retained for gaps. Nothing is saved yet.</p>
        <div className="table-frame"><table><thead><tr><th>Material</th><th>This supplier</th><th>Other choices retained</th><th>Unassigned</th></tr></thead><tbody>{bulk.rows.map(row => <tr key={row.item.id}><td>{row.item.name}{row.note && <small className="bid-warning">{row.note}</small>}</td><td>{row.assigned} {row.item.unit}</td><td>{row.retained} {row.item.unit}</td><td>{row.gap} {row.item.unit}</td></tr>)}</tbody></table></div>
        <p className="helper-note">{bulk.changedCount} materials will change. {bulk.rows.filter(row => row.gap > 0).length} materials still have unassigned quantities.</p>
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setBulkId("")}>Cancel</button><button type="button" className="button primary" disabled={blocked || !bulk.changedCount} onClick={() => { setEdits(bulk.edits); setBulkId(""); setError(""); }}>Use these choices</button></div>
      </div>}
    </RecordModal>

    <RecordModal open={reviewOpen} title={editedItems.length ? "Review & save supplier awards" : "Review saved supplier awards"} onClose={() => { if (!blocked) setReviewOpen(false); }} returnFocus={() => reviewTrigger.current}>
      <div className="allocation-review"><p>{editedItems.length ? "Review these choices, then save all changed materials together." : "These saved awards can become separate supplier PO drafts."} {request.items.filter(item => status(item).unassigned > 0).length} materials have quantities still unassigned. Partial purchasing is allowed.</p>
        {grouped.map(quote => <section key={quote.id}><h3>{supplier(state, quote)} · {quote.ref}</h3><div className="table-frame"><table><thead><tr><th>Material / offer</th><th>Award quantity</th><th>Material estimate</th></tr></thead><tbody>{awards.filter(award => award.quote.id === quote.id).map(award => <MaterialDetailsRow key={award.line.id} data-review-offer={award.line.id} disabled={blocked} onOpen={() => openDetails(award)}><td><MaterialDetailsTrigger onClick={() => openDetails(award)}>{award.item.name}</MaterialDetailsTrigger><small>{award.line.description}</small>{award.line.discountType === "fixed" && award.quantity < award.line.quantity * award.line.conversionFactor && <small className="bid-warning">Partial award: confirm fixed discount on the PO.</small>}</td><td>{award.quantity} {award.item.unit}</td><td>{amountText(comparableMaterialAmount(quote, award.line, { quantity: award.quantity }))}</td></MaterialDetailsRow>)}</tbody></table></div>
          {offerAwardError(state, quote) && <p className="field-error">{offerAwardError(state, quote)}. Use Split quantity to remove or replace these choices.</p>}
          {canEdit && <Field label="Supplier selection reason (optional)"><textarea data-supplier-reason={quote.supplierId} disabled={blocked} value={reasons[quote.supplierId] || ""} onChange={event => setReasons(current => ({ ...current, [quote.supplierId]: event.target.value }))}/></Field>}
        </section>)}
        {!awards.length && <p>Saving will remove the awards you cleared. Existing purchase orders remain recorded.</p>}
        <p className="helper-note">Material estimates include VAT where applicable and item discounts. Quotation-level charges, discounts and withholding are confirmed during PO preparation; these estimates are not final supplier payables.</p>
        <InlineError message={error}/><div className="form-actions">{canEdit && (editedItems.length ? <button type="button" className="button primary" disabled={blocked} onClick={() => void save()}>{saving ? "Saving…" : "Save awards"}</button> : <button type="button" className="button primary" disabled={blocked || !staged.length || grouped.some(quote => !!offerAwardError(state, quote))} onClick={() => void generate()}>{generating ? "Creating…" : "Create supplier PO drafts"}</button>)}</div>
      </div>
    </RecordModal>

    <RecordModal open={!!details} title="Supplier offer details" onClose={closeDetails}>{details && <><h3>{supplier(state, details.quote)} · {details.quote.ref}</h3><p>{details.line.description}</p><div className="data-rows">
      <div><span>Quoted price / unit</span><strong>{quotedPrice(details.quote, details.line.unitPrice)} / {details.line.unit}</strong></div>
      <div><span>Comparable price / MRF unit</span><strong>{amountText(comparableUnitPrice(details.quote, details.line))}</strong></div>
      <div><span>VAT treatment</span><strong>{vatLabel(details.quote)}{details.quote.financial?.vatStatus === "VAT" ? " · quoted " + details.quote.financial.priceBasis : ""}</strong></div>
      <div><span>Conversion factor</span><strong>{details.line.conversionFactor}</strong></div>
      <div><span>Item discount</span><strong>{details.line.discountValue || 0} ({details.line.discountType || "none"})</strong></div>
      <div><span>Difference / specification</span><strong>{details.line.varianceReason || details.line.specification || "—"}</strong></div>
      <div><span>Availability / lead time</span><strong>{details.quote.available || "—"} · {details.quote.leadDays} days</strong></div>
      <div><span>Payment / delivery terms</span><strong>{details.quote.terms || "—"} · {details.quote.deliveryTerms || "—"}</strong></div>
      {(details.quote.adjustments || []).map(adjustment => <div key={adjustment.id}><span>{adjustment.label}</span><strong>{adjustment.value} {adjustment.calculation === "percentage" ? "%" : details.quote.currency || "PHP"}</strong></div>)}
    </div><p className="helper-note">Comparison prices include item discounts and VAT where applicable; quotation-level charges, discounts and EWT are separate.</p>{details.quote.documents.length > 0 && <button type="button" className="button secondary" onClick={() => { const quote = details.quote; resumeReview.current = false; setDetailKey(null); onPreview(quote); }}>View supplier documents</button>}</>}</RecordModal>
  </>;
}
