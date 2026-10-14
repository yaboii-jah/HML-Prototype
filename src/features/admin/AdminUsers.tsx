"use client";

import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import type { ManagedUser } from "@/src/app-state/user-directory";
import { ROLES } from "@/src/domain/types";
import type { Role } from "@/src/domain/types";
import { auditTime } from "@/src/domain/audit";
import { roleLabel } from "@/src/domain/format";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";

export function AdminUsers() {
  const { directory, session, manageUser, snapshot } = useDemo();
  const { notify, update } = useActionFeedback();
  const [search, setSearch] = useState(""), [role, setRole] = useState("all"), [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<ManagedUser | "new" | null>(null), [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const submitting = useRef(false), { confirm, confirmation } = useConfirmation();
  if (session.role !== "Administrator") return null;
  const rows = directory.users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(search.trim().toLowerCase()) && (role === "all" || role === user.role) && (status === "all" || (status === "active") === user.active));
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current || !editor) return;
    const form = new FormData(event.currentTarget), name = String(form.get("name") || ""), email = String(form.get("email") || ""), role = String(form.get("role")) as Role;
    submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!await confirm(editor === "new" ? "Add user?" : "Save user changes?", `${name.trim()} / ${email.trim()} / ${roleLabel(role)}. Role or email changes end this user's existing sessions.`, editor === "new" ? "Add user" : "Save changes")) return;
      const toast = notify({ tone: "progress", title: editor === "new" ? "Adding user…" : "Saving user changes…" });
      const result = await manageUser(editor === "new" ? { type: "add", name, email, role, siteIds: form.getAll("siteIds").map(String), password: String(form.get("password") || "") } : { type: "edit", id: editor.id, revision: editor.revision, name, email, role, siteIds: form.getAll("siteIds").map(String) });
      update(toast, result.ok ? { tone: "success", title: result.message, detail: name.trim() } : { tone: "error", title: result.message });
      if (result.ok) { setEditor(null); setMessage(result.message); } else setError(result.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current || !passwordUser) return;
    const password = String(new FormData(event.currentTarget).get("password") || "");
    submitting.current = true; setBusy(true); setError("");
    try {
      if (!await confirm("Reset user password?", `Existing sessions for ${passwordUser.name} will end. Share the replacement password outside the app.`, "Reset password", true)) return;
      const toast = notify({ tone: "progress", title: "Resetting password…", detail: passwordUser.name });
      const result = await manageUser({ type: "password", id: passwordUser.id, revision: passwordUser.revision, password });
      update(toast, result.ok ? { tone: "success", title: result.message, detail: passwordUser.name } : { tone: "error", title: result.message });
      if (result.ok) { setPasswordUser(null); setMessage(result.message); } else setError(result.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  const changeStatus = async (user: ManagedUser) => {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!await confirm(user.active ? "Deactivate user?" : "Reactivate user?", user.active ? `${user.name} will lose sign-in access and be removed from presenter switching. Existing records retain their original attribution.` : `${user.name} will regain access with their assigned role and existing password.`, user.active ? "Deactivate" : "Reactivate", user.active)) return;
      const toast = notify({ tone: "progress", title: user.active ? "Deactivating user…" : "Reactivating user…", detail: user.name });
      const result = await manageUser({ type: "status", id: user.id, revision: user.revision, active: !user.active });
      update(toast, result.ok ? { tone: user.active ? "warning" : "success", title: result.message, detail: user.name } : { tone: "error", title: result.message });
      if (result.ok) setMessage(result.message); else setError(result.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  return <section className="admin-users" aria-busy={busy}>
    <div className="panel-heading"><div><h2>User management</h2><p className="helper-note">Manage names, sign-in access, and department roles for this workspace.</p></div><button className="button primary" disabled={busy} onClick={() => { setError(""); setEditor("new"); }}>Add user</button></div>
    {message && <p className="admin-feedback success" role="status">{message}</p>}<InlineError message={!editor && !passwordUser ? error : ""}/>
    <Register rows={rows} resetKey={search + role + status} unit="users" filters={<><input type="search" aria-label="Search users" placeholder="Search name or email" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="Filter user role" value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option>{ROLES.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select><select aria-label="Filter user status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></>} headers={<><th>User / email</th><th>Role</th><th>Status</th><th>Actions</th></>} empty="No users match these filters." renderRow={user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small>{session.userId === user.id && <small>Your account</small>}</td><td>{roleLabel(user.role)}{user.role === "Site Personnel" && <small>{user.siteIds?.length ? user.siteIds.map(id => snapshot?.sites.find(site => site.id === id)?.name || "Removed project").join(", ") : "No projects assigned"}</small>}</td><td><Badge>{user.active ? "Active" : "Inactive"}</Badge></td><td><div className="user-row-actions"><button className="button secondary" disabled={busy} onClick={() => { setError(""); setEditor(user); }}>Edit</button><button className="button secondary" disabled={busy} onClick={() => { setError(""); setPasswordUser(user); }}>Reset password</button><button className="button danger-outline" disabled={busy || user.active && session.userId === user.id} onClick={() => void changeStatus(user)}>{user.active ? "Deactivate" : "Reactivate"}</button></div></td></tr>}/>
    <RecordModal open={!!editor} title={editor === "new" ? "Add user" : "Edit user"} onClose={() => { if (!busy) setEditor(null); }}>
      {editor && <form key={editor === "new" ? "new" : editor.id} className="form-stack user-edit-form" onSubmit={save}><Field label="Full name"><input name="name" required maxLength={100} defaultValue={editor === "new" ? "" : editor.name}/></Field><Field label="Email"><input name="email" type="email" required maxLength={254} defaultValue={editor === "new" ? "" : editor.email} autoComplete="off"/></Field><Field label="Department role"><select name="role" defaultValue={editor === "new" ? "Site Personnel" : editor.role}>{ROLES.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></Field>{editor === "new" && <Field label="Initial password" hint="8–128 characters. Share it with the user outside the app."><input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password"/></Field>}<fieldset className="subform"><legend>Project assignments for Site Personnel</legend><p className="helper-note">Select every project this person can request, release, receive and manage stock for. No assignments means site actions are unavailable. Changes end existing sessions.</p>{snapshot?.sites.map(site => <label className="check-row" key={site.id}><input type="checkbox" name="siteIds" value={site.id} defaultChecked={editor !== "new" && !!editor.siteIds?.includes(site.id)}/>{site.name}</label>)}{!snapshot?.sites.length && <p className="muted">Create a project before assigning its personnel.</p>}</fieldset><InlineError message={error}/><button className="button primary" disabled={busy}>{busy ? "Saving..." : editor === "new" ? "Add user" : "Save changes"}</button></form>}
    </RecordModal>
    <RecordModal open={!!passwordUser} title="Reset password" onClose={() => { if (!busy) setPasswordUser(null); }}>{passwordUser && <form className="form-stack user-password-form" onSubmit={resetPassword}><p>Set a replacement password for <strong>{passwordUser.name}</strong>. Existing passwords cannot be viewed.</p><Field label="New password"><input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password"/></Field><InlineError message={error}/><button className="button primary" disabled={busy}>{busy ? "Saving..." : "Reset password"}</button></form>}</RecordModal>
    {!!directory.activity.length && <details className="panel"><summary>User management history ({directory.activity.length})</summary>{directory.activity.slice(0, 20).map(event => <div className="subform" key={event.id}><strong>{event.action} / {event.entityRef}</strong><p className="helper-note">{event.actorIdentity?.name} / {auditTime(event.at)}{event.changedFields?.length ? ` / ${event.changedFields.join(", ")}` : ""}</p></div>)}</details>}
    {confirmation}
  </section>;
}
