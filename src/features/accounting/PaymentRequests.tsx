"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { Badge, Empty, Field, InlineError } from "@/src/components/ui/Primitives";
import { money, dateText } from "@/src/domain/format";
import { paidTotal, poTotal } from "@/src/domain/selectors";
import { openPaymentRequest } from "@/src/domain/workflow";
import type { PO, PaymentRequest } from "@/src/domain/types";

export function PaymentRequests({ po }: { po: PO }) {
  const { snapshot: state } = useDemo();
  if (!state) return null;
  const open = openPaymentRequest(state, po.id);
  const balance = Math.max(0, poTotal(state, po) - paidTotal(state, po.id));
  const eligible = ["approved", "released"].includes(po.status);
  const requests = state.paymentRequests.filter(value => value.poId === po.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <section className="panel"><div className="panel-heading"><h2>Payment requests</h2><Link className="text-link" href={`/finance/${po.id}`}>Finance payment review →</Link></div><p className="helper-note">Accounting prepares a request. Finance approves it and records the actual disbursement. Invoice and receipt review stays separate.</p>
    {requests.map(value => { const payment = state.payments.find(payment => payment.paymentRequestId === value.id); return <div className="data-link" key={value.id}><div><strong>{value.ref} · {money(value.amount)}</strong><small>{value.note || "Supplier payment"}{value.reason && ` · ${value.reason}`}</small>{payment && <small>{payment.method} · {payment.reference} · {dateText(payment.date)}</small>}</div><Badge value={value.status}/></div>; })}
    {!requests.length && <Empty detail={eligible ? "No payment request prepared yet." : "Approve the PO before preparing payment."}/>}
    {eligible && balance > 0 && state.role === "Accounting / Auditing" && (!open || ["draft", "returned"].includes(open.status)) && <PaymentRequestForm key={`${open?.id || "new"}-${open?.updatedAt || balance}`} po={po} existing={open} balance={balance}/>}
  </section>;
}

function PaymentRequestForm({ po, existing, balance }: { po: PO; existing?: PaymentRequest; balance: number }) {
  const { run } = useDemo();
  const { confirm, confirmation } = useConfirmation();
  const [error, setError] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit";
    const amount = Number(form.get("amount"));
    if (submit && !await confirm(`Send payment request for ${po.ref}?`, `${money(amount)} will go to Finance for payment approval.`, "Submit payment request")) return;
    const result = await run({ type: "savePaymentRequest", id: existing?.id, poId: po.id, amount, note: String(form.get("note") || ""), submit });
    setError(result.ok ? "" : result.message);
  };
  return <form className="form-stack subform payment-request-form" onSubmit={save}><h3>{existing ? "Revise payment request" : "Prepare payment request"}</h3><div className="form-grid"><Field label="Requested amount" hint={`Unpaid PO balance: ${money(balance)}`}><input name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={existing?.amount || Math.round(balance * 100) / 100} required/></Field><Field label="Payment request note (optional)"><textarea name="note" defaultValue={existing?.note || ""}/></Field></div><div className="button-row"><button className="button secondary" value="draft">Save payment draft</button><button className="button primary" value="submit">Submit payment request</button></div><InlineError message={error}/>{confirmation}</form>;
}
