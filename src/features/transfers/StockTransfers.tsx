"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Register } from "@/src/components/ui/Register";
import { Badge, Field, InlineError, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { MaterialDetailsModal, MaterialDetailsRow, MaterialDetailsTrigger } from "@/src/components/ui/MaterialDetails";
import { MissingRecord } from "@/src/components/ui/States";
import { DocumentPreview } from "@/src/components/DocumentPreview";
import { deliveriesForTransfer, transferUnscheduled, transferReceiptData, transferDocumentGaps } from "@/src/domain/stock-transfers";
import { deliveryToday } from "@/src/domain/delivery-flow";
import { auditTime, actorName } from "@/src/domain/audit";
import type { Command, CommandResult } from "@/src/domain/commands";
import type { DemoSnapshot, StockTransfer, TransferDelivery } from "@/src/domain/types";
import { archiveTransferReceipt } from "./transfer-files";
import { TransferDocuments } from "./TransferDocuments";

export function StockTransferRegister({ accounting = false }: { accounting?: boolean }) {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState("");
  if (!state || !state.stockTransfers?.length) return null;
  const rows = state.stockTransfers.filter(value => (state.siteFilter === "all" || value.sourceSiteId === state.siteFilter || value.destinationSiteId === state.siteFilter) && (value.ref + " " + value.origin.name + " " + value.destination.name).toLowerCase().includes(search.toLowerCase()) && (!accounting || state.transferDeliveries?.some(delivery => delivery.transferId === value.id && ["confirmed", "posted"].includes(delivery.status))));
  if (accounting && !rows.length) return null;
  return <section className="panel"><h2>{accounting ? "Stock transfer document review" : "Site stock transfers"}</h2><p className="helper-note">{accounting ? "Review generated and signed transfer receipts. Transfers have no supplier invoice or payment requirement." : "Source release, delivery trips and receiving between project sites."}</p><Register embedded rows={rows} unit="transfers" resetKey={search + state.siteFilter} filters={<input aria-label="Search stock transfers" placeholder="Search transfer or project" value={search} onChange={event => setSearch(event.target.value)}/>} headers={<><th>Transfer / MRF</th><th>From</th><th>To</th><th>Source release</th><th>Delivery trips</th><th>Documents</th></>} renderRow={transfer => <tr key={transfer.id}><td><Link className="table-primary" href={"/stock-transfers/" + transfer.id}>{transfer.ref}</Link><small>{state.requests.find(request => request.id === transfer.requestId)?.ref}</small></td><td>{transfer.origin.name}</td><td>{transfer.destination.name}</td><td><Badge>{transfer.status === "pending" ? "Awaiting source" : transfer.status}</Badge></td><td>{deliveriesForTransfer(state, transfer.id).filter(delivery => delivery.status !== "cancelled").length}</td><td><Badge>{transfer.documentReview?.status || "Incomplete"}</Badge></td></tr>}/></section>;
}
export function StockTransferDetail({ id }: { id: string }) {
  const { snapshot: state, run, beginOperation, siteIds } = useDemo();
  const { confirm, confirmation } = useConfirmation();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(""), [selectedItem, setSelectedItem] = useState("");
  if (!state) return null;
  const transfer = state.stockTransfers?.find(value => value.id === id);
  if (!transfer) return <MissingRecord name="Stock transfer" listHref="/deliveries"/>;
  const request = state.requests.find(value => value.id === transfer.requestId)!;
  const trips = deliveriesForTransfer(state, id);
  const canReview = state.role === "Site Personnel" && siteIds.includes(transfer.sourceSiteId) && transfer.status === "pending";
  const canCancel = state.role === "Procurement" && (transfer.status === "pending" || transfer.lines.some(line => transferUnscheduled(state, transfer, line.id) > 0) || trips.some(delivery => delivery.status === "expected"));
  async function act(command: Command, title: string): Promise<CommandResult> {
    if (busy) return { ok: false, message: "Wait for the current action." };
    if (!await confirm(title, "Check the materials and quantities before confirming.", "Confirm")) return { ok: false, message: "Cancelled" };
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await run(command);
      if (!result.ok) { setError(result.message); return result; }
      setMessage(result.message);
      if (command.type === "receiveTransferDelivery" || command.type === "postTransferDelivery") {
        const delivery = result.snapshot.transferDeliveries!.find(value => value.id === command.id)!;
        for (const receipt of delivery.receiptVersions || []) {
          if (receipt.archive.status === "complete") continue;
          try { await archiveTransferReceipt(result.snapshot, delivery.id, receipt.id, await beginOperation({ kind: "transfer-receipt", deliveryId: delivery.id, receiptId: receipt.id })); }
          catch (cause) { setError("Receiving/posting remains saved. " + (cause instanceof Error ? cause.message : "Receipt archive needs retry.")); }
        }
      }
      return result;
    } finally { setBusy(false); }
  }
  const review = (event: FormEvent) => { event.preventDefault(); void act({ type: "reviewStockTransfer", id, decision: "approve", quantities: Object.fromEntries(transfer.lines.map(line => [line.id, Number(quantities[line.id] ?? line.proposed)])), reason }, "Confirm source stock release?"); };
  return <>
    <RecordHeader backHref="/deliveries" backLabel="Delivery tracker" eyebrow="SITE STOCK TRANSFER" title={transfer.ref} badges={<Badge>{transfer.status}</Badge>}/>
    <section className="panel"><div className="data-rows transfer-summary"><div><span>Source</span><strong>{transfer.origin.name}<small>{transfer.origin.address}</small></strong></div><div><span>Destination</span><strong>{transfer.destination.name}<small>{transfer.destination.address}</small></strong></div><div><span>Destination MRF</span><Link href={"/requests/" + request.id}>{request.ref}</Link></div><div><span>Payment</span><strong>Not applicable · existing company stock</strong></div></div>
      {transfer.note && <p>{transfer.note}</p>}
      {state.role === "Site Personnel" && !siteIds.includes(transfer.sourceSiteId) && !siteIds.includes(transfer.destinationSiteId) && <p className="transfer-assignment-note">Ask an Administrator to assign your account to the source or destination project before performing transfer actions.</p>}
      <form onSubmit={review}><div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Source stock release"><table className="transfer-review-table"><thead><tr><th>Destination material / source stock</th><th>Unit</th><th>Proposed</th><th>Confirmed release</th><th>Cancelled</th><th>Remaining to schedule</th></tr></thead><tbody>{transfer.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!; return <MaterialDetailsRow key={line.id} onOpen={() => setSelectedItem(item.id)}><td><MaterialDetailsTrigger onClick={() => setSelectedItem(item.id)}>{item.name}</MaterialDetailsTrigger><small>Source stock: {line.sourceName}</small></td><td>{line.unit}</td><td>{line.proposed}</td><td>{canReview ? <input aria-label={"Confirm release for " + item.name} type="number" min="0" max={line.proposed} step="any" disabled={busy} value={quantities[line.id] ?? line.proposed} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))}/> : line.approved}</td><td>{line.cancelled}</td><td>{transferUnscheduled(state, transfer, line.id)}</td></MaterialDetailsRow>; })}</tbody></table></div>
        {(canReview || canCancel) && <Field label="Reason / source review note"><textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Required for reduced quantities, rejection or cancellation"/></Field>}
        <div className="transfer-actions">{canReview && <><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Confirm stock release"}</button><button className="button danger-outline" type="button" disabled={busy} onClick={() => void act({ type: "reviewStockTransfer", id, decision: "reject", quantities: {}, reason }, "Reject this transfer?")}>Reject transfer</button></>}{canCancel && <button className="button danger-outline" type="button" disabled={busy} onClick={() => void act({ type: "cancelStockTransfer", id, reason }, "Cancel undispatched quantities?")}>Cancel remaining allocation</button>}</div>
      </form>
      {transfer.reviewedAt && <p className="helper-note">Source reviewed by {actorName("Site Personnel", transfer.reviewedBy)} · {auditTime(transfer.reviewedAt)}{transfer.reviewReason ? " · " + transfer.reviewReason : ""}</p>}
      <InlineError message={error}/>{message && <p className="helper-note" role="status">{message}</p>}
    </section>
    {state.role === "Logistics" && transfer.lines.some(line => transferUnscheduled(state, transfer, line.id) > 0) && <TransferSchedule key={id} state={state} transfer={transfer} busy={busy} act={act}/>}
    {trips.map(delivery => <TransferTrip key={delivery.id} state={state} transfer={transfer} delivery={delivery} busy={busy} act={act}/>)}
    {state.role === "Accounting / Auditing" && trips.some(delivery => ["confirmed", "posted"].includes(delivery.status)) && <TransferDocumentReview state={state} transfer={transfer} busy={busy} act={act}/>}
    <section className="panel"><h2>Transfer history</h2><Timeline state={state} ids={[id, ...trips.map(value => value.id)]}/></section>
    <MaterialDetailsModal item={request.items.find(item => item.id === selectedItem)} onClose={() => setSelectedItem("")}/>{confirmation}
  </>;
}
type Actions = { busy: boolean; act: (command: Command, title: string) => Promise<CommandResult> };
function TransferSchedule({ state, transfer, busy, act }: { state: DemoSnapshot; transfer: StockTransfer } & Actions) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  return <section className="panel"><h2>Schedule a transfer trip</h2><p className="helper-note">Schedule some or all remaining approved stock. Stock is deducted only when dispatched.</p><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ type: "scheduleTransferDelivery", transferId: transfer.id, scheduledDate: String(form.get("date")), evidence: String(form.get("evidence")), quantities: Object.fromEntries(transfer.lines.map(line => [line.id, Number(quantities[line.id] ?? transferUnscheduled(state, transfer, line.id))])) }, "Schedule this transfer trip?"); }}>
    <div className="form-grid"><Field label="Scheduled date"><input type="date" name="date" required defaultValue={deliveryToday()} disabled={busy}/></Field><Field label="Evidence reference"><input name="evidence" required defaultValue="Transfer receipt pending" disabled={busy}/></Field></div>
    <div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Transfer quantities to schedule"><table className="transfer-review-table"><thead><tr><th>Material</th><th>Remaining</th><th>This trip</th></tr></thead><tbody>{transfer.lines.map(line => <tr key={line.id}><td>{state.requests.find(request => request.id === transfer.requestId)?.items.find(item => item.id === line.itemId)?.name}</td><td>{transferUnscheduled(state, transfer, line.id)} {line.unit}</td><td><input aria-label={"Trip quantity for " + line.sourceName} type="number" step="any" min="0" max={transferUnscheduled(state, transfer, line.id)} value={quantities[line.id] ?? transferUnscheduled(state, transfer, line.id)} disabled={busy} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))}/></td></tr>)}</tbody></table></div><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Schedule trip"}</button>
  </form></section>;
}
function TransferTrip({ state, transfer, delivery, busy, act }: { state: DemoSnapshot; transfer: StockTransfer; delivery: TransferDelivery } & Actions) {
  const { siteIds } = useDemo();
  const [quantities, setQuantities] = useState<Record<string, string>>({}), [issues, setIssues] = useState<Record<string, string>>({}), [reason, setReason] = useState("");
  const request = state.requests.find(value => value.id === transfer.requestId)!, project = state.sites.find(value => value.id === request.siteId)!;
  const canReceive = state.role === "Site Personnel" && siteIds.includes(transfer.destinationSiteId) && ["dispatched", "confirmed"].includes(delivery.status);
  return <section className="panel transfer-trip"><div className="panel-heading"><div><h2>{delivery.ref}</h2><p className="helper-note">{delivery.scheduledDate} · {delivery.origin.name} → {delivery.destination.name}</p></div><Badge value={delivery.status}/></div>
    {delivery.status !== "cancelled" && <DocumentPreview kind="transfer" request={request} project={project} transferData={transferReceiptData(state, delivery)}/>}
    <div className="qa-bounded-table" tabIndex={0} role="region" aria-label={"Materials in trip " + delivery.ref}><table className="transfer-review-table"><thead><tr><th>Material</th><th>Expected</th><th>Accepted</th><th>Issue</th></tr></thead><tbody>{delivery.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!; return <tr key={line.transferLineId}><td>{item.name}<small>{item.unit}</small></td><td>{line.expected}</td><td>{canReceive ? <input aria-label={"Accepted quantity for " + item.name} min="0" max={line.expected} step="any" type="number" disabled={busy} value={quantities[line.transferLineId] ?? (delivery.status === "dispatched" ? line.expected : line.accepted)} onChange={event => setQuantities(current => ({ ...current, [line.transferLineId]: event.target.value }))}/> : ["confirmed", "posted"].includes(delivery.status) ? line.accepted : "Awaiting receipt"}</td><td>{canReceive && delivery.status === "dispatched" ? <input aria-label={"Issue for " + item.name} value={issues[line.transferLineId] || ""} disabled={busy} placeholder="Describe shortage or damage" onChange={event => setIssues(current => ({ ...current, [line.transferLineId]: event.target.value }))}/> : line.issue || "—"}</td></tr>; })}</tbody></table></div>
    {(state.role === "Logistics" && delivery.status === "expected" || canReceive && delivery.status === "confirmed") && <Field label={delivery.status === "confirmed" ? "Posting correction reason (if changed)" : "Cancellation reason"}><textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></Field>}
    <div className="transfer-actions">{state.role === "Logistics" && delivery.status === "expected" && <><button type="button" className="button primary" disabled={busy} onClick={() => void act({ type: "dispatchTransferDelivery", id: delivery.id }, "Dispatch this transfer and deduct source stock?")}>Record dispatch</button><button type="button" className="button danger-outline" disabled={busy} onClick={() => void act({ type: "cancelTransferDelivery", id: delivery.id, reason }, "Cancel this trip and retain its stock allocation?")}>Cancel trip</button></>}{canReceive && <button type="button" className="button primary" disabled={busy} onClick={() => void act(delivery.status === "dispatched" ? { type: "receiveTransferDelivery", id: delivery.id, lines: Object.fromEntries(delivery.lines.map(line => [line.transferLineId, { accepted: Number(quantities[line.transferLineId] ?? line.expected), issue: issues[line.transferLineId] || "" }])) } : { type: "postTransferDelivery", id: delivery.id, quantities: Object.fromEntries(delivery.lines.map(line => [line.transferLineId, Number(quantities[line.transferLineId] ?? line.accepted)])), reason }, delivery.status === "dispatched" ? "Confirm destination receipt?" : "Post accepted quantities into destination inventory?")}>{delivery.status === "dispatched" ? "Confirm receiving" : "Post accepted stock"}</button>}</div>
    {["confirmed", "posted"].includes(delivery.status) && <TransferDocuments state={state} transfer={transfer} delivery={delivery}/>}
  </section>;
}
function TransferDocumentReview({ state, transfer, busy, act }: { state: DemoSnapshot; transfer: StockTransfer } & Actions) {
  const [status, setStatus] = useState<"Under Review" | "Complete" | "Discrepancy">("Under Review"), [note, setNote] = useState("");
  const gaps = transferDocumentGaps(state, transfer);
  return <section className="panel"><h2>Accounting document review</h2><p className="helper-note">Check signatures and quantities. No invoice or payment clearance is required for a stock transfer.</p>{gaps.length > 0 && <ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}<Badge>{transfer.documentReview?.status || "Incomplete"}</Badge><form onSubmit={event => { event.preventDefault(); void act({ type: "reviewTransferDocuments", id: transfer.id, status, note }, "Save transfer document review?"); }}><div className="form-grid"><Field label="Review status"><select value={status} disabled={busy} onChange={event => setStatus(event.target.value as typeof status)}><option>Under Review</option><option disabled={gaps.length > 0}>Complete</option><option>Discrepancy</option></select></Field><Field label="Review note"><textarea value={note} disabled={busy} onChange={event => setNote(event.target.value)}/></Field></div><button className="button primary" disabled={busy}>Save document review</button></form></section>;
}
