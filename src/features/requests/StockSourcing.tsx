"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useToasts } from "@/src/app-state/ToastProvider";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { revealField } from "@/src/components/ui/CollapsibleSection";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { inventoryFor } from "@/src/domain/selectors";
import { materialId } from "@/src/domain/ids";
import { requestSourcing, sameStockUnit, sourceStockAvailable, transfersForRequest } from "@/src/domain/stock-transfers";
import { exactStockMatch } from "@/src/domain/stock-suitability";
import { procurementReady } from "@/src/domain/request-archive";
import type { DemoSnapshot, MRF } from "@/src/domain/types";
import { StockSuitabilityList } from "./StockSuitabilityList";

type Choice = { id: string; itemId: string; requestedName: string; requestedUnit: string; requestedQuantity: number; sourceSiteId: string; sourceName: string; unit: string; quantity: string; matchConfirmed: boolean; needsReview: boolean; explanation: string };
type Draft = { choices: Choice[]; note: string };
const blank = (): Draft => ({ choices: [], note: "" });
function restore(key: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Draft | null;
    if (value && typeof value.note === "string" && Array.isArray(value.choices) && value.choices.length <= 2000 && value.choices.every(c => c && [c.id,c.itemId,c.requestedName,c.requestedUnit,c.sourceSiteId,c.sourceName,c.unit,c.quantity,c.explanation].every(s => typeof s === "string") && Number.isFinite(c.requestedQuantity) && typeof c.matchConfirmed === "boolean" && typeof c.needsReview === "boolean")) return value;
  } catch {}
  return blank();
}
export function StockSourcing(props: { state: DemoSnapshot; request: MRF; onPurchase: () => void }) {
  const { session } = useDemo();
  const storageKey = "constructsync-stock-draft-v1/" + (session.userId || session.email) + "/" + props.request.id;
  return <Editor key={storageKey} {...props} storageKey={storageKey}/>;
}
function Editor({ state, request, onPurchase, storageKey }: { state: DemoSnapshot; request: MRF; onPurchase: () => void; storageKey: string }) {
  const { run } = useDemo();
  const { notify,update: updateToast } = useToasts();
  const [draft,setDraft] = useState<Draft>(() => restore(storageKey));
  const sourceSites = state.sites.filter(site => site.id !== request.siteId);
  const [sourceId,setSourceId] = useState(() => draft.choices.find(c => sourceSites.some(s => s.id === c.sourceSiteId))?.sourceSiteId || sourceSites[0]?.id || "");
  const [extraRows,setExtraRows] = useState<Record<string,boolean>>({});
  const [reviewConfirmed,setReviewConfirmed] = useState(false);
  const [errors,setErrors] = useState<Record<string,string>>({}), [error,setError] = useState(""), [storageError,setStorageError] = useState(""), [busy,setBusy] = useState(false), [reviewOpen,setReviewOpen] = useState(false);
  const working = useRef(false), section = useRef<HTMLElement>(null);
  const editable = state.role === "Procurement" && procurementReady(request);
  const transfers = transfersForRequest(state,request.id);
  const stock = state.sites.filter(site => site.id !== request.siteId).flatMap(site => inventoryFor(state,site.id).map(m => ({ ...m,siteId:site.id,siteName:site.name,available:sourceStockAvailable(state,site.id,m.name,m.unit) })));
  const amount = (choices: Choice[]) => choices.reduce((sum,c) => sum + (Number.isFinite(Number(c.quantity)) ? Math.max(0,Number(c.quantity)) : 0),0);
  const draftAmount = (itemId: string) => amount(draft.choices.filter(c => c.itemId === itemId));
  const sourceUsed = (siteId: string,name: string,unit: string) => amount(draft.choices.filter(c => c.sourceSiteId === siteId && materialId(c.sourceName,c.unit) === materialId(name,unit)));
  function save(next: Draft) {
    setDraft(next);setReviewConfirmed(false);setErrors({});
    try { if (!next.choices.length && !next.note) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey,JSON.stringify(next));setStorageError(""); }
    catch { setStorageError("Your draft could not be saved. Keep this page open until you send it."); }
  }
  const update = (id: string,patch: Partial<Choice>) => save({ ...draft,choices:draft.choices.map(c => c.id === id ? { ...c,...patch } : c) });
  function validate() {
    const invalid: Record<string,string> = {};
    for (const c of draft.choices) {
      const item = request.items.find(i => i.id === c.itemId), quantity = Number(c.quantity);
      if (!item || item.name !== c.requestedName || item.unit !== c.requestedUnit || item.quantity !== c.requestedQuantity) invalid[c.id] = "This material changed. Remove the selection and choose stock again.";
      else if (!exactStockMatch(item,c.sourceName,c.unit)) invalid[c.id] = "Only matching stock can now be selected. Remove this selection and choose matching stock.";
      else if (!c.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) invalid[c.id] = "Enter a positive quantity.";
      else if (draftAmount(item.id) > requestSourcing(state,request,item).unassigned) invalid[c.id] = "Selections exceed the remaining material need.";
      else if (sourceUsed(c.sourceSiteId,c.sourceName,c.unit) > sourceStockAvailable(state,c.sourceSiteId,c.sourceName,c.unit)) invalid[c.id] = "Combined selections exceed current stock availability.";
      else if (!state.sites.some(s => s.id === c.sourceSiteId) || c.sourceSiteId === request.siteId || !sameStockUnit(c.unit,item.unit)) invalid[c.id] = "Choose another project's stock in the requested unit.";
    }
    setErrors(invalid);return invalid;
  }
  function review() {
    setError("");
    const invalid = validate();
    if (Object.keys(invalid).length) {
      const invalidChoice = draft.choices.find(c => invalid[c.id]);
      if (invalidChoice) setSourceId(invalidChoice.sourceSiteId);
      requestAnimationFrame(() => requestAnimationFrame(() => revealField(section.current?.querySelector<HTMLElement>('[aria-invalid="true"]') || null)));
      return;
    }
    setReviewConfirmed(false);setReviewOpen(true);
  }
  async function submit() {
    if (working.current) return;
    if (!reviewConfirmed || !draft.choices.length) return;
    if (!editable || Object.keys(validate()).length) { setReviewOpen(false);return; }
    working.current = true;setBusy(true);setError("");
    const toast = notify({ tone:"progress",title:"Sending stock release requests…" });
    try {
      const result = await run({ type:"submitStockSourcingPlan",requestId:request.id,note:draft.note,selections:draft.choices.map(c => ({ ...c,quantity:Number(c.quantity),matchConfirmed:reviewConfirmed,needsReview:false,explanation:"" })) });
      if (result.ok) { save(blank());setReviewOpen(false);updateToast(toast,{ tone:"success",title:"Stock release requests sent.",detail:"Source sites will confirm the quantities they can release." }); } else { setError(result.message);setReviewOpen(false);updateToast(toast,{ tone:"error",title:result.message }); }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Stock release requests could not be sent. Try again.";
      setError(text);setReviewOpen(false);updateToast(toast,{ tone:"error",title:text });
    } finally { working.current = false;setBusy(false); }
  }
  return <section ref={section} className="panel stock-sourcing" aria-label="Check site stock" aria-busy={busy}>
    <div className="panel-heading stock-sourcing-heading"><div><h2>Check site stock</h2><p className="helper-note">Use spare materials from another project. Purchase only the balance that remains.</p></div><button type="button" className="button secondary" disabled={busy} onClick={onPurchase}>Supplier quotations</button></div>
    <div className="stock-source-fields">
      <Field label="Source project"><select aria-label="Source project" value={sourceId} disabled={busy || !sourceSites.length} onChange={e => setSourceId(e.target.value)}>{!sourceSites.length && <option value="">No other projects available</option>}{sourceSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
      <Field label="Transfer note (optional)"><input placeholder="Explain which spare materials can be used" value={draft.note} disabled={!editable || busy} onChange={e => save({ ...draft,note:e.target.value })}/></Field>
    </div>
    <p className="helper-note">Choose stock with the same description and unit. After your final verification, the source site confirms how much it can release.</p>
    <InlineError message={storageError}/>
    {draft.choices.some(c => c.sourceSiteId !== sourceId) && <p className="stock-other-projects" role="status">Your draft also includes {draft.choices.filter(c => c.sourceSiteId !== sourceId).length} selection(s) from other projects. Switch source project to edit them; all selections appear in the final review.</p>}
    <div className="qa-bounded-table stock-table-scroll" role="region" aria-label="Site stock materials" tabIndex={0}>
      <table className="stock-sourcing-table"><colgroup><col className="stock-col-material"/><col className="stock-col-requested"/><col className="stock-col-sourced"/><col className="stock-col-remaining"/><col className="stock-col-source"/><col className="stock-col-available"/><col className="stock-col-quantity"/><col className="stock-col-match"/></colgroup>
        <thead><tr><th scope="col">Requested material</th><th scope="col">Requested</th><th scope="col">Already sourced</th><th scope="col">Still to source</th><th scope="col">Stock at source project</th><th scope="col">Available</th><th scope="col">Transfer quantity</th><th scope="col">Match</th></tr></thead>
        {request.items.map(item => {
          const sourcing = requestSourcing(state,request,item);
          const choices = draft.choices.filter(c => c.itemId === item.id && c.sourceSiteId === sourceId);
          const rows: (Choice | undefined)[] = [...choices];
          if (!rows.length || extraRows[item.id]) rows.push(undefined);
          const otherQuantity = amount(draft.choices.filter(c => c.itemId === item.id && c.sourceSiteId !== sourceId));
          return <tbody key={item.id} data-stock-material={item.id}>{rows.map((c,rowIndex) => {
            const candidates = stock.filter(m => m.siteId === sourceId && m.available > 0 && exactStockMatch(item,m.name,m.unit) && !choices.some(choice => choice.id !== c?.id && materialId(choice.sourceName,choice.unit) === m.id));
            const matchingCandidates = candidates.length;
            const selectedStock = c ? stock.find(m => m.siteId === sourceId && materialId(c.sourceName,c.unit) === m.id) : undefined;
            if (c && !candidates.some(m => m.id === materialId(c.sourceName,c.unit))) candidates.unshift(selectedStock || {id:materialId(c.sourceName,c.unit),name:c.sourceName,unit:c.unit,siteId:sourceId,siteName:sourceSites.find(s => s.id === sourceId)?.name || "",available:sourceStockAvailable(state,sourceId,c.sourceName,c.unit),onHand:0});
            const available = c ? sourceStockAvailable(state,sourceId,c.sourceName,c.unit) : 0;
            const choose = (id: string) => {
              const m = stock.find(m => m.siteId === sourceId && m.id === id);
              if (m && !exactStockMatch(item,m.name,m.unit)) return;
              const remaining = draft.choices.filter(choice => choice.id !== c?.id);
              if (!m) { save({ ...draft,choices:remaining });return; }
              const choice: Choice = {id:item.id+"/"+sourceId+"/"+m.id,itemId:item.id,requestedName:item.name,requestedUnit:item.unit,requestedQuantity:item.quantity,sourceSiteId:sourceId,sourceName:m.name,unit:m.unit,quantity:"",matchConfirmed:false,needsReview:false,explanation:""};
              save({ ...draft,choices:[...remaining,choice] });
              setExtraRows(v => ({ ...v,[item.id]:false }));
            };
            return <tr key={c?.id || "choose"} data-stock-selection={c?.id}>
              {rowIndex === 0 && <><th scope="rowgroup" rowSpan={rows.length}><strong className="stock-material-name">{item.name}</strong><span className="stock-unit">{item.unit}</span>{otherQuantity > 0 && <small className="stock-cell-note">{otherQuantity} {item.unit} selected at other projects</small>}</th>
                <td rowSpan={rows.length}><span className="stock-count">{item.quantity}</span><span className="stock-unit">{item.unit}</span></td>
                <td rowSpan={rows.length}><div className="stock-sourced-breakdown"><span>Transfers: {sourcing.transfers}</span><span>Site review: {sourcing.suitability}</span><span>Orders: {sourcing.ordered}</span><span>Awards: {sourcing.staged}</span></div></td>
                <td rowSpan={rows.length}><strong className="stock-count">{sourcing.unassigned}</strong><span className="stock-unit">{item.unit}</span>{draftAmount(item.id) > 0 && <small className="stock-cell-note">After draft: {Math.max(0,sourcing.unassigned-draftAmount(item.id))}</small>}</td></>}
              <td><div className="stock-source-control">
                <select title={c?.sourceName} aria-label={"Stock for "+item.name} value={c ? materialId(c.sourceName,c.unit) : ""} disabled={!editable || busy || (!c && sourcing.unassigned <= 0)} onChange={e => choose(e.target.value)}><option value="">Choose stock</option>{candidates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                {c && <><small className="stock-cell-note">On hand: {selectedStock?.onHand ?? 0} · Reserved: {Math.max(0,(selectedStock?.onHand ?? 0)-available)}</small></>}
                {editable && rowIndex === rows.length-1 && sourcing.unassigned > 0 && <div className="stock-search-controls">
                  {!matchingCandidates && !c && <small className="stock-cell-note">No matching stock at this project. Choose another source project or continue to supplier quotations.</small>}
                  {c && candidates.some(m => m.id !== materialId(c.sourceName,c.unit)) && <button type="button" className="button secondary stock-row-button" disabled={busy} onClick={() => setExtraRows(v => ({ ...v,[item.id]:true }))}>Add another selection</button>}
                </div>}
              </div></td>
              <td>{c ? <><span className="stock-available-count"><span className="stock-count">{available}</span><span className="stock-unit">{c.unit}</span></span><small className="stock-cell-note">Draft balance: {Math.max(0,available-sourceUsed(sourceId,c.sourceName,c.unit))}</small></> : <span className="stock-cell-note">Choose stock first</span>}</td>
              <td>{c ? <div className="stock-quantity-control"><div className="stock-quantity-line"><input aria-label={"Quantity from "+sourceId+" for "+item.name} type="number" min="0" step="any" required aria-required="true" value={c.quantity} disabled={!editable || busy} aria-invalid={!!errors[c.id]} aria-describedby={errors[c.id] ? "stock-error-"+c.id : undefined} onChange={e => update(c.id,{ quantity:e.target.value })}/><span className="stock-unit">{c.unit}</span></div></div> : <span className="stock-cell-note">Enter quantity after selecting stock</span>}{c && errors[c.id] && <p id={"stock-error-"+c.id} className="field-error" role="alert">{errors[c.id]}</p>}</td>
              <td>{c && <div className="stock-match-control"><Badge>{exactStockMatch(item,c.sourceName,c.unit) ? "Matches request" : "Matching stock required"}</Badge><button type="button" className="button danger-outline stock-row-button" aria-label={"Remove "+c.sourceName+" selection"} disabled={!editable || busy} onClick={() => save({ ...draft,choices:draft.choices.filter(choice => choice.id !== c.id) })}>Remove</button></div>}</td>
            </tr>;
          })}</tbody>;
        })}
      </table>
    </div>
    {draft.choices.some(c => !request.items.some(i => i.id === c.itemId) || !sourceSites.some(site => site.id === c.sourceSiteId)) && <div className="callout warn"><p>Your draft includes removed materials or projects. Clear it and choose current materials.</p><button type="button" className="button secondary" disabled={busy} onClick={() => save(blank())}>Clear outdated draft</button></div>}
    {editable && <div className="stock-footer"><p className="helper-note">Drafts save on this browser. No stock or demand is held until requests are sent.</p><button type="button" className="button primary" disabled={busy || !draft.choices.length} onClick={review}>Review selections</button></div>}
    {transfers.length > 0 && <div className="stock-release-list"><h3>Source release requests</h3>{transfers.map(t => <Link className="data-link" key={t.id} href={"/stock-transfers/"+t.id}><span><strong>{t.ref}</strong><small>{t.origin.name}</small></span><Badge>{t.status === "pending" ? "Awaiting source site" : t.status === "approved" ? "Logistics delivery" : t.status}</Badge></Link>)}</div>}
    <StockSuitabilityList state={state} request={request}/>
    <InlineError message={error}/>
    <RecordModal open={reviewOpen} title="Review stock selections" onClose={() => { if (!busy) setReviewOpen(false); }}>
      <p>All selections go directly to their source sites for release confirmation after you verify the descriptions and units.</p>
      {[...new Set(draft.choices.map(c => c.sourceSiteId))].map(siteId => <div className="stock-review-group" key={siteId}><h3>{state.sites.find(s => s.id === siteId)?.name}</h3>{draft.choices.filter(c => c.sourceSiteId === siteId).map(c => <div key={c.id} className="stock-review-choice"><strong>{c.quantity} {c.unit} · {c.sourceName}</strong><p>For: {request.items.find(i => i.id === c.itemId)?.name}</p><Badge>Source release request</Badge></div>)}</div>)}
      <h3>Remaining to buy after sending</h3>{request.items.map(item => <p key={item.id}><strong>{Math.max(0,requestSourcing(state,request,item).unassigned-draftAmount(item.id))} {item.unit}</strong> · {item.name}</p>)}
      {draft.note && <p>Note: {draft.note}</p>}
      <label className="stock-check stock-final-verification"><input type="checkbox" checked={reviewConfirmed} disabled={busy} onChange={e => setReviewConfirmed(e.target.checked)}/><span>I verified the descriptions and units of all matching selections.</span></label>
      <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setReviewOpen(false)}>Edit selections</button><button type="button" className="button primary" disabled={busy || !reviewConfirmed || !draft.choices.length} onClick={() => void submit()}>{busy ? "Sending…" : "Send requests"}</button></div>
    </RecordModal>
  </section>;
}
