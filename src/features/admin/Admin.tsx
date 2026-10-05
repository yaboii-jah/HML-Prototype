"use client";

import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { dateText, money } from "@/src/domain/format";

export function Admin() {
  const { confirm, confirmation } = useConfirmation();
  const { snapshot: state, run, reset } = useDemo();
  const [error, setError] = useState("");
  if (!state) return null;

  const addProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await run({ type: "addSite", name: String(form.get("name")), location: String(form.get("location")), budget: Number(form.get("budget")) });
    if (result.ok) { setError(""); formElement.reset(); } else setError(result.message);
  };

  const saveDriveFolder = async (event: FormEvent<HTMLFormElement>, siteId: string) => {
    event.preventDefault();
    const folder = String(new FormData(event.currentTarget).get("folder") || "");
    try {
      const response = await fetch("/api/drive/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "The Drive folder could not be validated.");
      const saved = await run({ type: "setProjectDriveFolder", siteId, folderId: result.id });
      setError(saved.ok ? "" : saved.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The Drive folder could not be validated."); }
  };

  return <>
    <PageHeader eyebrow="WORKSPACE SETTINGS" title="Administration" description="Manage projects and review workspace activity."/>
    <section className="panel">
      <h2 className="panel-title">Projects and Drive folders</h2>
      {!state.sites.length && <p className="helper-note">Add the first project below to make it available on material requests.</p>}
      {state.sites.map(site => <div className="admin-row" key={site.id}><div className="admin-project-details">
        <h3>{site.name}</h3>
        <p>{site.location}</p><p>Allocated budget: <strong>{money(site.budget)}</strong></p>
      </div><form className="drive-folder-form" onSubmit={event => void saveDriveFolder(event, site.id)}><Field label="Google Drive project folder"><input name="folder" type="text" defaultValue={site.driveFolderId ? `https://drive.google.com/drive/folders/${site.driveFolderId}` : ""} placeholder="Paste the project folder URL"/></Field>{state.role === "Administrator" && <button className="button secondary">Validate and save folder</button>}<small>Required before Procurement approval. The folder must be inside the configured company root.</small></form></div>)}
      {state.role === "Administrator" && <form className="subform admin-add-project" onSubmit={event => void addProject(event)}>
        <h3>Add project / site</h3>
        <div className="form-grid">
          <Field label="Project name"><input name="name" required /></Field>
          <Field label="Location"><input name="location" required /></Field>
          <Field label="Allocated budget (PHP)"><input name="budget" type="number" min="0" step="0.01" required /></Field>
        </div>
        <button className="button primary">Add project</button>
      </form>}
    </section>
    <InlineError message={error}/>
    <section className="panel">
      <h2 className="panel-title">Recent activity</h2>
      {!state.activity.length && <p className="helper-note">Project setup and workflow decisions will appear here.</p>}
      <div className="activity-list">{state.activity.slice(0, 18).map(activity => <div key={activity.id}>
        <strong>{activity.action}</strong><span>{activity.actor} / {dateText(activity.at)}</span>{activity.reason && <small>{activity.reason}</small>}
      </div>)}</div>
    </section>
    {state.role === "Administrator" && <section className="panel">
      <h2 className="panel-title">Clear workspace</h2>
      <p>Remove all projects, requests, quotations, purchase orders, deliveries, stock movements, payments, documents, and activity from this browser.</p>
      <button type="button" className="button danger-outline" onClick={() => void (async () => { if (await confirm("Clear all workspace data?", "All projects, requests, quotations, purchase orders, and locally stored files in this browser will be removed.", "Clear workspace", true)) await reset(); })()}>Clear all workspace data</button>
    </section>}
    {confirmation}
  </>;
}
