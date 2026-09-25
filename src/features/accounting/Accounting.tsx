"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money, today } from "@/src/domain/format";
import { paidTotal, paymentStatus, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import type { DocumentStatus, Payment } from "@/src/domain/types";

export function Accounting() {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState("");
  if (!state) return null;
  const rows = state.pos.filter(po => ["approved", "served"].includes(po.status) && (state.siteFilter === "all" || requestForPO(state, po)?.siteId === state.siteFilter) && `${po.ref} ${supplierName(state, po)}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="DOCUMENT AND PAYMENT CONTROL" title="Accounting queue" description="Review invoice references, receipts, and payment entries."/><div className="toolbar"><input aria-label="Search accounting" placeholder="Search PO or supplier" value={search} onChange={event => setSearch(event.target.value)}/></div><div className="table-frame"><table><thead><tr><th>PO</th><th>Project</th><th>Supplier</th><th>Document review</th><th>Payment</th><th>Balance</th></tr></thead><tbody>{rows.map(po => <tr key={po.id}><td><Link className="table-primary" href={`/accounting/${po.id}`}>{po.ref}</Link></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td>{supplierName(state, po)}</td><td><Badge value={state.accounting.find(a => a.poId === po.id)?.review || "Incomplete"}/></td><td><Badge value={paymentStatus(state, po)}/></td><td>{money(poTotal(state, po) - paidTotal(state, po.id))}</td></tr>)}</tbody></table>{!rows.length && <Empty detail="No approved POs match this view."/>}</div></>;
}

export function AccountingDetail({ id }: { id: string }) {
  const { snapshot: state, run } = useDemo();
  const [error, setError] = useState("");
  if (!state) return null;
  const po = state.pos.find(p => p.id === id);
  if (!po) return <MissingRecord name="Accounting record" listHref="/accounting"/>;
  const request = requestForPO(state, po);
  if (!request) return <MissingRecord name="Linked MRF" listHref="/accounting"/>;
  const account = state.accounting.find(a => a.poId === id);
  const payments = state.payments.filter(p => p.poId === id).sort((a, b) => b.date.localeCompare(a.date));
  const balance = poTotal(state, po) - paidTotal(state, id);
  const eligible = ["approved", "served"].includes(po.status);
  const saveDocs = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await run({ type: "saveDocuments", poId: id, invoiceRef: String(form.get("invoice") || ""), receiptRef: String(form.get("receipt") || ""), review: String(form.get("review")) as DocumentStatus, note: String(form.get("note") || "") }); setError(result.ok ? "" : result.message); };
  const savePayment = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const result = await run({ type: "recordPayment", poId: id, amount: Number(form.get("amount")), method: String(form.get("method")) as Payment["method"], reference: String(form.get("reference") || ""), date: String(form.get("date")) }); if (result.ok) { setError(""); formElement.reset(); } else setError(result.message); };
  return <><RecordHeader backHref="/accounting" backLabel="Accounting queue" eyebrow={`${siteName(state, request.siteId)} / ${po.ref}`} title="Accounting record" badges={<><Badge value={account?.review || "Incomplete"}/><Badge value={paymentStatus(state, po)}/></>}/><div className="metric-strip"><div><small>PO TOTAL</small><strong>{money(poTotal(state, po))}</strong></div><div><small>PAID</small><strong>{money(paidTotal(state, id))}</strong></div><div><small>OUTSTANDING</small><strong>{money(balance)}</strong></div><div><small>DOCUMENTS</small><strong>{account?.review || "Incomplete"}</strong></div></div><div className="content-grid"><section className="panel"><h2 className="panel-title">Document review</h2><p className="helper-note">Record invoice and receipt references for this purchase order.</p><form onSubmit={saveDocs}><Field label="Invoice reference"><input name="invoice" defaultValue={account?.invoiceRef || ""}/></Field><Field label="Receipt reference"><input name="receipt" defaultValue={account?.receiptRef || ""}/></Field><Field label="Review result"><select name="review" defaultValue={account?.review || "Incomplete"}>{["Incomplete", "Under Review", "Complete", "Discrepancy"].map(status => <option key={status}>{status}</option>)}</select></Field><Field label="Review note"><textarea name="note" defaultValue={account?.note || ""}/></Field>{state.role === "Accounting / Auditing" && eligible && <button className="button primary">Save document review</button>}</form></section><section className="panel"><h2 className="panel-title">Payment references</h2><div className="data-rows"><div><span>Supplier</span><strong>{supplierName(state, po)}</strong></div><div><span>Purchase order</span><Link href={`/purchase-orders/${id}`}>{po.ref}</Link></div><div><span>Payment status</span><Badge value={paymentStatus(state, po)}/></div></div><h3 className="subheading">Delivery evidence</h3>{state.batches.filter(batch => batch.poId === id).map(batch => <Link className="data-link" href={`/deliveries/${batch.id}`} key={batch.id}><div><strong>{batch.ref}</strong><small>{batch.evidence} / {dateText(batch.scheduledDate)}</small></div><Badge value={batch.status}/></Link>)}{payments.map(payment => <div className="data-link" key={payment.id}><div><strong>{money(payment.amount)} / {payment.method}</strong><small>{payment.reference} / {dateText(payment.date)}</small></div><Badge>Recorded</Badge></div>)}{!payments.length && <Empty detail="No payment references recorded."/>}{state.role === "Accounting / Auditing" && eligible && balance > 0 && <form className="form-stack subform" onSubmit={savePayment}><h3>Record payment</h3><div className="form-grid"><Field label="Amount"><input name="amount" type="number" min="0.01" max={balance} step="0.01" required/></Field><Field label="Method"><select name="method"><option>Bank</option><option>Cash</option><option>Check</option><option>Other</option></select></Field><Field label="Payment reference"><input name="reference" required/></Field><Field label="Date"><input name="date" type="date" defaultValue={today()} required/></Field></div><button className="button primary">Record payment reference</button></form>}</section></div><InlineError message={error}/><Timeline state={state} ids={[id]}/></>;
}
