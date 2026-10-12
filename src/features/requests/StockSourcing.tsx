"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { inventoryFor } from "@/src/domain/selectors";
import { requestSourcing, sameStockUnit, sourceStockAvailable, transferReservedFor, transfersForRequest } from "@/src/domain/stock-transfers";
import { procurementReady } from "@/src/domain/request-archive";
import type { DemoSnapshot, MRF } from "@/src/domain/types";

export function StockSourcing({ state, request, onPurchase }: { state: DemoSnapshot; request: MRF; onPurchase: () => void }) {
  const { run } = useDemo();
  const [sourceId, setSourceId] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const stock = inventoryFor(state, sourceId);
  const editable = state.role === "Procurement" && procurementReady(request);
  const transfers = transfersForRequest(state, request.id);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const lines = request.items.filter(item => Number(quantities[item.id]) > 0).map(item => {
      const material = stock.find(value => value.id === selection[item.id]);
      return { itemId: item.id, sourceName: material?.name || "", unit: material?.unit || "", quantity: Number(quantities[item.id]), suitabilityConfirmed: confirmed[item.id] === true };
    });
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await run({ type: "proposeStockTransfer", requestId: request.id, sourceSiteId: sourceId, note, lines });
      if (result.ok) { setMessage(result.message); setQuantities({}); setConfirmed({}); setSelection({}); setNote(""); } else setError(result.message);
    } finally { setBusy(false); }
  }
  return <section className="panel stock-sourcing" aria-label="Check site stock">
    <div className="panel-heading"><div><h2>Check site stock</h2><p className="helper-note">Use suitable spare materials from another project. Purchase only the balance that remains.</p></div><button type="button" className="button secondary" onClick={onPurchase}>Continue to supplier quotations</button></div>
    <form onSubmit={submit}>
      <div className="form-grid"><Field label="Source project"><select aria-label="Source project" value={sourceId} disabled={busy || !editable} onChange={event => { setSourceId(event.target.value); setSelection({}); setQuantities({}); setConfirmed({}); setError(""); }}><option value="">Choose another project</option>{state.sites.filter(site => site.id !== request.siteId).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field><Field label="Transfer note (optional)"><input value={note} disabled={busy || !editable} onChange={event => setNote(event.target.value)} placeholder="Explain which spare materials can be used"/></Field></div>
      <p className="helper-note">Submitting holds the selected stock for source Site Personnel to confirm. Their confirmed quantities go directly to Logistics.</p>
      <div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Materials and available site stock"><table className="stock-sourcing-table"><thead><tr><th>Requested material</th><th>Requested</th><th>Already sourced</th><th>Still to source</th><th>Stock at source project</th><th>Available</th><th>Transfer quantity</th><th>Match</th></tr></thead><tbody>{request.items.map(item => {
        const sourcing = requestSourcing(state, request, item), candidates = stock.filter(material => sameStockUnit(material.unit, item.unit));
        const selected = candidates.find(material => material.id === selection[item.id]);
        const available = selected ? sourceStockAvailable(state, sourceId, selected.name, selected.unit) : 0;
        return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.unit}</small></td><td className="numeric">{item.quantity}</td><td><small>Transfers: {sourcing.transfers}</small><small>Orders: {sourcing.ordered} · Awards: {sourcing.staged}</small></td><td className="numeric"><strong>{sourcing.unassigned}</strong></td><td><select aria-label={"Source stock for " + item.name} value={selection[item.id] || ""} disabled={!sourceId || busy || !editable || sourcing.unassigned <= 0} onChange={event => { setSelection(current => ({ ...current, [item.id]: event.target.value })); setQuantities(current => ({ ...current, [item.id]: "0" })); setConfirmed(current => ({ ...current, [item.id]: false })); }}><option value="">{sourceId ? candidates.length ? "Select suitable stock" : "No stock in this unit" : "Choose a source project"}</option>{candidates.map(material => <option key={material.id} value={material.id}>{material.name}{material.name.trim().toLowerCase() === item.name.trim().toLowerCase() ? " · Suggested match" : ""}</option>)}</select>{selected && <small>On hand {selected.onHand} · Reserved {transferReservedFor(state, sourceId, selected.id)}</small>}</td><td className="numeric">{available} {item.unit}</td><td><input aria-label={"Transfer quantity for " + item.name} type="number" min="0" max={Math.min(available, sourcing.unassigned)} step="any" value={quantities[item.id] || "0"} disabled={!selected || busy || !editable} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))}/>{selected && editable && <button type="button" className="text-link" disabled={busy} onClick={() => setQuantities(current => ({ ...current, [item.id]: String(Math.min(available, sourcing.unassigned)) }))}>Fill available</button>}</td><td><label className="check-row"><input aria-label={"Confirm suitable stock for " + item.name} type="checkbox" checked={confirmed[item.id] || false} disabled={!selected || busy || !editable} onChange={event => setConfirmed(current => ({ ...current, [item.id]: event.target.checked }))}/>Suitable</label></td></tr>;
      })}</tbody></table></div>
      <InlineError message={error}/>{message && <p role="status" className="helper-note">{message}</p>}
      {editable && <div className="form-actions"><button type="submit" className="button primary" disabled={busy || !sourceId}>{busy ? "Reserving stock…" : "Request source release"}</button></div>}
    </form>
    {transfers.length > 0 && <div className="subform"><h3>Stock transfer requests</h3>{transfers.map(transfer => <Link className="data-link" key={transfer.id} href={"/stock-transfers/" + transfer.id}><span><strong>{transfer.ref}</strong><small>{transfer.origin.name} → {transfer.destination.name}</small></span><Badge>{transfer.status === "pending" ? "Awaiting source confirmation" : transfer.status}</Badge></Link>)}</div>}
  </section>;
}
