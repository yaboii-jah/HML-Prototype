"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import type { ConfirmAction } from "@/src/components/ui/ConfirmDialog";
import { BudgetInput } from "@/src/components/ui/BudgetInput";
import { parseBudgetInput } from "@/src/domain/budget-input";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { LocalProjectFiles } from "@/src/features/projects/LocalProjectFiles";
import { ScopeBudgets } from "@/src/features/projects/ScopeBudgets";
import { projectRemovalReason } from "@/src/domain/project-removal";
import { projectMinimumBudget } from "@/src/domain/scope-budgets";
import { normalizeProjectCode, projectCodeLocked } from "@/src/domain/document-numbering";
import { money } from "@/src/domain/format";
import { setupProjectFolder } from "./project-folder";
import type { Site } from "@/src/domain/types";

export function ProjectCreation({ confirm, onCreated, onCancel }: { confirm: ConfirmAction; onCreated: (id: string) => void; onCancel: () => void }) {
  const { run, beginOperation, snapshot } = useDemo();
  const { notify, update, dismiss } = useActionFeedback();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [creatingFolder, setCreatingFolder] = useState(false);
  const [documentCode, setDocumentCode] = useState("");
  const pending = useRef(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget), name = String(form.get("name") || "").trim(), location = String(form.get("location") || "").trim(), budget = parseBudgetInput(String(form.get("budget") || ""));
    pending.current = true; setBusy(true); setError("");
    const toast = notify({ tone: "progress", title: "Adding project…", detail: `${name} · ${location}` });
    try {
      if (!await confirm("Add project?", `${name} (${documentCode}) · ${location} · ${money(budget)} allocated budget. ${snapshot?.showcase ? "Documents will be archived locally in this browser." : "A project folder will be created automatically in the company Google Drive folder."}`, "Add project")) { dismiss(toast); return; }
      const result = await run({ type: "addSite", documentCode, name, location, budget });
      if (!result.ok) { setError(result.message); update(toast, { tone: "error", title: result.message }); }
      else if (result.recordId) {
        update(toast, { title: snapshot?.showcase ? "Project saved. Preparing local documents…" : "Project saved. Creating the Google Drive project folder…", detail: name });
        setCreatingFolder(true);
        const site = result.snapshot.sites.find(value => value.id === result.recordId)!;
        let ready = false;
        try { ready = await setupProjectFolder(site, beginOperation); } catch { /* The saved project remains pending and can be retried. */ }
        update(toast, ready
          ? { tone: "success", title: snapshot?.showcase ? "Project added. Local archive ready." : "Project added. Google Drive folder ready.", detail: `${name} · ${location}` }
          : { tone: "warning", title: "Project added. Folder setup is pending.", detail: "Retry or link an existing folder in Project settings." });
        onCreated(result.recordId);
      } else update(toast, { tone: "error", title: result.message });
    } catch { setError("The project could not be added. Try again."); update(toast, { tone: "error", title: "The project could not be added. Try again." }); }
    finally { pending.current = false; setBusy(false); setCreatingFolder(false); }
  };
  return <section className="panel admin-project-creation" aria-label="Add project / site"><h2 className="panel-title">Add project / site</h2><form className="admin-add-project form-stack" onSubmit={save}><fieldset disabled={busy}><div className="form-grid"><Field label="Project name"><input name="name" required autoFocus/></Field><Field label="Project code" hint="Unique uppercase letters, numbers or hyphens. Locked after its first use."><input name="documentCode" value={documentCode} onChange={event => setDocumentCode(normalizeProjectCode(event.target.value))} required maxLength={20} pattern="[A-Z0-9]+(-[A-Z0-9]+)*" placeholder="HML"/></Field><Field label="Location"><input name="location" required/></Field><Field label="Allocated budget (PHP)"><BudgetInput name="budget" required/></Field></div><p className="helper-note">Document examples: {documentCode || "CODE"}-MRF-0001 / {documentCode || "CODE"}-PO-0001</p></fieldset><InlineError message={error}/><div className="button-row"><button className="button primary" disabled={busy}>{creatingFolder ? "Creating folder..." : busy ? "Saving..." : "Add project"}</button><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form></section>;
}

