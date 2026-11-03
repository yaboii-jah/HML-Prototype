"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveMrfDraftAction } from "@/app/(workspace)/requests/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Register } from "@/src/components/ui/Register";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { detailFields, emptyMrfDraft, materialFields, type DraftCommand, type DraftMaterial, type MrfDraft, type RequestView, type SavedMrf } from "@/src/domain/requests/drafts";

const labels = { sourceRef: "Source MRF number", requestDate: "Request date", requestedBy: "Requested by", approvedBy: "Approved by", purchaser: "Purchaser / Procurement Officer", financeOfficer: "Finance Officer", specialInstructions: "Special instructions", name: "Material name", unit: "Unit", purpose: "Purpose", location: "Delivery location", remarks: "Remarks", neededDate: "Date needed", quantity: "Quantity", scopeId: "Scope of work" };
const availability = "Submission, approvals, supporting files and AI will become available in later units.";
const shown = (value: string | null | undefined) => value || "Not recorded";

export function SharedRequests({ initial, mode, id, today }: { initial: RequestView; mode: "register" | "new" | "detail" | "edit"; id?: string; today: string }) {
  const { view } = useFoundationRealtime();
  const data = view?.kind === "requests" ? view.data : initial;
  const saved = data.requests.find(request => request.id === id);
  if (mode === "register") return <RequestRegister data={data} />;
  if (mode !== "new" && !saved) return <><PageHeader title="Material request unavailable" description="This record does not exist or is outside your current project access." /><Link href="/requests">Return to material requests</Link></>;
  if (mode === "detail" && saved) return <RequestDetail saved={saved} data={data} />;
  if (data.role !== "Site Personnel") return <><PageHeader title="Read-only access" description="Only currently assigned Site Personnel can create or edit MRF drafts." /><Link href={saved ? `/requests/${saved.id}` : "/requests"}>Return to material requests</Link></>;
  return <DraftEditor key={id ?? "new"} latest={saved} data={data} today={today} />;
}

