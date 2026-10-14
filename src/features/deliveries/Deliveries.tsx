"use client";

import { useDeliveryReceiptArchive } from "./DeliveryReceiptArchive";
import { COMPANY_WAREHOUSE } from "@/src/domain/company";
import { MaterialDetailsModal, MaterialDetailsRow, MaterialDetailsTrigger } from "@/src/components/ui/MaterialDetails";
import { Register, ViewTabs } from "@/src/components/ui/Register";

import { StockTransferRegister } from "@/src/features/transfers/StockTransfers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { AccountingDocuments } from "@/src/features/accounting/AccountingDocuments";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { AssignmentNotice, MissingRecord } from "@/src/components/ui/States";
import { DocumentPreview } from "@/src/components/DocumentPreview";
import { auditTime, actorName } from "@/src/domain/audit";
import { dateText } from "@/src/domain/format";
import { batchQuantityLimit, batchStage, deliveryLocations, deliveryPayment, deliveryToday, isReceivedBatch, isSiteBatch, legFor, legLabel, warehouseAvailableFor } from "@/src/domain/delivery-flow";
import { poItems, outstandingFor, requestForPO, schedulableFor, siteName, stockFor, supplierName } from "@/src/domain/selectors";
import type { Batch, DeliveryLeg, DeliveryLocation, DemoSnapshot, PO } from "@/src/domain/types";

