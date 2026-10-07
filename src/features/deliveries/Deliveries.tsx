"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { AccountingDocuments } from "@/src/features/accounting/AccountingDocuments";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { DocumentPreview } from "@/src/components/DocumentPreview";
import { auditTime, actorName } from "@/src/domain/audit";
import { dateText } from "@/src/domain/format";
import { batchQuantityLimit, batchStage, deliveryLocations, deliveryPayment, deliveryToday, isReceivedBatch, isSiteBatch, legFor, legLabel, warehouseAvailableFor, warehouseHeldFor } from "@/src/domain/delivery-flow";
import { poItems, outstandingFor, requestForPO, schedulableFor, siteName, stockFor, supplierName } from "@/src/domain/selectors";
import type { Batch, DeliveryLeg, DeliveryLocation, DemoSnapshot, PO } from "@/src/domain/types";

export function Deliveries() {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState(""), [stage, setStage] = useState("all");
  if (!state) return null;
  const matchesProject = (po: PO) => state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter;
  const ready = state.pos.filter(po => po.status === "released" && matchesProject(po) && poItems(state, po).some(item => schedulableFor(state, po, item.id) > 0));
  const rows = state.batches.filter(batch => {
    const po = state.pos.find(value => value.id === batch.poId);
    return po && matchesProject(po) && (stage === "all" || batch.status === stage) && `${batch.ref} ${po.ref} ${requestForPO(state, po)?.ref} ${supplierName(state, po)} ${batch.destination?.name || ""}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <>
    <PageHeader eyebrow="LOGISTICS AND RECEIVING" title="Delivery tracker" description="Follow supplier deliveries, warehouse forwarding, site receiving and stock posting."/>
    {ready.length > 0 && <section className="panel"><h2 className="panel-title">Ready to schedule from supplier</h2><div className="table-frame"><table><thead><tr><th>PO / MRF</th><th>Project</th><th>Supplier</th><th>Payment</th><th>Action</th></tr></thead><tbody>{ready.map(po => <tr key={po.id}><td><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link><small>{requestForPO(state, po)?.ref}</small></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td>{supplierName(state, po)}</td><td>{deliveryPayment(state, po)}</td><td>{state.role === "Logistics" ? <Link className="button secondary" href={`/deliveries/new?poId=${po.id}`}>Log batch</Link> : <span>Awaiting Logistics</span>}</td></tr>)}</tbody></table></div></section>}
    <div className="toolbar"><input aria-label="Search deliveries" placeholder="Search batch, PO, MRF or supplier" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="Delivery stage" value={stage} onChange={event => setStage(event.target.value)}><option value="all">All stages</option><option value="expected">Scheduled</option><option value="dispatched">In transit</option><option value="confirmed">Received</option><option value="posted">Stock posted</option></select></div>
    <div className="table-frame"><table className="delivery-overview-table"><thead><tr><th>Batch / PO / MRF</th><th>Project / supplier</th><th>Scheduled</th><th>Route</th><th>Destination</th><th>Stage</th><th>Payment</th></tr></thead><tbody>{rows.map(batch => {
      const po = state.pos.find(value => value.id === batch.poId)!, request = requestForPO(state, po)!;
      const locations = deliveryLocations(state, po, batch), parent = state.batches.find(value => value.id === batch.parentBatchId);
      return <tr key={batch.id}><td><Link className="table-primary" href={`/deliveries/${batch.id}`}>{batch.ref}</Link><small><Link href={`/purchase-orders/${po.id}`}>{po.ref}</Link> · {request.ref}</small>{parent && <small>From <Link href={`/deliveries/${parent.id}`}>{parent.ref}</Link></small>}</td><td>{siteName(state, request.siteId)}<small>{supplierName(state, po)}</small></td><td>{dateText(batch.scheduledDate)}{batch.delayReason && <small>Delayed · {batch.delayReason}</small>}</td><td>{legLabel(batch)}</td><td>{locations.destination.name}<small>{locations.destination.address}</small></td><td><Badge value={batch.status}>{batchStage(batch)}</Badge></td><td>{deliveryPayment(state, po)}</td></tr>;
    })}</tbody></table>{!rows.length && <Empty detail={state.batches.length ? "No delivery batches match these filters." : "Logistics schedules batches after Accounting releases a PO."}/>}</div>
  </>;
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
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const [leg, setLeg] = useState<DeliveryLeg>(parent ? "warehouse-site" : "supplier-site");
  const baseline = deliveryLocations(state, po);
  const [destinations, setDestinations] = useState<Record<DeliveryLeg, DeliveryLocation>>({ "supplier-site": baseline.destination, "supplier-warehouse": { name: "Company Warehouse", address: "" }, "warehouse-site": baseline.destination });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const limit = (itemId: string) => parent ? warehouseAvailableFor(state, parent.id, itemId) : schedulableFor(state, po, itemId);
  const destination = destinations[leg];
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving) return;
    const form = new FormData(event.currentTarget), expected = Object.fromEntries(poItems(state, po).map(item => [item.id, Number(form.get(`expected-${item.id}`))]));
    setSaving(true);
    try {
      if (!await confirm(`Log a delivery batch for ${po.ref}?`, "Logistics records dispatch when the goods leave. The receiving department then confirms quantities.", "Log batch")) return;
      const result = await run({ type: "createBatch", poId: po.id, leg, parentBatchId: parent?.id, destination, scheduledDate: String(form.get("date")), evidence: String(form.get("evidence")), delayReason: String(form.get("delay") || ""), expected });
      if (result.ok) router.push(`/deliveries/${result.recordId}`); else setError(result.message);
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
      <section className="panel"><h2 className="panel-title">Goods to schedule</h2><div className="form-grid">{poItems(state, po).map(item => <Field key={item.id} label={`${item.name} · expected ${item.unit} (max ${limit(item.id)})`}><input name={`expected-${item.id}`} type="number" min="0" max={limit(item.id)} step="any" value={quantities[item.id] ?? String(limit(item.id))} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))} required/></Field>)}</div></section>
      <InlineError message={error}/><div className="form-actions"><Link className="button secondary" href={parent ? `/deliveries/${parent.id}` : "/deliveries"}>Cancel</Link><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Log batch"}</button></div>
    </form>{confirmation}</>;
}

export function BatchDetail({ id }: { id: string }) {
  const { snapshot: state, run } = useDemo(), { confirm: confirmAction, confirmation } = useConfirmation();
  const [error, setError] = useState(""), [preview, setPreview] = useState<Record<string, number>>({}), [busy, setBusy] = useState(false);
  if (!state) return null;
  const batch = state.batches.find(value => value.id === id);
  if (!batch) return <MissingRecord name="Delivery batch" listHref="/deliveries"/>;
  const po = state.pos.find(value => value.id === batch.poId), request = po && requestForPO(state, po);
  if (!po || !request) return <MissingRecord name="Linked PO" listHref="/deliveries"/>;
  const warehouse = !isSiteBatch(batch), parent = state.batches.find(value => value.id === batch.parentBatchId), children = state.batches.filter(value => value.parentBatchId === batch.id);
  const locations = deliveryLocations(state, po, batch), canReceive = state.role === (warehouse ? "Procurement" : "Site Personnel") && (batch.status === "dispatched" || !batch.leg && batch.status === "expected");
  const dispatch = async () => {
    if (busy) return; setBusy(true);
    try { if (!await confirmAction(`Dispatch ${batch.ref}?`, "The shipment will be in transit and its receiving department can confirm quantities.", "Dispatch delivery")) return;
      const result = await run({ type: "dispatchBatch", id }); setError(result.ok ? "" : result.message);
    } catch { setError("Dispatch could not be recorded. Try again."); } finally { setBusy(false); }
  };
  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), lines = Object.fromEntries(batch.lines.map(line => [line.itemId, { accepted: Number(form.get(`accepted-${line.itemId}`)), issue: String(form.get(`issue-${line.itemId}`) || "") }]));
    setBusy(true);
    try { if (!await confirmAction(`Confirm received quantities for ${batch.ref}?`, warehouse ? "Accepted quantities become available for onward delivery to this PO's site." : "Accepted quantities will move to the stock posting review.", "Confirm receipt")) return;
      const result = await run({ type: "confirmBatch", id, lines }); setError(result.ok ? "" : result.message);
    } catch { setError("Receipt could not be recorded. Try again."); } finally { setBusy(false); }
  };
  const post = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), accepted = Object.fromEntries(batch.lines.map(line => [line.itemId, Number(form.get(`post-${line.itemId}`))]));
    setBusy(true);
    try { if (!await confirmAction(`Post ${batch.ref} to site stock?`, "This batch can be posted only once. Review accepted quantities before continuing.", "Post to stock")) return;
      const result = await run({ type: "postBatch", id, accepted, reason: String(form.get("reason") || "") }); setError(result.ok ? "" : result.message);
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
    </div><div className="table-frame embedded"><table><thead><tr><th>Goods</th><th>Expected</th><th>Accepted</th><th>Issue</th>{warehouse && <><th>Held at warehouse</th><th>Available to schedule</th></>}</tr></thead><tbody>{batch.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!;
      return <tr key={line.itemId}><td>{item.name}<small>{item.location}</small></td><td>{line.expected} {item.unit}</td><td>{isReceivedBatch(batch) ? `${line.accepted} ${item.unit}` : "Not recorded"}</td><td>{line.issue || "—"}</td>{warehouse && <><td>{warehouseHeldFor(state, batch.id, line.itemId)} {item.unit}</td><td>{warehouseAvailableFor(state, batch.id, line.itemId)} {item.unit}</td></>}</tr>;
    })}</tbody></table></div>{batch.postingReason && <p className="helper-note">Posting correction: {batch.postingReason}</p>}</section>
    <section className="panel"><h2 className="panel-title">{warehouse ? "Warehouse forwarding" : "Open site balance"}</h2>{warehouse ? <>
      <p className="helper-note">Schedule onward deliveries against this warehouse receipt. Dispatched quantities remain allocated when the site records a shortage.</p>
      {state.role === "Logistics" && batch.status === "confirmed" && batch.lines.some(line => warehouseAvailableFor(state, batch.id, line.itemId) > 0) && <Link className="button primary" href={`/deliveries/new?poId=${po.id}&parentBatchId=${batch.id}`}>Schedule onward delivery</Link>}
      {children.map(child => <Link className="data-link" href={`/deliveries/${child.id}`} key={child.id}><strong>{child.ref}</strong><Badge value={child.status}>{batchStage(child)}</Badge></Link>)}{!children.length && <Empty detail="No onward deliveries scheduled yet."/>}
    </> : <div className="data-rows">{poItems(state, po).map(item => <div key={item.id}><span>{item.name}</span><strong>{outstandingFor(state, po, item.id)} {item.unit}</strong></div>)}</div>}
    <Link className="data-link" href={`/purchase-orders/${po.id}`}><strong>{po.ref}</strong><span>Open purchase order →</span></Link>{batch.status === "posted" && <div className="callout good"><strong>Posted to {siteName(state, request.siteId)}</strong><p>{auditTime(batch.postedAt)} · {actorName("Site Personnel", batch.postedByIdentity)}</p></div>}</section></div>
    {canReceive && <form className="panel form-stack" onSubmit={receive}><h2 className="panel-title">{warehouse ? "Confirm warehouse receipt" : "Confirm received quantities"}</h2><p className="muted">Confirm accepted quantities and explain every shortage or damaged amount.</p>{batch.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!; return <div className="form-grid" key={line.itemId}><Field label={`${item.name} · accepted ${item.unit}`}><input name={`accepted-${line.itemId}`} type="number" min="0" max={batchQuantityLimit(state, po, batch, line.itemId)} step="any" defaultValue={line.expected} required/></Field><Field label="Shortage / damage note"><input name={`issue-${line.itemId}`} placeholder="Required if accepted is lower"/></Field></div>; })}<button className="button primary" disabled={busy}>{warehouse ? "Confirm warehouse receipt" : "Confirm received quantities"}</button></form>}
    {!warehouse && state.role === "Site Personnel" && batch.status === "confirmed" && <form className="panel form-stack" onSubmit={post}><span className="eyebrow">POSTING PREVIEW</span><h2 className="panel-title">Increase site stock</h2><p className="muted">Any change to confirmed quantities requires a reason.</p>{batch.lines.map(line => { const item = request.items.find(value => value.id === line.itemId)!, amount = preview[line.itemId] ?? line.accepted; return <div className="posting-preview" key={line.itemId}><div><strong>{item.name}</strong><small>Current stock: {stockFor(state, request.siteId, item.name, item.unit)} {item.unit}</small></div><Field label={`Accepted ${item.unit}`}><input name={`post-${line.itemId}`} type="number" min="0" max={batchQuantityLimit(state, po, batch, line.itemId)} step="any" value={amount} onChange={event => setPreview(current => ({ ...current, [line.itemId]: Number(event.target.value) }))}/></Field><strong>+{amount} {item.unit}</strong></div>; })}<Field label="Reason if quantities changed"><input name="reason" placeholder="Required for a correction"/></Field><button className="button primary" disabled={busy}>Post to site stock</button></form>}
    {!warehouse && isReceivedBatch(batch) && <AccountingDocuments poId={po.id} batchId={batch.id}/>}
    <InlineError message={error}/>{confirmation}<Timeline state={state} ids={[batch.id]}/>
  </>;
}
