"use client";
import { creditOverdue } from "@/src/domain/credit-terms";
import { CoordinationSummary } from "@/src/features/finance/PaymentCoordination";
import { CreditPaymentVerification } from "./CreditPaymentVerification";
import { deliveryDocumentIssues } from "@/src/domain/delivery-archive";
import { Register } from "@/src/components/ui/Register";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";

import { batchStage } from "@/src/domain/delivery-flow";

import { AccountingPOReview } from "./AccountingPOReview";
import { isExternalCredit, isExternalPayment } from "@/src/domain/full-disbursement";
import { ExternalPaymentVerification } from "./ExternalPaymentVerification";
import { PaymentRequests } from "./PaymentRequests";
import { accountingNextAction, poStatusLabel } from "@/src/domain/workflow";
import { AccountingDocuments } from "./AccountingDocuments";
import { accountingGroups } from "@/src/domain/accounting-documents";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { MissingRecord } from "@/src/components/ui/States";
import { dateText, money } from "@/src/domain/format";
import { paidTotal, paymentStatus, poTotal, requestForPO, siteName, supplierName } from "@/src/domain/selectors";
import type { DocumentStatus } from "@/src/domain/types";

export function Accounting() {
  const { snapshot: state } = useDemo();
  const [search, setSearch] = useState("");
  if (!state) return null;
  const groups = accountingGroups(state, search);
  return <><PageHeader title="Accounting queue" description="Expand an MRF to review its purchase orders, documents and payment status."/>
    <Register rows={groups} resetKey={search + state.siteFilter} unit="MRFs" className="accounting-groups" tableClassName="accounting-group-list"
      filters={<input type="search" aria-label="Search accounting" placeholder="Search MRF, PO or supplier" value={search} onChange={event => setSearch(event.target.value)}/>}
      empty={state.pos.length ? "No purchase orders match this view." : "No purchase orders are linked to an MRF yet."}
      headers={<th>Material requests</th>}
      renderRow={({ request, pos, totalCount }) => {
        const eligible = pos.filter(po => ["approved", "released"].includes(po.status));
        const balance = eligible.reduce((sum, po) => sum + poTotal(state, po) - paidTotal(state, po.id), 0);
        const count = pos.length === totalCount ? `${totalCount} purchase order${totalCount === 1 ? "" : "s"}` : `${pos.length} of ${totalCount} purchase orders match`;
        return <tr key={request.id} className="accounting-group"><td>
          <CollapsibleSection key={`${request.id}-${search.trim()}-${state.siteFilter}`} title={request.ref || "Unnumbered MRF"} defaultOpen={!!search.trim()} stickyHeading={false} className="accounting-mrf"
            summary={<span className="accounting-mrf-summary"><span>{siteName(state, request.siteId)} · {count} · {eligible.length} approved</span><span>Approved outstanding balance <strong>{money(balance)}</strong></span></span>}>
            <div className="accounting-mrf-heading"><Link className="text-link" href={`/requests/${request.id}`}>View MRF →</Link></div>
            <div className="accounting-po-scroll" role="region" aria-label={`Purchase orders for ${request.ref || "unnumbered MRF"}`} tabIndex={0}>
              <table className="accounting-po-list"><caption>Purchase orders for {request.ref || "unnumbered MRF"}</caption>
                <thead><tr><th>PO</th><th>Supplier</th><th>PO status</th><th>Documents</th><th>Payment</th><th className="numeric">Balance</th><th>Next action</th></tr></thead>
                <tbody>{pos.map(po => {
                  const ready = ["approved", "released"].includes(po.status);
                  return <tr key={po.id}><td><Link className="table-primary" href={`/accounting/${po.id}`}>{po.ref}</Link></td>
                    <td><span className="table-text" title={supplierName(state, po)}>{supplierName(state, po)}</span></td>
                    <td><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></td>
                    <td>{ready ? <Badge value={state.accounting.find(value => value.poId === po.id)?.review || "Incomplete"}/> : po.status === "rejected" ? "Closed" : "Awaiting approval"}</td>
                    <td>{ready ? <><Badge value={paymentStatus(state, po)}/>{creditOverdue(state, po) && <small className="field-error">Overdue / {dateText(po.paymentDueDate || "")}</small>}</> : "--"}</td>
                    <td className="numeric">{ready ? money(poTotal(state, po) - paidTotal(state, po.id)) : "--"}</td><td>{accountingNextAction(state, po)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </CollapsibleSection>
        </td></tr>;
      }}/>
  </>;
}

export function AccountingDetail({ id }: { id: string }) {
  const { confirm, confirmation } = useConfirmation();
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
  const eligible = ["approved", "released"].includes(po.status);
  const saveDocs = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const review = String(form.get("review")) as DocumentStatus; if ((review === "Complete" || review === "Discrepancy") && !await confirm(`Mark documents ${review.toLowerCase()}?`, `The accounting review for ${po.ref} will be recorded as ${review.toLowerCase()}.`, `Mark ${review.toLowerCase()}`)) return; const result = await run({ type: "saveDocuments", poId: id, invoiceRef: String(form.get("invoice") || ""), receiptRef: String(form.get("receipt") || ""), review, note: String(form.get("note") || "") }); setError(result.ok ? "" : result.message); };
  return <><RecordHeader backHref="/accounting" backLabel="Accounting queue" eyebrow={`${siteName(state, request.siteId)} / ${po.ref}`} title="Accounting record" badges={<><Badge value={po.status}>{poStatusLabel(po.status)}</Badge><Badge value={account?.review || "Incomplete"}/><Badge value={paymentStatus(state, po)}/></>}/><div className="metric-strip"><div><small>PO TOTAL</small><strong>{money(poTotal(state, po))}</strong></div><div><small>PAID</small><strong>{money(paidTotal(state, id))}</strong></div><div><small>OUTSTANDING</small><strong>{money(balance)}</strong></div><div><small>DOCUMENTS</small><strong>{account?.review || "Incomplete"}</strong></div></div><AccountingPOReview key={`review-${po.id}`} po={po}/>{isExternalPayment(po) && po.issuance && <CoordinationSummary state={state} po={po}/>}{isExternalCredit(po) ? <CreditPaymentVerification key={`credit-${po.id}`} po={po}/> : isExternalPayment(po) ? <ExternalPaymentVerification key={`upfront-${po.id}`} po={po}/> : <PaymentRequests po={po}/>}<div className="content-grid"><section className="panel"><h2 className="panel-title">Document review</h2><p className="helper-note">Record invoice and receipt references. Each confirmed delivery needs its generated receipt and a signed receipt archived to Drive.</p>{deliveryDocumentIssues(state, id).length > 0 && <ul className="document-review-issues">{deliveryDocumentIssues(state, id).map(issue => <li key={issue}>{issue}</li>)}</ul>}<form onSubmit={saveDocs}><Field label="Invoice reference"><input readOnly={!eligible || state.role !== "Accounting / Auditing"} name="invoice" defaultValue={account?.invoiceRef || ""}/></Field><Field label="Receipt reference"><input readOnly={!eligible || state.role !== "Accounting / Auditing"} name="receipt" defaultValue={account?.receiptRef || ""}/></Field><Field label="Review result"><select disabled={!eligible || state.role !== "Accounting / Auditing"} name="review" defaultValue={account?.review || "Incomplete"}>{["Incomplete", "Under Review", "Complete", "Discrepancy"].map(status => <option key={status}>{status}</option>)}</select></Field><Field label="Review note"><textarea readOnly={!eligible || state.role !== "Accounting / Auditing"} name="note" defaultValue={account?.note || ""}/></Field>{state.role === "Accounting / Auditing" && eligible && <button className="button primary">Save document review</button>}</form></section><section className="panel"><h2 className="panel-title">{isExternalPayment(po) ? "Linked delivery records" : "Disbursement history"}</h2><div className="data-rows"><div><span>Supplier</span><strong>{supplierName(state, po)}</strong></div><div><span>Purchase order</span><Link href={`/purchase-orders/${id}`}>{po.ref}</Link></div><div><span>Payment status</span><Badge value={paymentStatus(state, po)}/></div></div>{!isExternalPayment(po) && <h3 className="subheading">Delivery evidence</h3>}{state.batches.filter(batch => batch.poId === id).map(batch => <Link className="data-link" href={`/deliveries/${batch.id}`} key={batch.id}><div><strong>{batch.ref}</strong><small>{batch.evidence} / {dateText(batch.scheduledDate)}</small></div><Badge value={batch.status}>{batchStage(batch)}</Badge></Link>)}{payments.map(payment => <div className="data-link" key={payment.id}><div><strong>{money(payment.amount)} / {payment.method}</strong><small>{payment.reference} / {dateText(payment.date)}</small></div><Badge>Recorded</Badge></div>)}{!payments.length && !isExternalPayment(po) && <Empty detail="No Finance disbursements recorded."/>}</section></div><AccountingDocuments poId={id}/>{!!account?.reviewHistory?.length && <details className="panel"><summary>Previous document reviews ({account.reviewHistory.length})</summary>{account.reviewHistory.map((review, index) => <div className="subform" key={index}><strong>{review.review} / {review.invoiceRef} / {review.receiptRef}</strong><p className="helper-note">{review.reason} / {review.at} / {review.by?.name || "User not recorded"}</p>{review.note && <p>{review.note}</p>}</div>)}</details>}<InlineError message={error}/>{confirmation}<Timeline state={state} ids={[id]}/></>;
}
