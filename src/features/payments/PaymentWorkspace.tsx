"use client";
import Link from "next/link";
import { useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Badge, Field, PageHeader } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { formatPhp, moneyCents } from "@/src/domain/projects/projects";
import { COORDINATION_STATUSES, PAYMENT_METHODS, PRIORITIES, emptyPaymentBody, emptyPlan, philippineToday,
  type PaymentBody, type PaymentCommand, type PaymentEvent, type PaymentPlan, type PaymentRecord, type PaymentsView } from "@/src/domain/payments/payments";
import { PaymentProofs } from "./PaymentProofs";
import { usePaymentOperation } from "./use-payment-operation";
import "./payments.css";

const when = (at: string) => new Date(at).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
function EventHistory({ events }: { events: PaymentEvent[] }) {
  return <ol className="payment-history">{events.map(e => <li key={e.id}>
    <strong>{e.action || "No-cash settlement"}</strong>{e.reason && <p>{e.reason}</p>}
    <small>{e.actor.name} · {e.actor.activeRole} · {when(e.at)}</small>
    {e.reversal && <p>Reversed by {e.reversal.actor.name} · {when(e.reversal.at)} · {e.reversal.reason}</p>}
  </li>)}</ol>;
}
type Editor = { id: string; body: PaymentBody; version: string; replacesId?: string };
type Decision = { type: PaymentCommand["type"]; version: string; draftId?: string; reason: string; reviewed: boolean };
const actionLabels: Partial<Record<PaymentCommand["type"], string>> = { verify: "Verify payment", reverse: "Reverse payment", noCash: "Confirm no-cash settlement", reverseNoCash: "Reverse no-cash confirmation", clear: "Clear delivery", hold: "Place delivery hold", cancelDraft: "Cancel payment draft" };

