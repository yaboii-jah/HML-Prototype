"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { supplierCommandAction } from "@/app/(workspace)/suppliers/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { SUPPLIER_FIELDS, type Supplier, type SupplierHistory, type SupplierInput, type SupplierProfile, type SupplierResult, type SupplierView } from "@/src/domain/suppliers/suppliers";

const subscribe = () => () => {};
const fields = Object.keys(SUPPLIER_FIELDS) as (keyof SupplierProfile)[];
const emptyProfile: SupplierProfile = { name: "", address: "", tin: "", contactName: "", email: "", phone: "", accreditationNote: "" };

function SupplierValues({ supplier }: { supplier: Supplier }) {
  return <dl className="supplier-values">
    {fields.map(key => <div key={key}><dt>{SUPPLIER_FIELDS[key].label}</dt><dd>{supplier[key] || "Not recorded"}</dd></div>)}
    <div><dt>Status</dt><dd>{supplier.active ? "Active" : "Inactive"}</dd></div>
  </dl>;
}

function SupplierEditor({ source, latest, statusOnly, onClose, onSaved }: {
  source: Supplier | null; latest?: Supplier; statusOnly: boolean;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const { refresh } = useFoundationRealtime();
  const [profile, setProfile] = useState<SupplierProfile>(source ? { ...source } : emptyProfile);
  const [expected, setExpected] = useState(source?.version ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SupplierResult | null>(null);
  const running = useRef(false);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const stale = !!source && (!latest || latest.version !== expected);
  const blocked = stale || !!result?.conflict;
  const dirty = statusOnly ? !!reason : fields.some(key => profile[key] !== (source?.[key] ?? ""));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => {
    if (!running.current && (!dirty || window.confirm("Discard unsaved supplier changes?"))) onClose();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (running.current || blocked) return;
    const input: SupplierInput = source
      ? statusOnly
        ? { type: "setSupplierStatus", supplierId: source.id, expectedVersion: expected, active: !source.active, reason }
        : { type: "saveSupplier", supplierId: source.id, expectedVersion: expected, profile }
      : { type: "createSupplier", profile };
    const key = JSON.stringify(input);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await supplierCommandAction({ ...input, requestId: retry.current.id });
      setResult(response);
      if (response.ok && response.supplierId) onSaved(response.supplierId);
    } catch {
      setResult({ ok: false, message: "The response was interrupted. Retry this request to check its saved outcome." });
    } finally {
      running.current = false;
      setBusy(false);
      refresh();
    }
  };
  return <RecordModal open title={statusOnly ? `${source?.active ? "Deactivate" : "Reactivate"} supplier` : source ? "Edit supplier" : "Add supplier"} onClose={close}>
    <form className="form-stack project-editor" onSubmit={save}>
      <fieldset disabled={busy}>
        {statusOnly ? <>
          <strong>{source?.name}</strong>
          <p>{source?.active ? "This supplier will be unavailable for new selections. Existing linked work may proceed." : "This supplier will be available for new selections."}</p>
          <Field label="Reason" hint="At least five characters; retained in change history."><textarea name="reason" required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </> : <div className="form-grid">
          {fields.map(key => <Field key={key} label={SUPPLIER_FIELDS[key].label} hint={key === "accreditationNote" ? "Informational only; does not establish purchasing eligibility." : undefined}>
            {key === "address" || key === "accreditationNote"
              ? <textarea name={key} maxLength={SUPPLIER_FIELDS[key].limit} value={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.value })} />
              : <input name={key} type={key === "email" ? "email" : "text"} required={key === "name"} maxLength={SUPPLIER_FIELDS[key].limit} value={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.value })} />}
          </Field>)}
        </div>}
      </fieldset>
      <InlineError message={result?.ok ? "" : result?.message} />
      {result?.duplicateId && <Link href={`/suppliers/${result.duplicateId}`}>Open existing supplier</Link>}
      {blocked && <section role="status">
        <h3>Review latest saved supplier</h3>
        <p>Your input is preserved. Review all saved details before replacing them.</p>
        {latest ? <>
          <SupplierValues supplier={latest} />
          {statusOnly && latest.active !== source?.active
            ? <p>The status already changed. Close and reopen this action to review its new direction.</p>
            : <button className="button secondary" type="button" onClick={() => { setExpected(latest.version); setResult(null); retry.current = null; }}>I reviewed the latest supplier; keep my draft</button>}
        </> : <p>This supplier is unavailable. Your draft cannot be saved.</p>}
      </section>}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy || blocked}>{busy ? "Saving…" : statusOnly ? `${source?.active ? "Deactivate" : "Reactivate"} supplier` : "Save supplier"}</button>
      </div>
    </form>
  </RecordModal>;
}

