"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useToasts } from "@/src/app-state/ToastProvider";
import { Field, InlineError, PageHeader, RecordHeader, Timeline } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { AssignmentNotice, MissingRecord } from "@/src/components/ui/States";
import { actorText, auditTime } from "@/src/domain/audit";
import { normalizedQuantity } from "@/src/domain/delivery-flow";
import { receivedMaterialScopes } from "@/src/domain/inventory-scopes";
import { inventoryFor, siteName } from "@/src/domain/selectors";
import { sourceStockAvailable, transferReservedFor } from "@/src/domain/stock-transfers";
import { usageEntryErrors, type RecordUsageEntry } from "@/src/domain/usage-entries";
import type { DemoSnapshot } from "@/src/domain/types";
import { browserUsageStorage, discardUsageDraft, emptyUsageDraft, persistUsageDraft, restoreUsageDraft, usageDraftKey, type UsageDraft, type UsageDraftLine } from "./usage-draft";
import styles from "./Usage.module.css";

export function UsageEntries({ state }: { state: DemoSnapshot }) {
  const { access } = useDemo();
  const [search, setSearch] = useState("");
  const rows = (state.usageEntries || []).filter(entry => access.canReadProject(entry.siteId) && (state.siteFilter === "all" || entry.siteId === state.siteFilter) && `${siteName(state, entry.siteId)} ${entry.reason} ${entry.actorIdentity.name}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return <Register rows={rows} unit="usage entries" resetKey={search + state.siteFilter} filters={<input aria-label="Search usage entries" placeholder="Search project, explanation or person" value={search} onChange={e => setSearch(e.target.value)}/>} headers={<><th>Recorded</th><th>Project</th><th>Materials</th><th>Explanation</th><th>Recorded by</th></>} empty="No usage entries match this view. Earlier individual movements remain in material history." renderRow={entry => <tr key={entry.id}><td><Link className="text-link" href={`/inventory/usage/${entry.id}`}>{auditTime(entry.at)}</Link></td><td>{siteName(state, entry.siteId)}</td><td>{entry.movementIds.length}</td><td>{entry.reason}</td><td>{actorText(entry.actor, entry.actorIdentity)}</td></tr>}/>;
}

export function RecordUsage({ initialSiteId }: { initialSiteId?: string }) {
  const { snapshot: state, session, access } = useDemo();
  const [selection, setSelection] = useState(() => initialSiteId || (state?.siteFilter !== "all" ? state?.siteFilter : "") || "");
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const projects = state.sites.filter(site => access.projectIds.includes(site.id));
  const siteId = projects.some(site => site.id === selection) ? selection : "";
  if (session.role !== "Site Personnel") return <><PageHeader title="Record usage"/><p className="panel">Sign in as Site Personnel to record material usage.</p></>;
  return <><Link className="back-link" href="/inventory">← Site inventory</Link><PageHeader eyebrow="MATERIAL CONSUMPTION" title="Record usage" description="Record materials used at one project. Stock is deducted together when you confirm."/><AssignmentNotice/><section className="panel"><Field label="Project" hint="Each project keeps its own private draft."><select disabled={busy} aria-label="Usage project" value={siteId} onChange={e => setSelection(e.target.value)}><option value="">Choose an assigned project</option>{projects.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field></section>{projects.some(site => site.id === siteId) ? <UsageEditor key={usageDraftKey(session.userId || session.email || "", state.showcase?.installationId || "workspace", siteId)} state={state} siteId={siteId} onBusyChange={setBusy} storageKey={usageDraftKey(session.userId || session.email || "", state.showcase?.installationId || "workspace", siteId)}/> : <p className="helper-note">Choose a project to see its stock materials.</p>}</>;
}

function UsageEditor({ state, siteId, storageKey, onBusyChange }: { state: DemoSnapshot; siteId: string; storageKey: string; onBusyChange: (busy: boolean) => void }) {
  const { run, session } = useDemo();
  const { notify } = useToasts();
  const router = useRouter();
  const [restored] = useState(() => restoreUsageDraft(browserUsageStorage, storageKey));
  const [draft, setDraft] = useState(restored.draft);
  const [blocked, setBlocked] = useState(restored.blocked);
  const [storageError, setStorageError] = useState(restored.error);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(""), [unit, setUnit] = useState(""), [scope, setScope] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false), [busy, setBusy] = useState(false), [discardOpen, setDiscardOpen] = useState(false);
  const working = useRef(false), root = useRef<HTMLFormElement>(null);
  const materials = inventoryFor(state, siteId).sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  const units = [...new Set(materials.map(m => m.unit))].sort();
  const provenance = receivedMaterialScopes(state);
  const scopes = state.scopes.filter(s => s.siteId === siteId);
  const rows = materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase()) && (!unit || m.unit === unit) && (!scope || provenance.get(`${siteId}/${m.id}`)?.has(scope)));
  const selected = draft.lines.filter(line => line.quantity.trim() !== "" && Number(line.quantity) !== 0);
  const missing = draft.lines.filter(line => !materials.some(m => m.id === line.materialId));
  const savedEntry = state.usageEntries?.find(entry => entry.id === draft.entryId);
  const locked = busy || blocked || !!savedEntry;
  const command: RecordUsageEntry = { type: "recordUsageEntry", entryId: draft.entryId, siteId, reason: draft.reason, lines: selected.map(line => ({ materialId: line.materialId, quantity: Number(line.quantity), reason: line.reason })) };

  function save(next: UsageDraft) {
    setDraft(next); setError(""); setErrors({}); setReviewOpen(false);
    setStorageError(persistUsageDraft(browserUsageStorage, storageKey, next));
  }
  function edit(item: typeof materials[number], patch: Partial<UsageDraftLine>) {
    const prior = draft.lines.find(line => line.materialId === item.id);
    const next = { materialId: item.id, name: item.name, unit: item.unit, quantity: "", reason: "", ...prior, ...patch };
    save({ ...draft, lines: [...draft.lines.filter(line => line.materialId !== item.id), next] });
  }
  function reveal(id: string) {
    const item = materials.find(m => m.id === id);
    setUnit(item?.unit || ""); setScope("");
    setSearch(item?.name || "");
    requestAnimationFrame(() => requestAnimationFrame(() => { const input = document.getElementById(`usage-quantity-${id}`) || document.getElementById(`usage-remove-${id}`); input?.scrollIntoView({ block: "center" }); input?.focus(); }));
  }
  function validate() {
    const invalid = usageEntryErrors(state, command);
    for (const line of missing) invalid[line.materialId] = "This material is no longer available. Remove it from this draft.";
    setErrors(invalid);
    if (draft.reason.trim().length < 5) { setError("Explain the usage in at least five characters."); root.current?.querySelector<HTMLTextAreaElement>('[name="reason"]')?.focus(); return false; }
    if (Object.keys(invalid).length) { setError("Review the highlighted materials. No usage has been recorded."); reveal(Object.keys(invalid)[0]); return false; }
    if (!selected.length) { setError("Enter a quantity used for at least one material."); return false; }
    setError(""); return true;
  }
  function review(event: FormEvent) { event.preventDefault(); if (!locked && validate()) setReviewOpen(true); }
  async function submit() {
    if (working.current || blocked || !savedEntry && !validate()) return;
    working.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await run(command);
      if (!result.ok) { setError(result.message); setErrors(result.rowErrors || {}); setReviewOpen(false); if (result.rowErrors) reveal(Object.keys(result.rowErrors)[0]); return; }
      let clearError = "";
      if (result.persisted) clearError = discardUsageDraft(browserUsageStorage, storageKey);
      notify({ tone: result.persisted && !clearError ? "success" : "warning", title: result.message, detail: clearError || (!result.persisted ? "Saved in memory only. Your draft is retained; retry saving before closing the browser." : `${selected.length} materials · ${siteName(state, siteId)}`) });
      router.push(`/inventory/usage/${result.recordId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Usage could not be recorded. Your draft is retained."); setReviewOpen(false); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  }
  function discard() {
    const message = discardUsageDraft(browserUsageStorage, storageKey);
    setStorageError(message); setDiscardOpen(false);
    if (!message) { setDraft(emptyUsageDraft()); setBlocked(false); setErrors({}); setError(""); }
  }
  const remaining = (onHand: number, quantity?: string) => normalizedQuantity(onHand - (Number.isFinite(Number(quantity)) ? Number(quantity) : 0));
  return <form ref={root} onSubmit={review} noValidate className={styles.editor} aria-busy={busy}>
    <InlineError message={storageError}/>
    {savedEntry && <section className="panel" role="status"><h2>This entry has already been recorded</h2><p>Your draft is retained because saving or clearing browser storage did not finish. Retrying saves this same entry once.</p><div className={styles.actions}><Link className="button secondary" href={`/inventory/usage/${savedEntry.id}`}>Open saved entry</Link><button className="button primary" type="button" disabled={busy} onClick={() => void submit()}>Retry saving entry</button></div></section>}
    <fieldset disabled={locked} className={styles.fields}>
      <section className="panel"><Field label="Usage explanation" hint="Required for the whole entry. You can explain an individual material separately below."><textarea name="reason" aria-label="Usage explanation" value={draft.reason} minLength={5} required onChange={e => save({ ...draft, reason: e.target.value })}/></Field></section>
      <p className="helper-note">Blank or zero quantities are unused. Available stock excludes reservations. Scope filters show receipt provenance; usage reduces the full project balance.</p>
      <Register embedded rows={rows} unit="materials" resetKey={JSON.stringify([search, unit, scope])} tableClassName={styles.usageTable} filters={<><input aria-label="Search usage materials" placeholder="Search material" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Usage material unit" value={unit} onChange={e => setUnit(e.target.value)}><option value="">All units</option>{units.map(u => <option key={u}>{u}</option>)}</select><select aria-label="Usage materials received for scope" value={scope} onChange={e => setScope(e.target.value)}><option value="">All scopes</option>{scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></>} headers={<><th>Material</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Quantity used</th><th>After usage</th><th>Explanation</th></>} empty="No stock materials match this view." renderRow={item => {
        const line = draft.lines.find(l => l.materialId === item.id);
        return <tr key={item.id}><td data-label="Material"><strong>{item.name}</strong><small>{item.unit}</small></td><td data-label="On hand">{item.onHand}</td><td data-label="Reserved">{transferReservedFor(state, siteId, item.id)}</td><td data-label="Available">{sourceStockAvailable(state, siteId, item.name, item.unit)}</td><td data-label="Quantity used"><input id={`usage-quantity-${item.id}`} aria-label={`Quantity used: ${item.name} (${item.unit})`} aria-invalid={!!errors[item.id]} aria-describedby={errors[item.id] ? `usage-error-${item.id}` : undefined} type="number" min="0" step="any" value={line?.quantity || ""} onChange={e => edit(item, { quantity: e.target.value })}/>{errors[item.id] && <small id={`usage-error-${item.id}`} className="field-error">{errors[item.id]}</small>}</td><td data-label="After usage">{remaining(item.onHand, line?.quantity)}</td><td data-label="Explanation"><details open={!!errors[item.id] && !!line?.reason}><summary>Material explanation</summary><textarea aria-label={`Explanation: ${item.name} (${item.unit})`} placeholder="Use the shared explanation" value={line?.reason || ""} onChange={e => edit(item, { reason: e.target.value })}/></details></td></tr>;
      }}/>
      {missing.length > 0 && <section className="panel"><h2>Unavailable draft materials</h2>{missing.map(line => <div key={line.materialId}><p>{line.name} · {line.quantity || "No quantity"} {line.unit}</p><button type="button" id={`usage-remove-${line.materialId}`} className="button secondary" onClick={() => save({ ...draft, lines: draft.lines.filter(l => l.materialId !== line.materialId) })}>Remove {line.name}</button></div>)}</section>}
    </fieldset>
    <InlineError message={error}/>
    {Object.keys(errors).length > 0 && <ul className={styles.errorList}>{Object.entries(errors).map(([id, message]) => <li key={id}><button type="button" className="text-link" onClick={() => reveal(id)}>{draft.lines.find(l => l.materialId === id)?.name || id}: {message}</button></li>)}</ul>}
    <section className={`panel ${styles.summary}`} aria-label="Usage draft summary"><p role="status"><strong>{selected.length} material{selected.length === 1 ? "" : "s"}</strong> entered across all pages and filters. Drafts do not reserve stock.</p><div className={styles.actions}><button className="button secondary" type="button" disabled={busy} onClick={() => setDiscardOpen(true)}>Discard draft</button><button className="button primary" type="submit" disabled={locked || !materials.length}>Review usage</button></div></section>
    <RecordModal open={reviewOpen} title="Confirm material usage" onClose={() => { if (!working.current) setReviewOpen(false); }}><p><strong>{siteName(state, siteId)}</strong> · {session.email}</p><p>{draft.reason}</p><p>All {selected.length} entered materials are included. Confirming immediately deducts their quantities together.</p><div className={styles.reviewRows}>{selected.map(line => { const item = materials.find(m => m.id === line.materialId); return <div key={line.materialId}><strong>{item?.name || line.name}</strong><span>{line.quantity} {item?.unit || line.unit} used · {remaining(item?.onHand || 0, line.quantity)} remaining</span><p>{line.reason.trim() || draft.reason.trim()}</p></div>; })}</div><div className={styles.actions}><button className="button secondary" type="button" disabled={busy} onClick={() => setReviewOpen(false)}>Keep editing</button><button className="button primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Recording…" : "Record usage"}</button></div></RecordModal>
    <RecordModal open={discardOpen} title="Discard this project’s usage draft?" onClose={() => setDiscardOpen(false)}><p>Unsubmitted quantities and explanations will be removed. Recorded usage entries stay in history.</p><div className={styles.actions}><button className="button secondary" type="button" onClick={() => setDiscardOpen(false)}>Keep draft</button><button className="button danger" type="button" onClick={discard}>Discard draft permanently</button></div></RecordModal>
  </form>;
}

