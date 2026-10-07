"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import type { ConfirmAction } from "@/src/components/ui/ConfirmDialog";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { ScopeBudgets } from "@/src/features/projects/ScopeBudgets";
import { projectMinimumBudget } from "@/src/domain/scope-budgets";
import { money } from "@/src/domain/format";
import type { Site } from "@/src/domain/types";

export function ProjectCreation({ confirm, onCreated, onCancel }: { confirm: ConfirmAction; onCreated: (id: string) => void; onCancel: () => void }) {
  const { run } = useDemo();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget), name = String(form.get("name") || "").trim(), location = String(form.get("location") || "").trim(), budget = Number(form.get("budget"));
    pending.current = true; setBusy(true); setError("");
    try {
      if (!await confirm("Add project?", `${name} · ${location} · ${money(budget)} allocated budget.`, "Add project")) return;
      const result = await run({ type: "addSite", name, location, budget });
      if (result.ok && result.recordId) onCreated(result.recordId); else setError(result.message);
    } catch { setError("The project could not be added. Try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="panel admin-project-creation" aria-label="Add project / site"><h2 className="panel-title">Add project / site</h2><form className="admin-add-project form-stack" onSubmit={save}><fieldset disabled={busy}><div className="form-grid"><Field label="Project name"><input name="name" required autoFocus/></Field><Field label="Location"><input name="location" required/></Field><Field label="Allocated budget (PHP)"><input name="budget" type="number" min="0" step="0.01" required/></Field></div></fieldset><InlineError message={error}/><div className="button-row"><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Add project"}</button><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form></section>;
}