function RequestRegister({ data }: { data: RequestView }) {
  const [search, setSearch] = useState(""), [project, setProject] = useState(""), [needed, setNeeded] = useState(""), [sort, setSort] = useState("recent");
  const earliest = (request: SavedMrf) => request.draft.items.map(item => item.neededDate).filter(Boolean).sort()[0] ?? "9999-12-31";
  const rows = data.requests.filter(request => (!project || request.projectId === project)
    && (!needed || request.draft.items.some(item => item.neededDate && item.neededDate <= needed))
    && `${request.ref} ${request.draft.items.map(item => item.name).join(" ")}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort === "needed" ? earliest(a).localeCompare(earliest(b)) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  return <>
    <PageHeader title="Material requests" description="Shared project drafts" actions={data.role === "Site Personnel" && <Link className="button primary" href="/requests/new">New MRF</Link>} />
    <Register rows={rows} unit="requests" resetKey={`${search}|${project}|${needed}|${sort}`} empty="No saved drafts match this view. Assigned Site Personnel can create a new MRF."
      filters={<><Field label="Search"><input type="search" value={search} placeholder="MRF number or material" onChange={event => setSearch(event.target.value)} /></Field>
        <Field label="Project"><select value={project} onChange={event => setProject(event.target.value)}><option value="">All permitted projects</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
        <Field label="Status"><select aria-label="Status" value="draft" onChange={() => {}}><option value="draft">Draft</option></select></Field>
        <Field label="Needed by"><input type="date" value={needed} onChange={event => setNeeded(event.target.value)} /></Field>
        <Field label="Sort"><select value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="needed">Earliest needed</option></select></Field></>}
      headers={<><th scope="col">MRF</th><th scope="col">Project</th><th scope="col">Materials</th><th scope="col">Status</th><th scope="col">Updated</th></>}
      renderRow={request => <tr key={request.id}><td><Link href={`/requests/${request.id}`}>{request.ref}</Link></td><td>{data.projects.find(project => project.id === request.projectId)?.name}</td><td>{request.draft.items.length ? request.draft.items.map(item => shown(item.name)).join(", ") : "No materials yet"}</td><td>Draft</td><td><time dateTime={request.updatedAt}>{new Date(request.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time></td></tr>} />
  </>;
}

function DraftSummary({ draft, projectId, data }: { draft: MrfDraft; projectId: string; data: RequestView }) {
  const project = data.projects.find(project => project.id === projectId);
  return <><dl className="detail-grid"><div><dt>Project</dt><dd>{shown(project?.name)}</dd></div><div><dt>Scope of work</dt><dd>{draft.scopeId ? shown(project?.scopes.find(scope => scope.id === draft.scopeId)?.name) : "Unassigned"}</dd></div>
    <div><dt>Request date</dt><dd>{shown(draft.requestDate)}</dd></div>{detailFields.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{shown(draft[key])}</dd></div>)}</dl>
    <MaterialList items={draft.items} />
  </>;
}
function RequestDetail({ saved, data }: { saved: SavedMrf; data: RequestView }) {
  return <><Link className="back-link" href="/requests">Back to material requests</Link><PageHeader title={saved.ref} description="Draft" actions={data.role === "Site Personnel" && <Link className="button primary" href={`/requests/${saved.id}/edit`}>Edit draft</Link>} />
    <section className="panel"><h2>Request details</h2><DraftSummary draft={saved.draft} projectId={saved.projectId} data={data} /></section>
    <section className="panel"><h2>Recorded responsibility</h2><p>Created by {saved.creatorName} · <time dateTime={saved.createdAt}>{new Date(saved.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time></p><p>Latest editor: {saved.updaterName} · <time dateTime={saved.updatedAt}>{new Date(saved.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time></p><p className="muted">Printed signatory names do not establish approval or submission.</p></section>
    <p className="muted">{availability}</p></>;
}

function MaterialList({ items, edit, remove, move }: { items: DraftMaterial[]; edit?: (id: string) => void; remove?: (id: string) => void; move?: (id: string, offset: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const item = items.find(item => item.id === selected);
  return <><Register embedded rows={items} unit="materials" empty="No materials added. A draft can be saved without materials."
    headers={<><th scope="col">Material</th><th scope="col">Quantity</th><th scope="col">Unit</th><th scope="col">Date needed</th>{edit && <th scope="col">Actions</th>}</>}
    renderRow={(item) => <tr key={item.id}><td><button className="text-link" type="button" onClick={() => edit ? edit(item.id) : setSelected(item.id)}>{shown(item.name)}</button></td><td>{shown(item.quantity)}</td><td>{shown(item.unit)}</td><td>{shown(item.neededDate)}</td>{edit && <td><button type="button" className="button secondary" onClick={() => edit(item.id)}>Edit</button><button type="button" className="button secondary" onClick={() => remove?.(item.id)}>Remove</button><button type="button" className="button secondary" aria-label={`Move ${shown(item.name)} up`} disabled={items[0]?.id === item.id} onClick={() => move?.(item.id, -1)}>Up</button><button type="button" className="button secondary" aria-label={`Move ${shown(item.name)} down`} disabled={items.at(-1)?.id === item.id} onClick={() => move?.(item.id, 1)}>Down</button></td>}</tr>} />
    <RecordModal open={!!item} title={shown(item?.name)} onClose={() => setSelected(null)}>{item && <dl className="detail-grid">{materialFields.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{shown(item[key])}</dd></div>)}</dl>}</RecordModal>
  </>;
}

function DraftEditor({ latest, data, today }: { latest?: SavedMrf; data: RequestView; today: string }) {
  const router = useRouter(), live = useFoundationRealtime();
  const [local, setLocal] = useState({ draft: latest?.draft ?? emptyMrfDraft(today), version: latest?.version ?? "", dirty: false });
  const [projectId, setProjectId] = useState(latest?.projectId ?? "");
  const [step, setStep] = useState(0), [selected, setSelected] = useState<string | null>(null), [copySource, setCopySource] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false);
  const operation = useRef<DraftCommand | null>(null), pending = useRef(false), dirtyRef = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const draft = !local.dirty && latest ? latest.draft : local.draft;
  const expected = !local.dirty && latest ? latest.version : local.version;
  const stale = !!latest && expected !== latest.version;
  const project = data.projects.find(project => project.id === projectId);
  const material = draft.items.find(item => item.id === selected);
  useEffect(() => { dirtyRef.current = local.dirty || uncertain; }, [local.dirty, uncertain]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    const leave = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (dirtyRef.current && anchor && anchor.getAttribute("href") !== window.location.pathname && !window.confirm("Leave this page? Unsaved MRF input will be lost.")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", leave, true); };
  }, []);
  const change = (next: MrfDraft) => {
    if (busy || uncertain) return;
    operation.current = null;
    setLocal({ draft: next, version: expected, dirty: true });
  };
  const changeStep = (index: number) => { setStep(index); queueMicrotask(() => heading.current?.focus()); };
  const save = async () => {
    if (pending.current || !project || (!uncertain && (stale || conflict))) return;
    pending.current = true; setBusy(true); setError("");
    operation.current ??= latest ? { type: "saveDraft", requestId: crypto.randomUUID(), mrfId: latest.id, expectedVersion: expected, draft }
      : { type: "createDraft", requestId: crypto.randomUUID(), projectId, draft };
    try {
      const result = await saveMrfDraftAction(operation.current);
      if (result.ok) { dirtyRef.current = false; router.push(`/requests/${result.record.id}`); router.refresh(); }
      else { setError(result.message); setConflict(!!result.conflict); setUncertain(!!result.uncertain); if (!result.uncertain) operation.current = null; }
    } catch { setUncertain(true); setError("The save response was interrupted. Retry this same save before making further changes."); }
    finally { pending.current = false; setBusy(false); live.refresh(); }
  };
  const addMaterial = (copy = false) => {
    const source = copy ? draft.items.find(item => item.id === copySource) : null;
    const item: DraftMaterial = { id: crypto.randomUUID(), name: "", quantity: null, unit: source?.unit ?? "", neededDate: source?.neededDate ?? "", purpose: source?.purpose ?? "", location: source?.location ?? "", remarks: source?.remarks ?? "" };
    change({ ...draft, items: [...draft.items, item] }); setSelected(item.id);
  };
  return <><Link className="back-link" href={latest ? `/requests/${latest.id}` : "/requests"}>Back to material requests</Link>
    <PageHeader title={latest ? `Edit ${latest.ref}` : "New material request"} description={latest ? "Shared project draft" : "MRF number: Assigned on save"} />
    <form className="form-stack request-wizard" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <nav aria-label="Request steps"><ol className="request-steps">{["Details", "Materials", "Review draft"].map((label, index) => <li key={label}><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => changeStep(index)}><span className="request-step-number" aria-hidden="true">{index + 1}</span><span>{label}</span></button></li>)}</ol></nav>
      <div className="request-step-heading"><h2 ref={heading} tabIndex={-1}>{["Details", "Materials", "Review draft"][step]}</h2><p>Incomplete fields may be saved. Printed names do not establish authority.</p></div>
      <fieldset disabled={busy || uncertain || !project && !!latest}>
        {step === 0 && <section className="panel"><div className="form-grid">
          <Field label="Project"><select name="projectId" required value={projectId} disabled={!!latest} onChange={event => { setProjectId(event.target.value); change({ ...draft, scopeId: null }); }}><option value="">Choose an assigned project</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
          <Field label="Scope of work"><select value={draft.scopeId ?? ""} onChange={event => change({ ...draft, scopeId: event.target.value || null })}><option value="">Unassigned</option>{project?.scopes.map(scope => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></Field>
          <Field label="Request date"><input type="date" value={draft.requestDate} onChange={event => change({ ...draft, requestDate: event.target.value })} /></Field>
          {detailFields.map(key => <Field label={labels[key]} key={key}>{key === "specialInstructions" ? <textarea maxLength={4000} value={draft[key]} onChange={event => change({ ...draft, [key]: event.target.value })} /> : <input name={key} maxLength={4000} value={draft[key]} onChange={event => change({ ...draft, [key]: event.target.value })} />}</Field>)}
        </div></section>}
        {step === 1 && <section className="panel"><div className="material-add-source"><button type="button" className="button secondary" onClick={() => addMaterial()}>Add material</button><Field label="Copy from"><select aria-label="Copy from material" value={copySource} onChange={event => setCopySource(event.target.value)}><option value="">Choose a material</option>{draft.items.map((item, index) => <option key={item.id} value={item.id}>Material {index + 1} — {shown(item.name)}</option>)}</select></Field><button type="button" className="button secondary" disabled={!draft.items.some(item => item.id === copySource)} onClick={() => addMaterial(true)}>Add with copied details</button></div>
          <MaterialList items={draft.items} edit={setSelected} remove={id => change({ ...draft, items: draft.items.filter(item => item.id !== id) })} move={(id, offset) => {
            const items = [...draft.items], index = items.findIndex(item => item.id === id), destination = index + offset;
            if (index < 0 || destination < 0 || destination >= items.length) return;
            [items[index], items[destination]] = [items[destination], items[index]]; change({ ...draft, items });
          }} />
        </section>}
        {step === 2 && <section className="panel"><DraftSummary draft={draft} projectId={projectId} data={data} /><p className="muted">{availability}</p></section>}
      </fieldset>
      <InlineError message={error} />
      {(stale || conflict) && latest && <section className="panel" role="status"><h2>Review saved changes</h2><p>Your input is preserved. Latest saved by {latest.updaterName}. Review the differences, reconcile your draft, then save.</p><DraftDifferences local={draft} saved={latest.draft} /><button type="button" className="button secondary" onClick={() => { setLocal({ draft, version: latest.version, dirty: true }); setConflict(false); setError(""); operation.current = null; }}>I reviewed the latest MRF; keep my draft</button><button type="button" className="button secondary" onClick={() => { setLocal({ draft: latest.draft, version: latest.version, dirty: false }); setConflict(false); setError(""); operation.current = null; }}>Discard my input and use saved draft</button></section>}
      {!project?.code && <p role="status">Choose an assigned project with a configured document code before saving.</p>}
      <div className="form-actions request-wizard-actions"><div><Link className="button secondary" href={latest ? `/requests/${latest.id}` : "/requests"}>Cancel</Link><button className="button primary" disabled={busy || !project?.code || (!uncertain && (stale || conflict))}>{busy ? "Saving…" : uncertain ? "Retry same save" : "Save draft"}</button></div><div>{step > 0 && <button type="button" className="button secondary" onClick={() => changeStep(step - 1)}>Back</button>}{step < 2 && <button type="button" className="button secondary" onClick={() => changeStep(step + 1)}>Next</button>}</div></div>
    </form>
    <RecordModal open={!!material} title="Material details" onClose={() => setSelected(null)}>{material && <fieldset disabled={busy || uncertain}><div className="form-grid">{materialFields.map(key => <Field label={labels[key]} key={key}><input maxLength={4000} value={material[key]} onChange={event => change({ ...draft, items: draft.items.map(item => item.id === material.id ? { ...item, [key]: event.target.value } : item) })} /></Field>)}<Field label="Quantity"><input inputMode="decimal" value={material.quantity ?? ""} onChange={event => change({ ...draft, items: draft.items.map(item => item.id === material.id ? { ...item, quantity: event.target.value || null } : item) })} /></Field><Field label="Date needed"><input type="date" value={material.neededDate} onChange={event => change({ ...draft, items: draft.items.map(item => item.id === material.id ? { ...item, neededDate: event.target.value } : item) })} /></Field></div></fieldset>}</RecordModal>
  </>;
}

function DraftDifferences({ local, saved }: { local: MrfDraft; saved: MrfDraft }) {
  const keys = ["scopeId", "requestDate", ...detailFields] as const;
  const ids = [...new Set([...local.items.map(item => item.id), ...saved.items.map(item => item.id)])];
  return <><dl>{keys.filter(key => local[key] !== saved[key]).map(key => <div key={key}><dt>{labels[key]}</dt><dd>Saved: {shown(saved[key])} · Yours: {shown(local[key])}</dd></div>)}</dl>
    {ids.map(id => {
      const mine = local.items.find(item => item.id === id), theirs = saved.items.find(item => item.id === id);
      if (JSON.stringify(mine) === JSON.stringify(theirs) && local.items.findIndex(item => item.id === id) === saved.items.findIndex(item => item.id === id)) return null;
      return <div key={id}><h3>{shown(mine?.name || theirs?.name)}</h3><p>Saved row: {theirs ? saved.items.indexOf(theirs) + 1 : "Absent"} · Your row: {mine ? local.items.indexOf(mine) + 1 : "Absent"}</p><dl>{[...materialFields, "quantity", "neededDate"].map(key => <div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd>Saved: {shown(theirs?.[key as keyof DraftMaterial])} · Yours: {shown(mine?.[key as keyof DraftMaterial])}</dd></div>)}</dl></div>;
    })}</>;
}