export function AdminProjectSettings({ site, active, tab, confirm }: { site: Site; active: boolean; tab: number; confirm: ConfirmAction }) {
  const { snapshot: state } = useDemo();
  const { runAction } = useActionFeedback();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState({ name: site.name, documentCode: site.documentCode || "", location: site.location, budget: String(site.budget) });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef(false);
  if (!state) return null;
  const canEdit = ["Administrator", "Project Manager"].includes(state.role), minimum = projectMinimumBudget(state, site.id);
  const removalReason = projectRemovalReason(state, site.id);
  const remove = async () => {
    if (!canEdit || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (!await confirm(`Delete ${site.name}?`, "This deletes the unused project and its local scopes. Any Google Drive folder is retained.", "Delete project", true)) return;
      const result = await runAction({ type: "removeSite", siteId: site.id }, { progress: "Deleting project…", success: "Project deleted." });
      if (!result.ok) setError(result.message);
    } finally { pending.current = false; setBusy(false); }
  };
  const invalidBudget = !Number.isFinite(Number(draft.budget)) || Number(draft.budget) < minimum;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canEdit || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!await confirm("Save project changes?", `${draft.name.trim()} · ${draft.location.trim()} · ${money(Number(draft.budget))} allocated budget. Existing records remain linked.`, "Save project")) return;
      const result = await runAction({ type: "updateSite", siteId: site.id, documentCode: draft.documentCode, name: draft.name, location: draft.location, budget: Number(draft.budget) }, { progress: "Saving project changes…", success: "Project changes saved." });
      if (result.ok) { setEditing(false); setMessage(result.message); } else setError(result.message);
    } catch { setError("The project changes could not be saved. Try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="admin-project-settings" data-admin-project={site.id}>
    <section className="admin-project-details" hidden={tab!==0}><div className="panel-heading"><h3>Project details</h3>{canEdit && !editing && <button className="button secondary" type="button" onClick={() => { setDraft({ name: site.name, documentCode: site.documentCode || "", location: site.location, budget: String(site.budget) }); setEditing(true); setError(""); setMessage(""); }}>Edit project</button>}</div>
      {editing ? <form className="admin-edit-project form-stack" onSubmit={save}><fieldset disabled={busy}><div className="form-grid"><Field label="Project name"><input value={draft.name} required onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></Field><Field label="Project code" hint={projectCodeLocked(site) ? "Locked: this code has been used on documents." : "Required for new documents. Locked after its first use."}><input aria-label="Project code" value={draft.documentCode} required readOnly={projectCodeLocked(site)} maxLength={20} pattern="[A-Z0-9]+(-[A-Z0-9]+)*" onChange={event => setDraft(current => ({ ...current, documentCode: normalizeProjectCode(event.target.value) }))}/></Field><Field label="Location"><input value={draft.location} required onChange={event => setDraft(current => ({ ...current, location: event.target.value }))}/></Field><Field label="Allocated budget (PHP)" hint={`Minimum: ${money(minimum)} to cover scope allocations and committed/spent funds.`}><BudgetInput min={minimum} required value={draft.budget} onValueChange={budget => setDraft(current => ({ ...current, budget }))}/></Field></div><p className="helper-note">Document examples: {draft.documentCode || "CODE"}-MRF-0001 / {draft.documentCode || "CODE"}-PO-0001</p></fieldset><InlineError message={error}/><div className="button-row"><button className="button primary" disabled={busy || invalidBudget}>{busy ? "Saving…" : "Save project"}</button><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel editing</button></div></form> : <p className="helper-note">Project details apply to current views and future documents. Saved purchase order fields and archived files remain unchanged.</p>}
      {!editing && <div className="data-rows"><div><span>Project name</span><strong>{site.name}</strong></div><div><span>Project code</span><strong>{site.documentCode || "Not assigned"}{projectCodeLocked(site) ? " (locked)" : ""}</strong></div><div><span>Location</span><strong>{site.location}</strong></div><div><span>Allocated budget</span><strong>{money(site.budget)}</strong></div></div>}
      {!editing && canEdit && <div className="subform"><button type="button" className="button danger-outline" disabled={busy || !!removalReason} onClick={() => void remove()}>Delete project</button>{removalReason && <p className="helper-note">{removalReason}</p>}<InlineError message={error}/></div>}
      {message && <p className="admin-feedback success" role="status">{message}</p>}
    </section>
    <div hidden={tab!==1}><DriveFolderSettings site={site} active={active && tab===1} canEdit={canEdit} confirm={confirm}/></div>
    <div hidden={tab!==2}><ScopeBudgets siteId={site.id} editable confirmChange={confirm}/></div>
  </div>;
}

function DriveFolderSettings({ site, active, canEdit, confirm }: { site: Site; active: boolean; canEdit: boolean; confirm: ConfirmAction }) {
  const { run, beginOperation } = useDemo();
  const { notify, update, dismiss } = useActionFeedback();
  const [manual, setManual] = useState(false);
  const [folder, setFolder] = useState(site.driveFolderId ? `https://drive.google.com/drive/folders/${site.driveFolderId}` : "");
  const [phase, setPhase] = useState<"idle" | "creating" | "validating" | "confirming" | "saving" | "saved" | "validated" | "error">("idle");
  const [message, setMessage] = useState("");
  const pending = useRef(false), mounted = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const generation=useRef(0);
  useEffect(()=>{if(!active){generation.current++;controller.current?.abort();pending.current=false;}},[active]);
  if (site.localArchiveId) return <section className="admin-drive-settings"><h3>Local document archive</h3><p>Documents for this demonstration project are stored in this browser. No Google Drive upload is performed.</p>{active && <LocalProjectFiles siteId={site.id}/>}</section>;
  const shownPhase=phase, shownMessage=message;
  const busy = ["creating", "validating", "confirming", "saving"].includes(shownPhase);
  const create = async () => {
    if (!active || !canEdit || pending.current || site.driveFolderId) return;
    pending.current = true;
    try {
      if (!await confirm("Create project folder?", `Create ${site.name} inside the company Google Drive folder? A previous attempt's folder will be reused.`, "Create folder")) return;
      const toast = notify({ tone: "progress", title: "Creating the Google Drive project folder…", detail: site.name });
      setPhase("creating"); setMessage("Creating the project folder...");
      const ready = await setupProjectFolder(site, beginOperation);
      setPhase(ready ? "saved" : "error");
      const text = ready ? "Project folder ready." : "Folder setup pending. Retry or link an existing folder.";
      setMessage(text);
      update(toast, ready
        ? { tone: "success", title: "Project folder ready.", detail: site.name }
        : { tone: "warning", title: "Folder setup is pending.", detail: "Retry or link an existing folder in Project settings." });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Folder setup pending. Try again.";
      setPhase("error"); setMessage(text);
      notify({ tone: "error", title: text, detail: site.name });
    }
    finally { pending.current = false; }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!active || !canEdit || pending.current) return;
    const token=++generation.current;
    pending.current = true; setPhase("validating"); setMessage("Validating the folder URL and access…");
    const toast = notify({ tone: "progress", title: "Validating the Google Drive folder…", detail: site.name });
    controller.current = new AbortController();
    controller.current.signal.addEventListener("abort",()=>{if(mounted.current){setPhase("idle");setMessage("");dismiss(toast);}},{once:true});
    try {
      const response = await fetch("/api/drive/validate", { method: "POST", signal: controller.current.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
      const result = await response.json() as { id?: string; name?: string; error?: string };
      if (!mounted.current || token!==generation.current) return;
      if (!response.ok || typeof result.id !== "string" || !result.id.trim()) throw new Error(result.error || "The Drive folder could not be validated.");
      if (result.id === site.driveFolderId) { setPhase("saved"); setMessage("This folder is already saved."); update(toast, { tone: "success", title: "This folder is already saved.", detail: site.name }); return; }
      setPhase("confirming"); setMessage(`Validated: ${result.name || "project folder"}. Waiting for confirmation.`);
      if (!await confirm("Save validated Drive folder?", `Use ${result.name || "this folder"} for ${site.name}? ${site.driveFolderId ? "This replaces the folder used for future archives. Existing archived files remain unchanged." : "Future approved documents will be archived to this folder."}`, "Save folder")) { if (mounted.current && token===generation.current) { setPhase("validated"); setMessage("Folder validated. Saving was cancelled; the mapping is unchanged."); update(toast, { tone: "warning", title: "Folder validated. Saving was cancelled.", detail: "The project mapping is unchanged." }); } return; }
      if (!mounted.current || token!==generation.current) return;
      setPhase("saving"); setMessage("Saving the project folder…");
      update(toast, { title: "Saving the project folder…", detail: result.name || site.name });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!mounted.current || token!==generation.current) return;
      const saved = await run({ type: "setProjectDriveFolder", siteId: site.id, folderId: result.id });
      if (!mounted.current || token!==generation.current) return;
      if (!saved.ok) throw new Error(saved.message);
      setFolder(`https://drive.google.com/drive/folders/${result.id}`); setPhase("saved"); setMessage(`Saved: ${result.name || "project folder"}.`);
      update(toast, { tone: "success", title: "Project folder saved.", detail: result.name || "project folder" });
    } catch (cause) {
      if (mounted.current && token===generation.current) { const text = cause instanceof Error ? cause.message : "The folder could not be validated. Try again."; setPhase("error"); setMessage(text); update(toast, { tone: "error", title: text, detail: site.name }); }
    } finally { if(token===generation.current)pending.current = false; }
  };
  return <section className="admin-drive-settings" aria-label={`Drive folder for ${site.name}`} aria-busy={busy}>
    <h3>Google Drive folder</h3>
    <p className="helper-note">{site.driveFolderId ? "Folder ready. Approved documents will be archived to this folder." : phase === "creating" ? "Creating the project folder..." : "Folder setup pending. A folder is required before Procurement approval."}</p>
    {site.driveFolderSetup?.error && !site.driveFolderId && <p className="admin-feedback error" role="alert">{site.driveFolderSetup.error}</p>}
    <div className="button-row">
      {site.driveFolderId && <a className="button secondary" href={`https://drive.google.com/drive/folders/${site.driveFolderId}`} target="_blank" rel="noreferrer">Open project folder</a>}
      {canEdit && !site.driveFolderId && <button type="button" className="button primary" disabled={busy} onClick={() => void create()}>{phase === "creating" ? "Creating folder..." : "Retry folder creation"}</button>}
      {canEdit && <button type="button" className="button secondary" disabled={busy} aria-expanded={manual} onClick={() => { if (!manual && site.driveFolderId) setFolder(`https://drive.google.com/drive/folders/${site.driveFolderId}`); setManual(value => !value); }}>{manual ? "Cancel manual linking" : "Link an existing folder"}</button>}
    </div>
    <form className="drive-folder-form" onSubmit={save} hidden={!manual} aria-busy={busy}>
      <Field label="Google Drive project folder"><input name="folder" value={folder} required readOnly={!canEdit} disabled={busy} placeholder="Paste the project folder URL" onChange={event => { setFolder(event.target.value); setPhase("idle"); setMessage(""); }}/></Field>
      <small>The folder must be inside the configured company root and allow files to be added.</small>
      <div className="drive-folder-actions">{canEdit && <button className="button secondary" disabled={busy}>{shownPhase === "validating" ? "Validating..." : shownPhase === "saving" ? "Saving..." : shownPhase === "confirming" ? "Awaiting confirmation..." : shownPhase === "error" ? "Retry validation and save" : "Validate and save folder"}</button>}</div>
    </form>
    {shownMessage && <p className={`admin-feedback ${shownPhase === "error" ? "error" : shownPhase === "saved" ? "success" : ""}`} role={shownPhase === "error" ? "alert" : "status"}>{shownMessage}</p>}
  </section>;
}