export function Deliveries() {
  const { snapshot: state, access } = useDemo();
  const id=useId(),[view,setView]=useState(0),[readySearch,setReadySearch]=useState("");
  const [search, setSearch] = useState(""), [stage, setStage] = useState("all");
  if (!state) return null;
  const matchesProject = (po: PO) => access.canReadRecord(po.id) && (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter);
  const ready = state.pos.filter(po => po.status === "released" && `${po.ref} ${requestForPO(state,po)?.ref} ${supplierName(state,po)}`.toLowerCase().includes(readySearch.toLowerCase()) && matchesProject(po) && poItems(state, po).some(item => schedulableFor(state, po, item.id) > 0));
  const rows = state.batches.filter(batch => {
    const po = state.pos.find(value => value.id === batch.poId);
    return po && matchesProject(po) && (stage === "all" || batch.status === stage) && `${batch.ref} ${po.ref} ${requestForPO(state, po)?.ref} ${supplierName(state, po)} ${batch.destination?.name || ""}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <><PageHeader title="Delivery tracker" description="Scheduling, warehouse forwarding, site stock transfers, receiving and stock posting."/><AssignmentNotice/><StockTransferRegister/><ViewTabs id={id} active={view} onChange={setView} labels={["Delivery batches", "Ready to schedule"]}/><div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={view!==0}><Register rows={rows} resetKey={search+stage+state.siteFilter} unit="batches" className="delivery-overview-table" filters={<><input aria-label="Search deliveries" placeholder="Search batch, PO, MRF or supplier" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="Delivery stage" value={stage} onChange={event => setStage(event.target.value)}><option value="all">All stages</option><option value="expected">Scheduled</option><option value="dispatched">In transit</option><option value="confirmed">Received</option><option value="posted">Stock posted</option></select></>} headers={<><th>Batch / PO / MRF</th><th>Project / supplier</th><th>Scheduled</th><th>Route</th><th>Destination</th><th>Stage</th><th>Payment</th></>} empty={state.batches.length?"No delivery batches match these filters.":"Logistics schedules batches after Accounting releases a PO."} renderRow={batch => {
      const po = state.pos.find(value => value.id === batch.poId)!, request = requestForPO(state, po)!;
      const locations = deliveryLocations(state, po, batch);
      return <tr key={batch.id}><td><Link className="table-primary" href={`/deliveries/${batch.id}`}>{batch.ref}</Link><small><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link> · {request.ref}</small></td><td>{siteName(state, request.siteId)}<small>{supplierName(state, po)}</small></td><td>{dateText(batch.scheduledDate)}{batch.delayReason && <small>Delayed · {batch.delayReason}</small>}</td><td>{legLabel(batch)}</td><td>{locations.destination.name}<small>{locations.destination.address}</small></td><td><Badge value={batch.status}>{batchStage(batch)}</Badge></td><td>{deliveryPayment(state, po)}</td></tr>;
    }}/></div><div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={view!==1}><Register rows={ready} resetKey={readySearch+state.siteFilter} unit="ready POs" filters={<input type="search" aria-label="Search ready deliveries" placeholder="Search PO, MRF or supplier" value={readySearch} onChange={event=>setReadySearch(event.target.value)}/>} headers={<><th>PO / MRF</th><th>Project</th><th>Supplier</th><th>Payment</th><th>Action</th></>} empty="No released POs currently have supplier quantities ready to schedule." renderRow={po => <tr key={po.id}><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link><small>{requestForPO(state, po)?.ref}</small></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td>{supplierName(state, po)}</td><td>{deliveryPayment(state, po)}</td><td>{state.role === "Logistics" ? <Link className="button secondary" href={`/deliveries/new?poId=${po.id}`}>Log batch</Link> : <span>Awaiting Logistics</span>}</td></tr>}/></div></>;
}

export function BatchForm({ poId, parentBatchId }: { poId?: string; parentBatchId?: string }) {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  if (state.role !== "Logistics") return <><PageHeader title="Delivery scheduling" description="Logistics schedules and dispatches delivery batches."/><section className="panel"><Link className="button secondary" href="/deliveries">Back to delivery tracker</Link></section></>;
  const po = state.pos.find(value => value.id === poId && value.status === "released");
  if (!po) return <MissingRecord name="Released PO" listHref="/deliveries"/>;
  const parent = state.batches.find(value => value.id === parentBatchId && value.poId === po.id && legFor(value) === "supplier-warehouse" && value.status === "confirmed");
  if (parentBatchId && !parent) return <MissingRecord name="Confirmed warehouse receipt" listHref="/deliveries"/>;
  return <BatchEditor key={`${po.id}-${parent?.id || "supplier"}`} state={state} po={po} parent={parent}/>;
}

function BatchEditor({ state, po, parent }: { state: DemoSnapshot; po: PO; parent?: Batch }) {
  const { run } = useDemo(), router = useRouter(), { confirm, confirmation } = useConfirmation();
  const { notify, update, dismiss } = useActionFeedback();
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const [leg, setLeg] = useState<DeliveryLeg>(parent ? "warehouse-site" : "supplier-site");
  const baseline = deliveryLocations(state, po);
  const [destinations, setDestinations] = useState<Record<DeliveryLeg, DeliveryLocation>>({ "supplier-site": baseline.destination, "supplier-warehouse": { ...COMPANY_WAREHOUSE }, "warehouse-site": baseline.destination });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const selectedMaterial = poItems(state, po).find(item => item.id === selectedMaterialId);
  const limit = (itemId: string) => parent ? warehouseAvailableFor(state, parent.id, itemId) : schedulableFor(state, po, itemId);
  const destination = destinations[leg];
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving) return;
    const form = new FormData(event.currentTarget), expected = Object.fromEntries(poItems(state, po).map(item => [item.id, Number(form.get(`expected-${item.id}`))]));
    setSaving(true);
    try {
      if (!await confirm(`Log a delivery batch for ${po.ref}?`, "Logistics records dispatch when the goods leave. The receiving department then confirms quantities.", "Log batch")) return;
      const toast = notify({ tone: "progress", title: "Logging the delivery batch…", detail: `${po.ref} · ${leg === "supplier-site" ? "Supplier → Site" : leg === "supplier-warehouse" ? "Supplier → Company Warehouse" : "Company Warehouse → Site"}` });
      const result = await run({ type: "createBatch", poId: po.id, leg, parentBatchId: parent?.id, destination, scheduledDate: String(form.get("date")), evidence: String(form.get("evidence")), delayReason: String(form.get("delay") || ""), expected });
      if (result.ok) { dismiss(toast); router.push(`/deliveries/${result.recordId}`); }
      else { setError(result.message); update(toast, { tone: "error", title: result.message, detail: po.ref }); }
    } catch { setError("The batch could not be saved. Try again."); } finally { setSaving(false); }
  };
  return <><PageHeader eyebrow={`LOGISTICS · ${po.ref}`} title={parent ? "Schedule warehouse forwarding" : "Log expected batch"} description="Schedule the route and quantities, then record actual dispatch when the delivery leaves."/>
    <form className="form-stack" onSubmit={create}><section className="panel"><h2 className="panel-title">Schedule and destination</h2>{parent && <p className="helper-note">Source warehouse receipt: <Link href={`/deliveries/${parent.id}`}>{parent.ref}</Link> · {parent.destination?.name}</p>}<div className="form-grid">
      <Field label="Delivery route"><select name="leg" value={leg} disabled={!!parent || saving} onChange={event => setLeg(event.target.value as DeliveryLeg)}>{parent ? <option value="warehouse-site">Company Warehouse → Site</option> : <><option value="supplier-site">Supplier → Site</option><option value="supplier-warehouse">Supplier → Company Warehouse</option></>}</select></Field>
      <Field label="Scheduled date"><input name="date" type="date" required defaultValue={deliveryToday()}/></Field>
      <Field label="Destination name"><input name="destinationName" value={destination.name} required onChange={event => setDestinations(current => ({ ...current, [leg]: { ...current[leg], name: event.target.value } }))}/></Field>
      <Field label="Delivery location / address"><input name="destinationAddress" value={destination.address} required onChange={event => setDestinations(current => ({ ...current, [leg]: { ...current[leg], address: event.target.value } }))}/></Field>
      <Field label="Delivery evidence reference"><input name="evidence" required placeholder="Delivery receipt pending"/></Field>
      <Field label="Delay reason, if any"><input name="delay"/></Field>
    </div><p className="helper-note">{deliveryPayment(state, po)}</p></section>
      <section className="panel"><h2 className="panel-title">Goods to schedule</h2><div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Goods to schedule"><table><thead><tr><th>Material</th><th>Unit</th><th>Available to schedule</th><th>Expected quantity</th></tr></thead><tbody>{poItems(state, po).map(item => <MaterialDetailsRow key={item.id} disabled={saving} onOpen={() => setSelectedMaterialId(item.id)}><td><MaterialDetailsTrigger disabled={saving} onClick={() => setSelectedMaterialId(item.id)}>{item.name}</MaterialDetailsTrigger></td><td>{item.unit}</td><td>{limit(item.id)}</td><td><label className="field"><input aria-label={`Expected quantity for ${item.name}`} name={`expected-${item.id}`} type="number" min="0" max={limit(item.id)} step="any" value={quantities[item.id] ?? String(limit(item.id))} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))} required/></label></td></MaterialDetailsRow>)}</tbody></table></div></section>
      <InlineError message={error}/><div className="form-actions"><Link className="button secondary" href={parent ? `/deliveries/${parent.id}` : "/deliveries"}>Cancel</Link><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Log batch"}</button></div>
    </form><MaterialDetailsModal item={selectedMaterial} onClose={() => setSelectedMaterialId("")}>{selectedMaterial && <div className="data-rows"><div><span>PO</span><strong>{po.ref}</strong></div><div><span>Available to schedule</span><strong>{limit(selectedMaterial.id)} {selectedMaterial.unit}</strong></div><div><span>Expected quantity</span><strong>{quantities[selectedMaterial.id] ?? limit(selectedMaterial.id)} {selectedMaterial.unit}</strong></div><div><span>Destination</span><strong>{destination.name} / {destination.address}</strong></div></div>}</MaterialDetailsModal>{confirmation}</>;
}

export function BatchDetail({ id }: { id: string }) {
  const archiveReceipt = useDeliveryReceiptArchive();
  const { snapshot: state, run, siteIds } = useDemo(), { confirm: confirmAction, confirmation } = useConfirmation();
  const { notify, update } = useActionFeedback();
  const [error, setError] = useState(""), [preview, setPreview] = useState<Record<string, number>>({}), [busy, setBusy] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<{ id: string; context: "receipt" | "posting" } | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<Record<string, { accepted?: string; issue?: string }>>({});
  if (!state) return null;
  const batch = state.batches.find(value => value.id === id);
  if (!batch) return <MissingRecord name="Delivery batch" listHref="/deliveries"/>;
  const po = state.pos.find(value => value.id === batch.poId), request = po && requestForPO(state, po);
  if (!po || !request) return <MissingRecord name="Linked PO" listHref="/deliveries"/>;
  const activeMaterial = request.items.find(item => item.id === selectedMaterial?.id && batch.lines.some(line => line.itemId === item.id));
  const activeLine = batch.lines.find(line => line.itemId === activeMaterial?.id);
  const warehouse = !isSiteBatch(batch), parent = state.batches.find(value => value.id === batch.parentBatchId), children = state.batches.filter(value => value.parentBatchId === batch.id);
  const locations = deliveryLocations(state, po, batch), canReceive = state.role === (warehouse ? "Procurement" : "Site Personnel") && (warehouse || siteIds.includes(request.siteId)) && (batch.status === "dispatched" || !batch.leg && batch.status === "expected");
  const dispatch = async () => {
    if (busy) return; setBusy(true);
    try { if (!await confirmAction(`Dispatch ${batch.ref}?`, "The shipment will be in transit and its receiving department can confirm quantities.", "Dispatch delivery")) return;
      const toast = notify({ tone: "progress", title: "Recording dispatch…", detail: batch.ref });
      const result = await run({ type: "dispatchBatch", id }); setError(result.ok ? "" : result.message);
      update(toast, result.ok ? { tone: "success", title: "Dispatch recorded.", detail: `${batch.ref} · in transit` } : { tone: "error", title: result.message, detail: batch.ref });
    } catch { setError("Dispatch could not be recorded. Try again."); } finally { setBusy(false); }
  };
  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), lines = Object.fromEntries(batch.lines.map(line => [line.itemId, { accepted: Number(form.get(`accepted-${line.itemId}`)), issue: String(form.get(`issue-${line.itemId}`) || "") }]));
    setBusy(true);
    try { if (!await confirmAction(`Confirm received quantities for ${batch.ref}?`, warehouse ? "Accepted quantities become available for onward delivery to this PO's site." : "Accepted quantities will move to the stock posting review.", "Confirm receipt")) return;
      const toast = notify({ tone: "progress", title: warehouse ? "Confirming warehouse receipt…" : "Confirming received quantities…", detail: batch.ref });
      const result = await run({ type: "confirmBatch", id, lines }); setError(result.ok ? "" : result.message);
      if (result.ok) { update(toast, { tone: "success", title: warehouse ? "Warehouse receipt confirmed." : "Received quantities confirmed.", detail: `${batch.ref} · archiving delivery receipt` }); void archiveReceipt(result.snapshot, id).catch(() => {}); }
      else update(toast, { tone: "error", title: result.message, detail: batch.ref });
    } catch { setError("Receipt could not be recorded. Try again."); } finally { setBusy(false); }
  };
  const post = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), accepted = Object.fromEntries(batch.lines.map(line => [line.itemId, Number(form.get(`post-${line.itemId}`))]));
    setBusy(true);
    try { if (!await confirmAction(`Post ${batch.ref} to site stock?`, "This batch can be posted only once. Review accepted quantities before continuing.", "Post to stock")) return;
      const toast = notify({ tone: "progress", title: "Posting to site stock…", detail: batch.ref });
      const result = await run({ type: "postBatch", id, accepted, reason: String(form.get("reason") || "") }); setError(result.ok ? "" : result.message);
      if (result.ok) { update(toast, { tone: "success", title: "Posted to site stock.", detail: `${batch.ref} · ${siteName(state, request.siteId)}` }); void archiveReceipt(result.snapshot, id).catch(() => {}); }
      else update(toast, { tone: "error", title: result.message, detail: batch.ref });
    } catch { setError("Stock posting could not be recorded. Try again."); } finally { setBusy(false); }
  };
  return <>
    <RecordHeader backHref="/deliveries" backLabel="Delivery tracker" eyebrow={`${po.ref} · ${siteName(state, request.siteId)}`} title={batch.ref} badges={<><Badge value={batch.status}>{batchStage(batch)}</Badge><Badge value={po.status}/></>}/>
    {state.role === "Logistics" && batch.status === "expected" && <section className="action-bar"><div><strong>Ready for dispatch</strong><p>{legLabel(batch)}</p></div><button className="button primary" disabled={busy} onClick={() => void dispatch()}>Dispatch delivery</button></section>}
    <div className="content-grid"><section className="panel"><div className="panel-heading"><h2>Batch details</h2><DocumentPreview kind="delivery" batch={batch} parentBatch={parent} request={request} po={po} project={state.sites.find(site => site.id === request.siteId)!}/></div><div className="data-rows">
      <div><span>Route</span><strong>{legLabel(batch)}</strong></div><div><span>From</span><strong>{locations.origin.name}<small>{locations.origin.address}</small></strong></div><div><span>Delivery location</span><strong>{locations.destination.name}<small>{locations.destination.address}</small></strong></div>
      <div><span>Scheduled</span><strong>{dateText(batch.scheduledDate)}</strong></div><div><span>Supplier</span><strong>{supplierName(state, po)}</strong></div><div><span>Payment</span><strong>{deliveryPayment(state, po)}</strong></div><div><span>Evidence</span><strong>{batch.evidence}</strong></div><div><span>Delay</span><strong>{batch.delayReason || "None recorded"}</strong></div>
      {parent && <div><span>Warehouse receipt</span><Link href={`/deliveries/${parent.id}`}>{parent.ref}</Link></div>}
      <div><span>Dispatch recorded</span><strong>{auditTime(batch.dispatchedAt)}<small>{actorName("Logistics", batch.dispatchedByIdentity)}</small></strong></div><div><span>Receipt recorded</span><strong>{auditTime(batch.receivedAt)}<small>{actorName(warehouse ? "Procurement" : "Site Personnel", batch.receivedByIdentity)}</small></strong></div>
    </div>{batch.postingReason && <p className="helper-note">Posting correction: {batch.postingReason}</p>}</section>
    <section className="panel"><h2 className="panel-title">{warehouse ? "Warehouse forwarding" : "Open site balance"}</h2>{warehouse ? <>
      <p className="helper-note">Schedule onward deliveries against this warehouse receipt. Dispatched quantities remain allocated when the site records a shortage.</p>
      {state.role === "Logistics" && batch.status === "confirmed" && batch.lines.some(line => warehouseAvailableFor(state, batch.id, line.itemId) > 0) && <Link className="button primary" href={`/deliveries/new?poId=${po.id}&parentBatchId=${batch.id}`}>Schedule onward delivery</Link>}
      {children.map(child => <Link className="data-link" href={`/deliveries/${child.id}`} key={child.id}><strong>{child.ref}</strong><Badge value={child.status}>{batchStage(child)}</Badge></Link>)}{!children.length && <Empty detail="No onward deliveries scheduled yet."/>}
    </> : <div className="data-rows">{poItems(state, po).map(item => <div key={item.id}><span>{item.name}</span><strong>{outstandingFor(state, po, item.id)} {item.unit}</strong></div>)}</div>}
    <Link className="data-link" href={`/purchase-orders/${po.id}`}><strong>{po.ref}</strong><span>Open purchase order →</span></Link>{batch.status === "posted" && <div className="callout good"><strong>Posted to {siteName(state, request.siteId)}</strong><p>{auditTime(batch.postedAt)} · {actorName("Site Personnel", batch.postedByIdentity)}</p></div>}</section></div>
    {canReceive && <form className="panel form-stack" onSubmit={receive}><h2 className="panel-title">{warehouse ? "Confirm warehouse receipt" : "Confirm received quantities"}</h2><p className="muted">Confirm accepted quantities and explain every shortage or damaged amount.</p><div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Received material quantities"><table><thead><tr><th>Material</th><th>Expected</th><th>Accepted quantity</th><th>Shortage / damage note</th></tr></thead><tbody>{batch.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!; return <MaterialDetailsRow key={line.itemId} disabled={busy} onOpen={() => setSelectedMaterial({ id: item.id, context: "receipt" })}><td><MaterialDetailsTrigger disabled={busy} onClick={() => setSelectedMaterial({ id: item.id, context: "receipt" })}>{item.name}</MaterialDetailsTrigger><small>{item.unit}</small></td><td>{line.expected} {item.unit}</td><td><label className="field"><input aria-label={`Accepted quantity for ${item.name}`} name={`accepted-${line.itemId}`} type="number" min="0" max={batchQuantityLimit(state, po, batch, line.itemId)} step="any" defaultValue={line.expected} onChange={event => setReceiptDraft(current => ({ ...current, [item.id]: { ...current[item.id], accepted: event.target.value } }))} required/></label></td><td><label className="field"><input aria-label={`Shortage or damage note for ${item.name}`} name={`issue-${line.itemId}`} placeholder="Required if accepted is lower" onChange={event => setReceiptDraft(current => ({ ...current, [item.id]: { ...current[item.id], issue: event.target.value } }))}/></label></td></MaterialDetailsRow>; })}</tbody></table></div><button className="button primary" disabled={busy}>{warehouse ? "Confirm warehouse receipt" : "Confirm received quantities"}</button></form>}
    {!warehouse && state.role === "Site Personnel" && siteIds.includes(request.siteId) && batch.status === "confirmed" && <form className="panel form-stack" onSubmit={post}><span className="eyebrow">POSTING PREVIEW</span><h2 className="panel-title">Increase site stock</h2><p className="muted">Any change to confirmed quantities requires a reason.</p><div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Site stock posting quantities"><table><thead><tr><th>Material</th><th>Current stock</th><th>Accepted quantity</th><th>Stock after posting</th></tr></thead><tbody>{batch.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!, amount = preview[line.itemId] ?? line.accepted, current = stockFor(state, request.siteId, item.name, item.unit); return <MaterialDetailsRow key={line.itemId} disabled={busy} onOpen={() => setSelectedMaterial({ id: item.id, context: "posting" })}><td><MaterialDetailsTrigger disabled={busy} onClick={() => setSelectedMaterial({ id: item.id, context: "posting" })}>{item.name}</MaterialDetailsTrigger></td><td>{current} {item.unit}</td><td><label className="field"><input aria-label={`Accepted quantity for ${item.name}`} name={`post-${line.itemId}`} type="number" min="0" max={batchQuantityLimit(state, po, batch, line.itemId)} step="any" value={amount} onChange={event => setPreview(current => ({ ...current, [line.itemId]: Number(event.target.value) }))}/></label></td><td><strong>{current + amount} {item.unit}</strong></td></MaterialDetailsRow>; })}</tbody></table></div><Field label="Reason if quantities changed"><input name="reason" placeholder="Required for a correction"/></Field><button className="button primary" disabled={busy}>Post to site stock</button></form>}
    <MaterialDetailsModal item={activeMaterial} onClose={() => setSelectedMaterial(null)}>{activeMaterial && activeLine && <div className="data-rows"><div><span>Delivery batch / PO</span><strong>{batch.ref} / {po.ref}</strong></div><div><span>Expected quantity</span><strong>{activeLine.expected} {activeMaterial.unit}</strong></div><div><span>Accepted quantity</span><strong>{selectedMaterial?.context === "receipt" ? receiptDraft[activeMaterial.id]?.accepted ?? activeLine.expected : preview[activeMaterial.id] ?? activeLine.accepted} {activeMaterial.unit}</strong></div>{selectedMaterial?.context === "receipt" ? <div><span>Shortage / damage note</span><strong>{receiptDraft[activeMaterial.id]?.issue || "None entered"}</strong></div> : <><div><span>Current stock</span><strong>{stockFor(state, request.siteId, activeMaterial.name, activeMaterial.unit)} {activeMaterial.unit}</strong></div><div><span>Stock after posting</span><strong>{stockFor(state, request.siteId, activeMaterial.name, activeMaterial.unit) + (preview[activeMaterial.id] ?? activeLine.accepted)} {activeMaterial.unit}</strong></div></>}<div><span>Destination</span><strong>{locations.destination.name} / {locations.destination.address}</strong></div></div>}</MaterialDetailsModal>
    {isReceivedBatch(batch) && <AccountingDocuments poId={po.id} batchId={batch.id}/>}
    <InlineError message={error}/>{confirmation}<Timeline state={state} ids={[batch.id]}/>
  </>;
}
