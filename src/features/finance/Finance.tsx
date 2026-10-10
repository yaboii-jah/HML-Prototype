"use client";

import { isExternalPayment } from "@/src/domain/full-disbursement";
import { CoordinationQueue, CoordinationReview } from "./PaymentCoordination";
import { Register, ViewTabs } from "@/src/components/ui/Register";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, daysWaiting, money, today } from "@/src/domain/format";
import { paidTotal, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import { poStatusLabel } from "@/src/domain/workflow";
import type { Payment, PaymentRequest, Priority } from "@/src/domain/types";

export function FinanceQueue() {
  const { snapshot: state } = useDemo();
  const [active, setActive] = useState(0);
  if (!state) return null;
  return <><PageHeader eyebrow="FINANCE" title="Finance queue" description="Prioritize and coordinate external payments. Accounting verifies payment proof; delivery follows the agreed payment arrangement."/><ViewTabs labels={["Payment coordination", "Legacy payment requests"]} active={active} onChange={setActive} id="finance"/><div role="tabpanel" id={`finance-panel-${active}`} aria-labelledby={`finance-tab-${active}`}>{active === 0 ? <CoordinationQueue state={state}/> : <LegacyFinanceQueue/>}</div></>;
}

function LegacyFinanceQueue() {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState("");
  const [view, setView] = useState(0);
  const [priority, setPriority] = useState("all"), [min, setMin] = useState(""), [sort, setSort] = useState("priority");
  if (!state) return null;
  const rank = { Urgent: 0, High: 1, Normal: 2 };
  const rows = state.paymentRequests.filter(value => {
    const po = state.pos.find(po => po.id === value.poId);
    return po && !isExternalPayment(po) && `${value.ref} ${po.ref} ${supplierName(state,po)}`.toLowerCase().includes(search.toLowerCase()) && (view === 1 ? value.status === "disbursed" : ["submitted", "hold", "approved"].includes(value.status)) && (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter) && (priority === "all" || value.priority === priority) && (!min || value.amount >= Number(min));
  }).sort((a, b) => sort === "amount" ? b.amount - a.amount : sort === "waiting" ? a.updatedAt.localeCompare(b.updatedAt) : rank[a.priority] - rank[b.priority] || a.updatedAt.localeCompare(b.updatedAt));
  const relevant = state.paymentRequests.filter(value => { const po = state.pos.find(po => po.id === value.poId); return po && !isExternalPayment(po) && (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter); });
  return <><div className="panel-heading"><div><h2>Legacy payment requests</h2><p className="helper-note">Review and disburse existing Finance-managed payment requests.</p></div></div><ViewTabs id="legacy-payment-history" labels={[`Active (${relevant.filter(value => ["submitted", "hold", "approved"].includes(value.status)).length})`, `Settled (${relevant.filter(value => value.status === "disbursed").length})`]} active={view} onChange={setView}/><div role="tabpanel" id={`legacy-payment-history-panel-${view}`} aria-labelledby={`legacy-payment-history-tab-${view}`}>
    <Register rows={rows} resetKey={priority+min+sort+search+view+state.siteFilter} filters={<><input type="search" aria-label="Search Finance" placeholder="Search payment, PO or supplier" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option><option>Normal</option><option>High</option><option>Urgent</option></select><input aria-label="Minimum payment amount" type="number" min="0" placeholder="Minimum amount ₱" value={min} onChange={event => setMin(event.target.value)}/><select aria-label="Sort Finance queue" value={sort} onChange={event => setSort(event.target.value)}><option value="priority">Priority, then oldest</option><option value="waiting">Longest waiting</option><option value="amount">Highest amount</option></select></>} headers={<><th>Payment request / PO</th><th>Project</th><th>Priority</th><th className="numeric">Amount</th><th>Waiting</th><th>Status</th><th>Next action</th></>} empty={view === 1 ? "No settled legacy payments match these filters." : "No payment requests currently need Finance action."} renderRow={value => { const po = state.pos.find(po => po.id === value.poId)!; return <tr key={value.id}><td><Link className="table-primary" href={`/finance/${po.id}`}>{value.ref}</Link><small>{po.ref} · {supplierName(state, po)}</small></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td><Badge value={value.priority}/></td><td className="numeric">{money(value.amount)}</td><td>{daysWaiting(value.updatedAt)} days</td><td><Badge value={value.status}/></td><td>{value.status === "disbursed" ? "View payment history" : value.status === "approved" ? "Record disbursement" : "Review payment"}</td></tr>; }}/></div></>;
}

export function FinanceReview({ id }: { id: string }) {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  const po = state.pos.find(value => value.id === id);
  if (!po) return <MissingRecord name="Payment review" listHref="/finance"/>;
  const request = requestForPO(state, po);
  if (!request) return <MissingRecord name="Linked MRF" listHref="/finance"/>;
  if (isExternalPayment(po)) return <CoordinationReview po={po} state={state}/>;
  const requests = state.paymentRequests.filter(value => value.poId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <><RecordHeader backHref="/finance" backLabel="Finance queue" eyebrow={`${siteName(state, request.siteId)} · ${po.ref}`} title="Payment review" badges={<Badge value={po.status}>{poStatusLabel(po.status)}</Badge>}/>
    <div className="metric-strip"><div><small>PO TOTAL</small><strong>{money(poTotal(state, po))}</strong></div><div><small>DISBURSED</small><strong>{money(paidTotal(state, id))}</strong></div><div><small>UNPAID BALANCE</small><strong>{money(Math.max(0, poTotal(state, po) - paidTotal(state, id)))}</strong></div><div><small>ARRANGEMENT</small><strong>{po.paymentMode === "credit" ? "Credit / terms" : po.paymentMode === "upfront" ? "Upfront" : "Awaiting review"}</strong></div></div>
    <section className="panel"><div className="data-rows"><div><span>Supplier</span><strong>{supplierName(state, po)}</strong></div><div><span>Purchase order</span><Link href={`/purchase-orders/${id}`}>{po.ref}</Link></div><div><span>Accounting</span><Link href={`/accounting/${id}`}>PO review and release</Link></div></div><p className="helper-note">Payment approval records a decision. Disbursement records the actual payment. Accounting owns release to Logistics.</p></section>
    {requests.map(value => <PaymentReview key={value.id} paymentRequest={value}/>)}{!requests.length && <section className="panel"><Empty detail="Accounting has not prepared a payment request for this PO."/></section>}
    <Timeline state={state} ids={[id, request.id]}/>
  </>;
}

function PaymentReview({ paymentRequest: value }: { paymentRequest: PaymentRequest }) {
  const { snapshot: state, run } = useDemo();
  const { confirm, confirmation } = useConfirmation();
  const [decision, setDecision] = useState<"hold" | "return" | "reject" | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const editable = state.role === "Finance", active = ["submitted", "hold"].includes(value.status);
  const payment = state.payments.find(payment => payment.paymentRequestId === value.id);
  const decide = async (choice: "approve" | "hold" | "return" | "reject", reason?: string) => {
    if (!await confirm(`${choice === "approve" ? "Approve payment" : choice === "return" ? "Return to Accounting" : choice === "hold" ? "Hold payment" : "Reject payment"}?`, choice === "approve" ? `${money(value.amount)} will be approved for disbursement. No payment is recorded yet.` : "The reason will be recorded on this payment request.", "Confirm decision", choice === "reject")) return;
    const result = await run({ type: "reviewPaymentRequest", id: value.id, decision: choice, reason });
    setError(result.ok ? "" : result.message);
    if (result.ok) setDecision(null);
  };
  const disburse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!await confirm("Record actual disbursement?", `${money(value.amount)} will be recorded as paid against the PO. This payment request will close.`, "Record disbursement")) return;
    setBusy(true);
    const result = await run({ type: "recordPayment", paymentRequestId: value.id, method: String(form.get("method")) as Payment["method"], reference: String(form.get("reference") || ""), date: String(form.get("date")) });
    setError(result.ok ? "" : result.message);
    setBusy(false);
  };
  return <section className="panel finance-payment-review"><div className="panel-heading"><div><h2>{value.ref}</h2><p>{money(value.amount)} · {value.note || "Supplier payment"}</p></div><Badge value={value.status}/></div>
    {value.reason && <div className="callout warn"><strong>Review reason</strong><p>{value.reason}</p></div>}
    {editable && active && <><Field label="Priority"><select value={value.priority} onChange={event => void run({ type: "setPriority", id: value.id, priority: event.target.value as Priority })}><option>Normal</option><option>High</option><option>Urgent</option></select></Field><div className="button-row"><button className="button primary" onClick={() => void decide("approve")}>Approve payment</button><button className="button secondary" onClick={() => setDecision("hold")}>Hold with reason</button><button className="button secondary" onClick={() => setDecision("return")}>Return to Accounting</button><button className="button danger-outline" onClick={() => setDecision("reject")}>Reject with reason</button></div>{decision && <form className="decision-panel" onSubmit={event => { event.preventDefault(); void decide(decision, String(new FormData(event.currentTarget).get("reason"))); }}><Field label={`${decision} reason`}><textarea name="reason" required minLength={5}/></Field><div className="button-row"><button type="button" className="button secondary" onClick={() => setDecision(null)}>Cancel</button><button className="button primary">Continue to confirmation</button></div></form>}</>}
    {editable && value.status === "approved" && <form className="form-stack subform finance-disbursement-form" onSubmit={disburse}><h3>Record disbursement</h3><p className="helper-note">Amount: {money(value.amount)}. Record the approved amount after the supplier is paid.</p><div className="form-grid"><Field label="Method"><select name="method"><option>Bank</option><option>Cash</option><option>Check</option><option>Other</option></select></Field><Field label="Payment reference"><input name="reference" required/></Field><Field label="Payment date"><input name="date" type="date" defaultValue={today()} required/></Field></div><button className="button primary" disabled={busy}>Record disbursement</button></form>}
    {payment && <div className="data-rows"><div><span>Disbursement</span><strong>{money(payment.amount)} · {payment.method}</strong></div><div><span>Reference</span><strong>{payment.reference}</strong></div><div><span>Date</span><strong>{dateText(payment.date)}</strong></div></div>}
    <InlineError message={error}/>{confirmation}
  </section>;
}