export function AdminProjectSettings({ site, active, tab, confirm }: { site: Site; active: boolean; tab: number; confirm: ConfirmAction }) {
  const { snapshot: state, run } = useDemo();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState({ name: site.name, location: site.location, budget: String(site.budget) });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef(false);
  if (!state) return null;
  const canEdit = state.role === "Administrator", minimum = projectMinimumBudget(state, site.id);
  const invalidBudget = !Number.isFinite(Number(draft.budget)) || Number(draft.budget) < minimum;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canEdit || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!await confirm("Save project changes?", `${draft.name.trim()} · ${draft.location.trim()} · ${money(Number(draft.budget))} allocated budget. Existing records remain linked.`, "Save project")) return;
      const result = await run({ type: "updateSite", siteId: site.id, name: draft.name, location: draft.location, budget: Number(draft.budget) });
      if (result.ok) { setEditing(false); setMessage(result.message); } else setError(result.message);
    } catch { setError("The project changes could not be saved. Try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="admin-project-settings" data-admin-project={site.id}>
    <section className="admin-project-details" hidden={tab!==0}><div className="panel-heading"><h3>Project details</h3>{canEdit && !editing && <button className="button secondary" type="button" onClick={() => { setDraft({ name: site.name, location: site.location, budget: String(site.budget) }); setEditing(true); setError(""); setMessage(""); }}>Edit project</button>}</div>
      {editing ? <form className="admin-edit-project form-stack" onSubmit={save}><fieldset disabled={busy}><div className="form-grid"><Field label="Project name"><input value={draft.name} required onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></Field><Field label="Location"><input value={draft.location} required onChange={event => setDraft(current => ({ ...current, location: event.target.value }))}/></Field><Field label="Allocated budget (PHP)" hint={`Minimum: ${money(minimum)} to cover scope allocations and committed/spent funds.`}><input type="number" min={minimum} step="0.01" required value={draft.budget} onChange={event => setDraft(current => ({ ...current, budget: event.target.value }))}/></Field></div></fieldset><InlineError message={error}/><div className="button-row"><button className="button primary" disabled={busy || invalidBudget}>{busy ? "Saving…" : "Save project"}</button><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel editing</button></div></form> : <p className="helper-note">Project details apply to current views and future documents. Saved purchase order fields and archived files remain unchanged.</p>}
      {!editing && <div className="data-rows"><div><span>Project name</span><strong>{site.name}</strong></div><div><span>Location</span><strong>{site.location}</strong></div><div><span>Allocated budget</span><strong>{money(site.budget)}</strong></div></div>}
      {message && <p className="admin-feedback success" role="status">{message}</p>}
    </section>
    <div hidden={tab!==1}><DriveFolderSettings site={site} active={active && tab===1} canEdit={canEdit} confirm={confirm}/></div>
    <div hidden={tab!==2}><ScopeBudgets siteId={site.id} editable confirmChange={confirm}/></div>
  </div>;
}

function DriveFolderSettings({ site, active, canEdit, confirm }: { site: Site; active: boolean; canEdit: boolean; confirm: ConfirmAction }) {
  const { run } = useDemo();
  const [folder, setFolder] = useState(site.driveFolderId ? `https://drive.google.com/drive/folders/${site.driveFolderId}` : "");
  const [phase, setPhase] = useState<"idle" | "validating" | "confirming" | "saving" | "saved" | "validated" | "error">("idle");
  const [message, setMessage] = useState("");
  const pending = useRef(false), mounted = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const generation=useRef(0);
  useEffect(()=>{if(!active){generation.current++;controller.current?.abort();pending.current=false;}},[active]);
  const shownPhase=phase, shownMessage=message;
  const busy = ["validating", "confirming", "saving"].includes(shownPhase);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!active || !canEdit || pending.current) return;
    const token=++generation.current;
    pending.current = true; setPhase("validating"); setMessage("Validating the folder URL and access…");
    controller.current = new AbortController();
    controller.current.signal.addEventListener("abort",()=>{if(mounted.current){setPhase("idle");setMessage("");}},{once:true});
    try {
      const response = await fetch("/api/drive/validate", { method: "POST", signal: controller.current.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
      const result = await response.json() as { id?: string; name?: string; error?: string };
      if (!mounted.current || token!==generation.current) return;
      if (!response.ok || typeof result.id !== "string" || !result.id.trim()) throw new Error(result.error || "The Drive folder could not be validated.");
      if (result.id === site.driveFolderId) { setPhase("saved"); setMessage("This folder is already saved."); return; }
      setPhase("confirming"); setMessage(`Validated: ${result.name || "project folder"}. Waiting for confirmation.`);
      if (!await confirm("Save validated Drive folder?", `Use ${result.name || "this folder"} for ${site.name}? ${site.driveFolderId ? "This replaces the folder used for future archives. Existing archived files remain unchanged." : "Future approved documents will be archived to this folder."}`, "Save folder")) { if (mounted.current && token===generation.current) { setPhase("validated"); setMessage("Folder validated. Saving was cancelled; the mapping is unchanged."); } return; }
      if (!mounted.current || token!==generation.current) return;
      setPhase("saving"); setMessage("Saving the project folder…");
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!mounted.current || token!==generation.current) return;
      const saved = await run({ type: "setProjectDriveFolder", siteId: site.id, folderId: result.id });
      if (!mounted.current || token!==generation.current) return;
      if (!saved.ok) throw new Error(saved.message);
      setFolder(`https://drive.google.com/drive/folders/${result.id}`); setPhase("saved"); setMessage(`Saved: ${result.name || "project folder"}.`);
    } catch (cause) {
      if (mounted.current && token===generation.current) { setPhase("error"); setMessage(cause instanceof Error ? cause.message : "The folder could not be validated. Try again."); }
    } finally { if(token===generation.current)pending.current = false; }
  };
  return <section className="admin-drive-settings" aria-label={`Drive folder for ${site.name}`}><h3>Google Drive folder</h3><form className="drive-folder-form" onSubmit={save} aria-busy={busy}><Field label="Google Drive project folder"><input name="folder" value={folder} required readOnly={!canEdit} disabled={busy} placeholder="Paste the project folder URL" onChange={event => { setFolder(event.target.value); setPhase("idle"); setMessage(""); }}/></Field><small>Required before Procurement approval. The folder must be inside the configured company root.</small>{canEdit && <button className="button secondary" disabled={busy}>{shownPhase === "validating" ? "Validating…" : shownPhase === "saving" ? "Saving…" : shownPhase === "confirming" ? "Awaiting confirmation…" : shownPhase === "error" ? "Retry validation and save" : "Validate and save folder"}</button>}{shownMessage && <p className={`admin-feedback ${shownPhase === "error" ? "error" : shownPhase === "saved" ? "success" : ""}`} role={shownPhase === "error" ? "alert" : "status"}>{shownMessage}</p>}{site.driveFolderId && <a className="text-link" href={`https://drive.google.com/drive/folders/${site.driveFolderId}`} target="_blank" rel="noreferrer">Open saved folder ↗</a>}</form></section>;
}
