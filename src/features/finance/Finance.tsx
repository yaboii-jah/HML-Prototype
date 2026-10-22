"use client";

import { isExternalPayment } from "@/src/domain/full-disbursement";
import { CoordinationQueue, CoordinationReview } from "./PaymentCoordination";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money, today } from "@/src/domain/format";
import { paidTotal, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import { poStatusLabel } from "@/src/domain/workflow";
import type { Payment, PaymentRequest, Priority } from "@/src/domain/types";

export function FinanceQueue() {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  return <><PageHeader eyebrow="FINANCE" title="Finance queue" description="Prioritize and coordinate external payments. Accounting verifies payment proof; delivery follows the agreed payment arrangement."/><CoordinationQueue state={state}/></>;
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