export function PaymentWorkspace({ initial, poId, embedded = false }: { initial: PaymentsView; poId: string; embedded?: boolean }) {
  const live = useFoundationRealtime(), operation = usePaymentOperation();
  const view = live.view?.kind === "payments" ? live.view.data : live.view?.kind === "purchasing" && live.view.data.payments ? live.view.data.payments : initial;
  const saved = view.records.find(r => r.poId === poId);
  const [editor, setEditor] = useState<Editor | null>(null), [decision, setDecision] = useState<Decision | null>(null);
  if (!saved) return <section className="panel"><h2>Payments unavailable</h2><p>Payment work starts after Procurement records supplier issuance.</p></section>;
  const accounting = view.role === "Accounting", canSettle = accounting && !saved.coordinators.includes(view.actorId);
  const open = (type: Decision["type"], draftId?: string) => setDecision({ type, draftId, version: saved.version, reason: "", reviewed: false });
  const selected = decision?.draftId ? saved.drafts.find(d => d.id === decision.draftId) : null;
  const balance = <dl className="payment-facts">
    {[['Approved gross', saved.gross], ['Supplier net', saved.net], ['Verified payments', saved.paid], ['Outstanding', saved.outstanding], ['Gross spent', saved.spent]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{formatPhp(amount)}</dd></div>)}
  </dl>;
  return <div className="payments-workspace">
    {!embedded && <><Link className="back-link" href="/finance">Finance</Link><PageHeader title={saved.ref} description={`${saved.vendor} · ${saved.mode === 'credit' ? 'Credit' : 'Upfront'} payment`} actions={<Link className="button secondary" href={`/accounting/${poId}`}>Open Accounting</Link>} /></>}
    <section className="panel">
      <h2>Payment and delivery clearance</h2>
      <div className="badge-row"><Badge value={saved.settled ? "Settled" : saved.net === "0.00" ? "No-cash confirmation pending" : "Payment outstanding"} /><Badge value={saved.cleared ? "Delivery cleared" : "Delivery not cleared"} /></div>
      {balance}
      <p>Gross moves from committed to spent as payments are verified. Their combined budget consumption stays unchanged.</p>
      {saved.mode === "credit" && <p>Agreed Credit due date: <strong>{saved.dueDate}</strong>{!saved.settled && saved.dueDate < philippineToday() && <span role="status"> · Overdue; payment recording and Accounting delivery clearance remain available.</span>}</p>}
      {saved.blockers.length > 0 && <div role="status"><strong>Delivery-clearance requirements</strong><ul>{saved.blockers.map(b => <li key={b}>{b}</li>)}</ul><p>Record actual payments with evidence even while these requirements remain unresolved.</p></div>}
      {accounting && <div className="form-actions">
        <button className="button primary" type="button" disabled={operation.busy || saved.blockers.length > 0 || saved.cleared} onClick={() => open('clear')}>Clear delivery</button>
        <button className="button secondary" type="button" disabled={operation.busy} onClick={() => open('hold')}>Place delivery hold</button>
        {saved.net === "0.00" && <button className="button secondary" type="button" disabled={operation.busy || !canSettle} onClick={() => open(saved.noCashId ? 'reverseNoCash' : 'noCash')}>{saved.noCashId ? 'Reverse no-cash confirmation' : 'Confirm no-cash settlement'}</button>}
      </div>}
      {accounting && !canSettle && <p role="status">You previously coordinated this PO under Finance. Another Accounting colleague must perform settlement actions. You may prepare evidence and manage clearance.</p>}
    </section>
    <CoordinationPanel record={saved} role={view.role} actorId={view.actorId} />
    <section className="panel">
      <h2>Payments and proof</h2>
      <p>Each external transfer belongs to one PO. Accounting checks the supplier, amount, reference and actual date against the archived evidence before verification.</p>
      {accounting && saved.net !== "0.00" && <button className="button secondary" disabled={operation.busy || !!editor} type="button" onClick={() => setEditor({ id: crypto.randomUUID(), version: saved.version, body: { ...emptyPaymentBody(), date: philippineToday() } })}>Add payment draft</button>}
      {editor && <form className="payment-editor" onSubmit={async e => { e.preventDefault(); const result = await operation.run({ type: 'saveDraft', poId, expectedVersion: editor.version, draftId: editor.id, replacesId: editor.replacesId, body: editor.body, reason: '' }); if (result?.ok) setEditor(null); }}>
        <h3>Payment details</h3><p>Saving a draft does not change the verified balance. Proof files save separately.</p>
        {editor.version !== saved.version && <div role="status"><p>Saved payment work changed. Review the current balances, drafts and evidence below; your entries are retained.</p><button className="button secondary" type="button" onClick={() => setEditor({ ...editor, version: saved.version })}>I reviewed the latest payment work</button></div>}
        <div className="form-grid">
          {([['amount', 'Supplier payment amount (PHP)'], ['reference', 'Bank / check / voucher reference'], ['date', 'Actual payment date']] as const).map(([key, label]) => <Field key={key} label={label}><input value={editor.body[key]} type={key === 'date' ? 'date' : 'text'} inputMode={key === 'amount' ? 'decimal' : undefined} maxLength={2000} onChange={e => setEditor({ ...editor, body: { ...editor.body, [key]: e.target.value } })} /></Field>)}
          <Field label="Payment method"><select value={editor.body.method} onChange={e => setEditor({ ...editor, body: { ...editor.body, method: e.target.value } })}><option value="">Choose method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
          {editor.body.method === 'Other' && <Field label="Other method explanation"><textarea maxLength={2000} value={editor.body.other} onChange={e => setEditor({ ...editor, body: { ...editor.body, other: e.target.value } })} /></Field>}
          <Field label="Payment note"><textarea maxLength={2000} value={editor.body.note} onChange={e => setEditor({ ...editor, body: { ...editor.body, note: e.target.value } })} /></Field>
          <Field label="Explanation if this method/reference matches another PO" hint="Only needed if another PO has the same payment method and reference."><textarea maxLength={2000} value={editor.body.duplicateReason} onChange={e => setEditor({ ...editor, body: { ...editor.body, duplicateReason: e.target.value } })} /></Field>
        </div><div className="form-actions"><button className="button primary" disabled={operation.busy || editor.version !== saved.version}>Save payment draft</button><button className="button secondary" type="button" disabled={operation.busy} onClick={() => setEditor(null)}>Discard unsaved details</button></div>
      </form>}
      {!saved.drafts.length && <p className="empty">No payment drafts or verifications recorded.</p>}
      {saved.drafts.map(draft => {
        const verification = saved.verifications.find(v => v.id === draft.id);
        const status = verification?.reversal ? 'Reversed' : draft.state === 'verified' ? 'Verified' : draft.state === 'cancelled' ? 'Cancelled' : 'Draft';
        return <article className="payment-entry" key={draft.id}>
          <div className="payment-entry-heading"><h3>{draft.body.reference || 'Payment reference not recorded'}</h3><Badge value={status} /></div>
          <p><strong>{draft.body.amount ? formatPhp(draft.body.amount) : 'Amount not recorded'}</strong> · {draft.body.method || 'Method not recorded'} · {draft.body.date || 'Date not recorded'}</p>
          {draft.body.date && draft.body.date < new Date(saved.sentAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) && <p role="status">Payment date precedes the declared supplier sending date. Review both recorded facts.</p>}
          {draft.body.other && <p>{draft.body.other}</p>}{draft.body.note && <p>{draft.body.note}</p>}{draft.body.duplicateReason && <p>Matching-reference explanation: {draft.body.duplicateReason}</p>}
          <small>Prepared by {draft.creatorName} · {when(draft.createdAt)}</small>
          {verification && <p>Verified by {verification.actor.name} · {when(verification.at)}{verification.reversal && <> · Reversed by {verification.reversal.actor.name} · {when(verification.reversal.at)} · {verification.reversal.reason}</>}</p>}
          {draft.replacesId && <p>Linked replacement of a reversed payment; original details and evidence remain retained.</p>}
          <PaymentProofs draft={draft} editable={accounting && draft.state === 'draft'} canRetry={accounting} />
          {accounting && <div className="form-actions">
            {draft.state === 'draft' && <><button className="button secondary" type="button" disabled={operation.busy || !!editor} onClick={() => setEditor({ id: draft.id, body: draft.body, version: saved.version })}>Edit payment details</button><button className="button primary" type="button" disabled={operation.busy || !canSettle || draft.groups.length > 0 || !draft.files.length} onClick={() => open('verify', draft.id)}>Verify payment</button><button className="button secondary" type="button" disabled={operation.busy} onClick={() => open('cancelDraft', draft.id)}>Cancel payment draft</button></>}
            {verification && !verification.reversal && <button className="button secondary" type="button" disabled={operation.busy || !canSettle} onClick={() => open('reverse', draft.id)}>Reverse payment</button>}
            {verification?.reversal && !saved.drafts.some(d => d.replacesId === draft.id && d.state !== 'cancelled') && <button className="button secondary" type="button" disabled={operation.busy || !!editor} onClick={() => setEditor({ id: crypto.randomUUID(), version: saved.version, body: { ...draft.body }, replacesId: draft.id })}>Prepare linked replacement</button>}
          </div>}
        </article>;
      })}
    </section>
    <section className="panel"><h2>Clearance and no-cash history</h2><p>Invalidated clearance requires a fresh Accounting action. Completed deliveries and stock remain unchanged.</p><EventHistory events={[...saved.clearanceHistory, ...saved.noCashHistory].sort((a, b) => a.at.localeCompare(b.at))} /></section>
    {operation.message && <p role="status">{operation.message}</p>}
    {operation.uncertain && !decision && <button type="button" className="button secondary" disabled={operation.running} onClick={async () => { const result = await operation.recover(); if (result?.ok) setEditor(null); }}>Check saved outcome</button>}
    {decision && <RecordModal open title={actionLabels[decision.type] || 'Record payment action'} onClose={() => { if (!operation.busy) setDecision(null); }}>
      <form onSubmit={async e => { e.preventDefault(); const result = await operation.run({ type: decision.type, poId, expectedVersion: decision.version, draftId: decision.draftId, reason: decision.reason, ...(decision.type === 'verify' ? { evidenceReviewed: decision.reviewed } : {}) }); if (result?.ok) setDecision(null); }}>
        {balance}
        {operation.uncertain && <button type="button" className="button secondary" disabled={operation.running} onClick={async () => { const result = await operation.recover(); if (result?.ok) setDecision(null); }}>Check saved outcome</button>}
        {selected && <p>{selected.body.reference} · {formatPhp(selected.body.amount)} · {selected.body.method} · {selected.body.date}</p>}
        {decision.type === 'verify' && <><ul>{selected?.files.map(f => <li key={f.id}><a href={`/api/payment-files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul><label className="payment-check"><input type="checkbox" checked={decision.reviewed} onChange={e => setDecision({ ...decision, reviewed: e.target.checked })} /> I checked the archived proof, supplier, amount, reference and actual date; this transfer belongs to this PO only.</label></>}
        {decision.type === 'reverse' && <p>The original verification and evidence stay retained. Outstanding and gross spending are recalculated; Upfront delivery requires fresh clearance.</p>}
        {decision.type === 'noCash' && <p>The approved supplier net is zero. Confirm no supplier payment is due; full gross becomes budget spending. This records no tax remittance.</p>}
        {decision.type === 'clear' && <p>This clears future delivery under current prerequisites. Logistics dispatch remains a separate action.</p>}
        <Field label={decision.type === 'verify' || decision.type === 'clear' ? 'Optional note' : 'Reason (at least five characters)'}><textarea maxLength={2000} required={!['verify', 'clear'].includes(decision.type)} minLength={['verify', 'clear'].includes(decision.type) ? undefined : 5} value={decision.reason} onChange={e => setDecision({ ...decision, reason: e.target.value })} /></Field>
        {decision.version !== saved.version && <div role="status"><p>The record changed. Review the latest saved data before confirming; your reason is retained.</p><button className="button secondary" type="button" onClick={() => setDecision({ ...decision, version: saved.version, reviewed: false })}>I reviewed the latest payment work</button></div>}
        {operation.message && <p role="status">{operation.message}</p>}<div className="form-actions"><button className="button primary" disabled={operation.busy || decision.version !== saved.version || decision.type === 'verify' && !decision.reviewed}>{operation.busy ? 'Recording…' : actionLabels[decision.type]}</button><button type="button" className="button secondary" disabled={operation.busy} onClick={() => setDecision(null)}>Cancel</button></div>
      </form>
    </RecordModal>}
  </div>;
}

function CoordinationPanel({ record: saved, role, actorId }: { record: PaymentRecord; role: string; actorId: string }) {
  const operation = usePaymentOperation();
  const [edit, setEdit] = useState<{ plan: PaymentPlan; version: string } | null>(null);
  const current = saved.coordination?.plan || emptyPlan(), canEdit = role === 'Finance' && !saved.settled && !saved.settlers.includes(actorId);
  const needsReview = saved.coordination && saved.coordination.ledgerVersion !== saved.ledgerVersion;
  return <section className="panel"><h2>Finance coordination</h2><p>Coordination follows externally executed payments. It does not record payment or clear delivery.</p>
    <p><strong>{saved.settled ? 'Settled' : current.status}</strong> · {current.priority} priority{current.plannedDate && <> · Planned {current.plannedDate}</>}</p>
    {current.note && <p>{current.note}</p>}{saved.coordination && <small>{saved.coordination.actor.name} · {when(saved.coordination.at)}</small>}
    {!saved.settled && needsReview && <p role="status">The balance changed. Finance must review this retained plan.</p>}
    {!saved.settled && current.plannedDate && current.plannedDate < philippineToday() && <p role="status">The planned date has passed. Review payment follow-up.</p>}
    {role === 'Finance' && saved.settlers.includes(actorId) && <p role="status">You previously performed settlement on this PO. A different Finance colleague must coordinate it.</p>}
    {canEdit && !edit && <button className="button secondary" type="button" onClick={() => setEdit({ plan: current, version: saved.version })}>Review coordination plan</button>}
    {canEdit && edit && <form onSubmit={async e => { e.preventDefault(); const result = await operation.run({ type: 'coordinate', poId: saved.poId, expectedVersion: edit.version, expectedLedger: saved.ledgerVersion, reason: '', plan: edit.plan }); if (result?.ok) setEdit(null); }}>
      {edit.version !== saved.version && <div role="status"><p>The record changed. Review the latest balance and plan; your entries are retained.</p><button className="button secondary" type="button" onClick={() => setEdit({ ...edit, version: saved.version })}>I reviewed the latest payment work</button></div>}
      <div className="form-grid"><Field label="Priority"><select value={edit.plan.priority} onChange={e => setEdit({ ...edit, plan: { ...edit.plan, priority: e.target.value } })}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></Field><Field label="Coordination status"><select value={edit.plan.status} onChange={e => setEdit({ ...edit, plan: { ...edit.plan, status: e.target.value } })}>{COORDINATION_STATUSES.map(p => <option key={p}>{p}</option>)}</select></Field><Field label="Planned payment date" hint="Does not change the agreed Credit due date."><input type="date" value={edit.plan.plannedDate} required={edit.plan.status === 'Scheduled'} onChange={e => setEdit({ ...edit, plan: { ...edit.plan, plannedDate: e.target.value } })} /></Field><Field label="Coordination notes / delay reason"><textarea maxLength={2000} required={edit.plan.status === 'Delayed'} minLength={edit.plan.status === 'Delayed' ? 5 : undefined} value={edit.plan.note} onChange={e => setEdit({ ...edit, plan: { ...edit.plan, note: e.target.value } })} /></Field></div>
      <div className="form-actions"><button className="button primary" disabled={operation.busy || edit.version !== saved.version}>Save reviewed plan</button><button type="button" className="button secondary" disabled={operation.busy} onClick={() => setEdit(null)}>Discard unsaved plan</button></div>
    </form>}{operation.message && <p role="status">{operation.message}</p>}
    {operation.uncertain && <button type="button" className="button secondary" disabled={operation.running} onClick={async () => { const result = await operation.recover(); if (result?.ok) setEdit(null); }}>Check saved outcome</button>}
    {saved.coordinationHistory.length > 0 && <details><summary>Coordination history</summary><ol className="payment-history">{saved.coordinationHistory.map(e => <li key={e.id}><strong>{e.plan.priority} · {e.plan.status}</strong><p>{e.plan.plannedDate || 'No planned date'} · {e.plan.note || 'No note'}</p><small>{e.actor.name} · {when(e.at)}</small></li>)}</ol></details>}
  </section>;
}

export function PaymentsDirectory({ initial }: { initial: PaymentsView }) {
  const live = useFoundationRealtime(), [search, setSearch] = useState(''), [tab, setTab] = useState('active');
  const view = live.view?.kind === 'payments' ? live.view.data : initial;
  const rank: Record<string, number> = { Urgent: 0, High: 1, Normal: 2 };
  const records = view.records.filter(r => (tab === 'settled' ? r.settled : !r.settled) && `${r.ref} ${r.vendor}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const priority = (rank[a.coordination?.plan.priority || 'Normal'] ?? 2) - (rank[b.coordination?.plan.priority || 'Normal'] ?? 2);
    const dateA = a.dueDate || a.coordination?.plan.plannedDate || '9999', dateB = b.dueDate || b.coordination?.plan.plannedDate || '9999';
    return priority || dateA.localeCompare(dateB) || a.ref.localeCompare(b.ref);
  });
  return <><PageHeader title="Finance" description="Coordinate issued purchase orders, follow verified balances and retain payment plans." /><div className="toolbar"><Field label="Search issued POs"><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></Field><Field label="Payment view"><select value={tab} onChange={e => setTab(e.target.value)}><option value="active">Outstanding / settlement checks</option><option value="settled">Settled</option></select></Field></div>
    <div className="table-frame"><table><thead><tr><th>PO / supplier</th><th>Coordination</th><th>Dates</th><th className="numeric">Outstanding</th><th>Delivery</th></tr></thead><tbody>{records.map(r => <tr key={r.poId}><td><Link className="table-primary" href={`/finance/${r.poId}`}>{r.ref}</Link><small>{r.vendor}</small></td><td>{r.coordination?.plan.priority || 'Normal'} · {r.settled ? 'Settled' : r.coordination?.plan.status || 'Pending'}{r.coordination && r.coordination.ledgerVersion !== r.ledgerVersion && !r.settled && <small>Plan needs review</small>}</td><td>{r.dueDate ? `Credit due ${r.dueDate}` : 'Upfront'}{r.dueDate && r.dueDate < philippineToday() && !r.settled && <small>Overdue</small>}{r.coordination?.plan.plannedDate && <small>Planned {r.coordination.plan.plannedDate}</small>}</td><td className="numeric">{formatPhp(r.outstanding)}{moneyCents(r.net) === BigInt(0) && !r.settled && <small>No-cash check pending</small>}</td><td>{r.cleared ? 'Cleared' : 'Not cleared'}</td></tr>)}</tbody></table>{!records.length && <p className="empty">No issued POs match this view.</p>}</div></>;
}
