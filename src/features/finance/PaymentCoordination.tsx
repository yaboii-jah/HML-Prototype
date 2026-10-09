"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Badge, Field, InlineError, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { COORDINATION_STATUSES, coordinatedPOs, coordinationBalance, coordinationEligible, coordinationStatus, coordinationWarning } from "@/src/domain/payment-coordination";
import { dateText, money } from "@/src/domain/format";
import { paidTotal, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import type { DemoSnapshot, PaymentCoordination, PO } from "@/src/domain/types";

export function CoordinationSummary({ state, po }: { state: DemoSnapshot; po: PO }) {
  const plan = po.paymentCoordination, warning = coordinationWarning(state, po);
  return <section className="panel payment-coordination-summary"><div className="panel-heading"><h2>Finance coordination</h2><Badge value={coordinationStatus(state, po)}/></div>
    <div className="data-rows"><div><span>Priority</span><strong>{plan?.priority || "Normal"}</strong></div><div><span>Agreed credit due date</span><strong>{po.paymentDueDate ? dateText(po.paymentDueDate) : "Not applicable"}</strong></div><div><span>Next planned payment</span><strong>{plan?.plannedDate ? dateText(plan.plannedDate) : "Not scheduled"}</strong></div></div>
    {plan?.note && <p className="helper-note">{plan.note}</p>}{warning && <p className="field-error">{warning}</p>}
    <p className="helper-note">Finance coordinates external payment. Accounting verifies the proof and amount. Coordination does not confirm payment or clear delivery.</p>
    {!!po.coordinationHistory?.length && <details><summary>Coordination history · {po.coordinationHistory.length}</summary><div className="data-rows">{[...po.coordinationHistory].reverse().map(entry => <div key={entry.revision}><span>{entry.status} · {entry.priority}{entry.plannedDate && ` · ${dateText(entry.plannedDate)}`}<small>{entry.reason}{entry.note && ` · ${entry.note}`}</small></span><strong>{entry.by.name}<small>{new Date(entry.at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</small></strong></div>)}</div></details>}
  </section>;
}

export function CoordinationQueue({ state, rows: supplied, readOnly = false }: { state: DemoSnapshot; rows?: PO[]; readOnly?: boolean }) {
  const [search, setSearch] = useState(""), [priority, setPriority] = useState("all"), [status, setStatus] = useState("active");
  const rows = (supplied || coordinatedPOs(state, status !== "active")).filter(po =>
    (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter) &&
    (priority === "all" || (po.paymentCoordination?.priority || "Normal") === priority) &&
    (status === "all" || status === "active" && coordinationStatus(state, po) !== "Settled" || coordinationStatus(state, po) === status) &&
    `${po.ref} ${supplierName(state, po)} ${siteName(state, requestForPO(state, po)?.siteId || "")}`.toLowerCase().includes(search.toLowerCase()));
  return <Register embedded={readOnly} rows={rows} unit="purchase orders" resetKey={search+priority+status+state.siteFilter}
    filters={<><input type="search" aria-label="Search payment coordination" placeholder="Search PO, supplier or project" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Coordination priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option>{["Normal", "High", "Urgent"].map(value => <option key={value}>{value}</option>)}</select><select aria-label="Coordination status" value={status} onChange={e => setStatus(e.target.value)}><option value="active">Active payments</option><option value="all">All payments</option>{[...COORDINATION_STATUSES, "Settled"].map(value => <option key={value}>{value}</option>)}</select></>}
    headers={<><th>PO / supplier</th><th>Project</th><th>Arrangement</th><th className="numeric">Balance</th><th>Priority</th><th>Agreed due date</th><th>Planned payment</th><th>Status</th></>}
    empty="No issued purchase orders match this payment view."
    renderRow={po => <tr key={po.id}><td><Link className="table-primary" href={readOnly ? `/accounting/${po.id}` : `/finance/${po.id}`}>{po.ref}</Link><small>{supplierName(state, po)}</small></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td>{po.paymentMode === "credit" ? "Credit / terms" : "Upfront"}</td><td className="numeric">{money(coordinationBalance(state, po))}</td><td><Badge value={po.paymentCoordination?.priority || "Normal"}/></td><td>{po.paymentDueDate ? dateText(po.paymentDueDate) : "—"}</td><td>{po.paymentCoordination?.plannedDate ? dateText(po.paymentCoordination.plannedDate) : "Not scheduled"}</td><td><Badge value={coordinationStatus(state, po)}/>{coordinationWarning(state, po) && <small className="field-error">{coordinationWarning(state, po)}</small>}</td></tr>}/>;
}

export function CoordinationReview({ po, state }: { po: PO; state: DemoSnapshot }) {
  return <><RecordHeader backHref="/finance" backLabel="Finance queue" eyebrow={`${po.ref} · ${supplierName(state, po)}`} title="Payment coordination" badges={<Badge value={coordinationStatus(state, po)}/>}/>
    <div className="metric-strip"><div><small>NET PAYABLE</small><strong>{money(poTotal(state, po))}</strong></div><div><small>VERIFIED PAID</small><strong>{money(paidTotal(state, po.id))}</strong></div><div><small>OUTSTANDING</small><strong>{money(coordinationBalance(state, po))}</strong></div><div><small>ARRANGEMENT</small><strong>{po.paymentMode === "credit" ? "Credit / terms" : "Upfront"}</strong></div></div>
    <CoordinationSummary state={state} po={po}/>
    {state.role === "Finance" && coordinationEligible(po) && coordinationBalance(state, po) > 0 && <CoordinationForm key={`${po.id}-${po.paymentCoordination?.revision || 0}`} po={po}/>}
    {!po.issuance && <p className="helper-note">Procurement must issue this PO before Finance can coordinate payment.</p>}
    <Link className="button secondary" href={`/accounting/${po.id}`}>Open Accounting verification</Link><Timeline state={state} ids={[po.id, po.mrfId]}/></>;
}

function CoordinationForm({ po }: { po: PO }) {
  const { run } = useDemo(), { confirm, confirmation } = useConfirmation();
  const [status, setStatus] = useState<PaymentCoordination["status"]>(po.paymentCoordination?.status || "Pending");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (status !== (po.paymentCoordination?.status || "Pending") && !await confirm("Update payment status?", status === "Awaiting Accounting verification" ? "This reports an external payment for Accounting to verify. No paid amount or delivery clearance will change." : `Finance coordination will change to ${status}. Payment verification remains with Accounting.`, "Update status")) return;
      const result = await run({ type: "savePaymentCoordination", poId: po.id, revision: po.paymentCoordination?.revision || 0, priority: String(data.get("priority")) as PaymentCoordination["priority"], status, plannedDate: String(data.get("date") || ""), note: String(data.get("note") || "") });
      setError(result.ok ? "" : result.message);
    } finally { setBusy(false); }
  };
  return <section className="panel"><h2>Update coordination</h2><form className="form-stack payment-coordination-form" onSubmit={save}><div className="form-grid"><Field label="Priority"><select name="priority" defaultValue={po.paymentCoordination?.priority || "Normal"}><option>Normal</option><option>High</option><option>Urgent</option></select></Field><Field label="Coordination status"><select name="status" value={status} onChange={e => setStatus(e.target.value as PaymentCoordination["status"])}>{COORDINATION_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Next planned payment date" hint="Does not change Accounting’s agreed due date."><input name="date" type="date" required={status === "Scheduled"} defaultValue={po.paymentCoordination?.plannedDate || ""}/></Field></div><Field label={status === "Delayed" ? "Delay reason" : "Coordination notes"}><textarea name="note" required={status === "Delayed"} minLength={status === "Delayed" ? 5 : undefined} maxLength={2000} defaultValue={po.paymentCoordination?.note || ""}/></Field><InlineError message={error}/><button className="button primary" disabled={busy}>Save coordination</button></form>{confirmation}</section>;
}