export function UsageEntryDetail({ entryId }: { entryId: string }) {
  const { snapshot: state, access } = useDemo();
  if (!state) return null;
  const entry = state.usageEntries?.find(value => value.id === entryId);
  if (!entry || !access.canReadProject(entry.siteId)) return <MissingRecord name="Usage entry" listHref="/inventory"/>;
  const rows = entry.movementIds.map(id => state.movements.find(m => m.id === id)).filter(m => m !== undefined);
  return <><RecordHeader backHref="/inventory?view=usage" backLabel="Usage entries" eyebrow={siteName(state, entry.siteId)} title="Usage entry" badges={<span>{rows.length} materials · Recorded</span>}/><section className="panel"><div className="data-rows"><div><span>Project</span><strong>{siteName(state, entry.siteId)}</strong></div><div><span>Recorded by</span><strong>{actorText(entry.actor, entry.actorIdentity)}</strong></div><div><span>Recorded at</span><strong>{auditTime(entry.at)}</strong></div><div><span>Explanation</span><strong>{entry.reason}</strong></div></div><p className="helper-note">This entry is read-only. Stock corrections use the existing adjustment workflow.</p></section><Register embedded rows={rows} unit="materials" headers={<><th>Material</th><th>Quantity used</th><th>Explanation</th></>} renderRow={m => <tr key={m.id}><td>{m.itemName}<small>{m.unit}</small></td><td>{-m.quantity} {m.unit}</td><td>{m.reason}</td></tr>}/><Timeline state={state} ids={[entry.id]}/></>;
}
