"use client";

import { Register } from "@/src/components/ui/Register";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { actorText } from "@/src/domain/audit";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { Badge, Field, InlineError, PageHeader, RecordHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText } from "@/src/domain/format";
import { inventoryFor, materialFor, siteName, stockFor } from "@/src/domain/selectors";

export function Inventory() {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState("");
  if (!state) return null;
  const rows = state.sites.filter(site => state.siteFilter === "all" || site.id === state.siteFilter).flatMap(site => inventoryFor(state, site.id).map(item => ({ ...item, site })));
  const filtered = rows.filter(row => `${row.name} ${row.site.name}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="SITE STOCK LEDGER" title="Site inventory" description="Posted receipts, usage, and corrections by project and material."/><Register rows={filtered} resetKey={search+state.siteFilter} filters={<><input aria-label="Search inventory" placeholder="Search material or project" value={search} onChange={event => setSearch(event.target.value)}/></>} headers={<><th>Material</th><th>Project</th><th className="numeric">On hand</th><th>Unit</th><th>Last update</th><th>Position</th></>} empty={state.movements.length ? "No site materials match this view." : "No site stock yet. Post accepted delivery quantities to build inventory."} renderRow={row => <tr key={`${row.site.id}-${row.id}`}><td><Link className="table-primary" href={`/inventory/${row.site.id}/${row.id}`}>{row.name}</Link></td><td>{row.site.name}</td><td className="numeric"><strong>{row.onHand}</strong></td><td>{row.unit}</td><td>{dateText(state.movements.filter(m => m.siteId === row.site.id && m.itemName.toLowerCase() === row.name.toLowerCase() && m.unit.toLowerCase() === row.unit.toLowerCase()).sort((a,b) => b.at.localeCompare(a.at))[0]?.at || "")}</td><td><Badge value={row.onHand <= 0 ? "Low stock" : "In stock"}/></td></tr>}/></>;
}

export function MaterialDetail({ siteId, materialId }: { siteId: string; materialId: string }) {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot: state, run } = useDemo();
  const { notify, update } = useActionFeedback();
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"usage" | "adjustment">("usage");
  if (!state) return null;
  const site = state.sites.find(s => s.id === siteId);
  const item = materialFor(state, siteId, materialId);
  if (!site || !item) return <MissingRecord name="Site material" listHref="/inventory"/>;
  const movements = state.movements.filter(m => m.siteId === siteId && m.itemName.toLowerCase() === item.name.toLowerCase() && m.unit.toLowerCase() === item.unit.toLowerCase()).sort((a, b) => b.at.localeCompare(a.at));
  const record = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("quantity"));
    if (!await confirm(`Record ${kind} for ${item.name}?`, `${amount} ${item.unit} will ${kind === "usage" ? "reduce" : "change"} the on-hand balance at ${site.name}.`, "Record movement")) return;
    const toast = notify({ tone: "progress", title: kind === "usage" ? "Recording material usage…" : "Recording stock adjustment…", detail: `${item.name} · ${site.name}` });
    const result = await run({ type: "recordMovement", siteId, itemName: item.name, unit: item.unit, kind, quantity: amount, reason: String(form.get("reason") || "") });
    if (result.ok) { setError(""); formElement.reset(); update(toast, { tone: "success", title: result.message, detail: `${item.name} · ${site.name}` }); }
    else { setError(result.message); update(toast, { tone: "error", title: result.message, detail: item.name }); }
  };
  return <><RecordHeader backHref="/inventory" backLabel="Site inventory" eyebrow={siteName(state, siteId)} title={item.name} badges={<Badge value={item.onHand <= 0 ? "Low stock" : "In stock"}/>}/><div className="metric-strip"><div><small>ON HAND</small><strong>{item.onHand} {item.unit}</strong></div><div><small>RECEIPTS</small><strong>{movements.filter(m => m.kind === "receipt" || m.kind === "opening").reduce((n, m) => n + m.quantity, 0)} {item.unit}</strong></div><div><small>USED</small><strong>{-movements.filter(m => m.kind === "usage").reduce((n, m) => n + m.quantity, 0)} {item.unit}</strong></div><div><small>MOVEMENTS</small><strong>{movements.length}</strong></div></div><div className="content-grid"><section className="panel"><h2 className="panel-title">Movement history</h2><Register embedded rows={movements} unit="movements" resetKey={siteId+materialId} headers={<><th>Date</th><th>Type</th><th className="numeric">Quantity</th><th>Reason / source</th><th>By</th></>} renderRow={m => <tr key={m.id}><td>{dateText(m.at)}</td><td><Badge value={m.kind}/></td><td className={`numeric ${m.quantity < 0 ? "negative" : "positive"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity} {m.unit}</td><td>{m.reason}{m.batchId && <Link className="text-link" href={`/deliveries/${m.batchId}`}> {m.batchId}</Link>}</td><td>{actorText(m.actor, m.actorIdentity)}</td></tr>}/></section><section className="panel"><h2 className="panel-title">Stock action</h2>{state.role === "Site Personnel" || state.role === "Accounting / Auditing" ? <form onSubmit={record}><Field label="Action"><select value={kind} onChange={event => setKind(event.target.value as "usage" | "adjustment")}><option value="usage" disabled={state.role !== "Site Personnel"}>Record usage</option><option value="adjustment">Stock adjustment</option></select></Field><Field label={kind === "usage" ? `Quantity used (${item.unit})` : `Signed correction (${item.unit})`} hint={kind === "adjustment" ? "Use a negative number to reduce stock." : undefined}><input name="quantity" type="number" step="any" required/></Field><Field label="Reason"><textarea name="reason" minLength={5} required placeholder="Describe work use or correction"/></Field><p className="helper-note">Current stock: {stockFor(state, siteId, item.name, item.unit)} {item.unit}. Stock cannot go below zero.</p><InlineError message={error}/><button className="button primary">Record movement</button></form> : <p className="muted">Sign in as Site Personnel to record usage, or Accounting to correct stock.</p>}</section></div>{confirmation}</>;
}