function SupplierChanges({ history }: { history: SupplierHistory[] }) {
  return <section className="panel project-history">
    <h2>Recent supplier changes</h2>
    <p className="muted">Latest 30 changes. Full audit history is retained.</p>
    {history.length ? <ol>{history.map(event => <li key={event.id}>
      <strong>{event.supplierName}</strong> · {event.action.replaceAll(".", " ")}
      <small>{event.actorName} / {event.actorRole} · {new Date(event.at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</small>
      {event.reason && <p>{event.reason}</p>}
      <details><summary>Change details</summary><ul>
        {fields.filter(key => event.changes.before?.[key] !== event.changes.after[key]).map(key => <li key={key}>{SUPPLIER_FIELDS[key].label}: {event.changes.before?.[key] || "Not recorded"} → {event.changes.after[key] || "Not recorded"}</li>)}
        {event.changes.before?.active !== event.changes.after.active && <li>Status: {event.changes.before ? event.changes.before.active ? "Active" : "Inactive" : "Not recorded"} → {event.changes.after.active ? "Active" : "Inactive"}</li>}
      </ul></details>
    </li>)}</ol> : <p>No changes recorded.</p>}
  </section>;
}

export function SupplierWorkspace({ initial, supplierId }: { initial: SupplierView; supplierId?: string }) {
  const { view } = useFoundationRealtime();
  const data = view?.kind === "suppliers" ? view.data : initial;
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active");
  const [editor, setEditor] = useState<{ source: Supplier | null; statusOnly: boolean } | null>(null);
  const supplier = supplierId ? data.suppliers.find(s => s.id === supplierId) : undefined;
  const editable = data.role === "Procurement";
  const rows = data.suppliers.filter(s => (status === "All" || s.active === (status === "Active"))
    && fields.some(key => s[key].toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {supplierId && <Link className="back-link" href="/suppliers">← Suppliers</Link>}
    <PageHeader eyebrow="Workspace" title={supplierId ? supplier?.name ?? "Supplier unavailable" : "Suppliers"}
      description={supplierId ? "Company-wide supplier profile and change history." : "Shared business contacts maintained by Procurement."}
      actions={editable && (supplierId ? supplier && <>
        <button className="button secondary" disabled={!hydrated} onClick={() => setEditor({ source: supplier, statusOnly: false })}>Edit supplier</button>
        <button className="button secondary" disabled={!hydrated} onClick={() => setEditor({ source: supplier, statusOnly: true })}>{supplier.active ? "Deactivate" : "Reactivate"} supplier</button>
      </> : <button className="button primary" disabled={!hydrated} onClick={() => setEditor({ source: null, statusOnly: false })}>Add supplier</button>)} />
    {supplierId ? supplier && <section className="panel"><SupplierValues supplier={supplier} /></section> : <Register rows={rows} unit="suppliers" resetKey={`${search}:${status}`}
      headers={<><th>Supplier</th><th>Address</th><th>Contact</th><th>Status</th><th>Action</th></>}
      filters={<><Field label="Search suppliers"><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></Field><Field label="Status"><select value={status} onChange={e => setStatus(e.target.value)}>{["Active", "Inactive", "All"].map(s => <option key={s}>{s}</option>)}</select></Field></>}
      renderRow={s => <tr key={s.id}><td><Link href={`/suppliers/${s.id}`}>{s.name}</Link></td><td>{s.address || "Not recorded"}</td><td>{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "Not recorded"}</td><td>{s.active ? "Active" : "Inactive"}</td><td>{editable ? <button className="text-link" disabled={!hydrated} onClick={() => setEditor({ source: s, statusOnly: false })}>Edit supplier</button> : <Link href={`/suppliers/${s.id}`}>View supplier</Link>}</td></tr>} />}
    <SupplierChanges history={data.history} />
    {editable && editor && <SupplierEditor key={`${editor.source?.id ?? "new"}:${editor.statusOnly}`} {...editor}
      latest={editor.source ? data.suppliers.find(s => s.id === editor.source?.id) : undefined}
      onClose={() => setEditor(null)} onSaved={id => { setEditor(null); if (!supplierId) router.push(`/suppliers/${id}`); else router.refresh(); }} />}
  </>;
}
