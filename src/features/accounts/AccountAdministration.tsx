"use client";

import { useRef, useState, type FormEvent } from "react";
import { accountCommandAction } from "@/app/(workspace)/admin/actions";
import { AUTH_ROLES, type AuthRole } from "@/src/domain/auth/session";
import type { Account, AccountCommand, AccountDirectory, AccountDraft, AccountResult } from "@/src/domain/accounts/accounts";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";

type Directory = AccountDirectory & { actorId: string; emailEnabled: boolean };
type Editor = { id: string | null; version: string; email: string; draft: AccountDraft; conflict: boolean };
const messageLabel = (status: Account["messageStatus"]) => ({ not_sent: "Invitation not sent", accepted: "Message accepted by provider", failed: "Message failed", uncertain: "Message outcome uncertain" })[status];

export function AccountAdministration({ directory }: { directory: Directory }) {
  const [search, setSearch] = useState(""), [role, setRole] = useState("all"), [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const submitting = useRef(false), retry = useRef<{ key: string; requestId: string } | null>(null);
  const { confirm, confirmation } = useConfirmation();
  const rows = directory.users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(search.trim().toLowerCase())
    && (role === "all" || user.roles.includes(role as AuthRole)) && (status === "all" || (status === "active") === user.active));

  const open = (user?: Account) => {
    retry.current = null; setError(""); setNotice("");
    setEditor(user ? { id: user.id, version: user.version, email: user.email, conflict: false,
      draft: { name: user.name, roles: [...user.roles], projectIds: [...user.projectIds], active: user.active, clearAssignments: false } }
      : { id: null, version: "1", email: "", conflict: false, draft: { name: "", roles: ["Site Personnel"], projectIds: [], active: true, clearAssignments: false } });
  };
  const update = (draft: Partial<AccountDraft>) => setEditor(current => current && ({ ...current, draft: { ...current.draft, ...draft } }));
  const run = async (command: AccountCommand): Promise<AccountResult> => {
    try { return await accountCommandAction(command); }
    catch { return { ok: false, message: "The response was interrupted. Retry this request to check its saved outcome." }; }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || submitting.current || editor.conflict) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const previous = directory.users.find(user => user.id === editor.id);
      const clears = !!previous?.roles.includes("Site Personnel") && !editor.draft.roles.includes("Site Personnel") && previous.projectIds.length > 0;
      if (!await confirm(editor.id ? "Save account changes?" : "Save staff invitation?", clears
        ? "Changing this user from Site Personnel clears all project assignments and ends their current access."
        : editor.id ? "Access changes require a fresh sign-in. Name changes preserve sessions. Email remains fixed."
          : directory.emailEnabled ? "Save this account and send a password setup invitation." : "Save this account as pending. Invitation email is not available yet.", "Save")) return;
      const draft = { ...editor.draft, clearAssignments: clears, projectIds: editor.draft.roles.includes("Site Personnel") ? editor.draft.projectIds : [] };
      const payload = editor.id ? { type: "save" as const, id: editor.id, version: editor.version, draft }
        : { type: "invite" as const, draft: { ...draft, email: editor.email } };
      const key = JSON.stringify(payload);
      if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
      const result = await run({ ...payload, requestId: retry.current.requestId });
      if (result.ok) { setEditor(null); setNotice(result.message); retry.current = null; }
      else { setError(result.message); if (result.conflict) setEditor(current => current && ({ ...current, conflict: true })); }
    } finally { submitting.current = false; setBusy(false); }
  };
  const changeStatus = async (user: Account) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (!await confirm(user.active ? "Deactivate account?" : "Reactivate account?", user.active
        ? `${user.name} will lose workspace access. Their identity and history are retained.`
        : `${user.name} will retain their existing roles and assignments. Old sessions remain invalid.`, user.active ? "Deactivate" : "Reactivate", user.active)) return;
      const payload = { type: "save" as const, id: user.id, version: user.version,
        draft: { name: user.name, roles: user.roles, projectIds: user.projectIds, active: !user.active, clearAssignments: false } };
      const key = JSON.stringify(payload);
      if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
      const result = await run({ ...payload, requestId: retry.current.requestId });
      if (result.ok) { setNotice(result.message); retry.current = null; } else setError(result.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  const send = async (user: Account) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const kind = user.confirmed ? "recovery" : "invite";
      if (!await confirm(kind === "invite" ? "Send invitation?" : "Send recovery link?",
        `Start a new message attempt to ${user.email}. Existing sessions continue until a password is successfully reset. A successful resend replaces the previous ${kind} link.`, "Send link")) return;
      const result = await run({ type: "message", id: user.id, version: user.version, kind, requestId: crypto.randomUUID() });
      if (result.ok) setNotice(result.message); else setError(result.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  const toggleRole = (next: AuthRole, checked: boolean) => {
    if (!editor) return;
    const roles = checked ? next === "Site Personnel" ? [next] : [...editor.draft.roles.filter(r => r !== "Site Personnel"), next]
      : editor.draft.roles.filter(r => r !== next);
    update({ roles });
  };

  return <>
    <PageHeader eyebrow="Administration" title="Users" description="Manage staff invitations, roles and workspace access." actions={<button className="button primary" disabled={busy} onClick={() => open()}>Invite staff</button>}/>
    {!directory.emailEnabled && <p className="account-capability">Email sending is unavailable. You can save pending accounts; invitations will remain unsent.</p>}
    {!editor && <InlineError message={error}/>}{notice && <p className="account-notice" role="status">{notice}</p>}
    <Register rows={rows} unit="users" resetKey={`${search}:${role}:${status}`} headers={<><th>Name / email</th><th>Roles / projects</th><th>Access / setup</th><th>Latest message</th><th>Actions</th></>}
      filters={<><input type="search" aria-label="Search users" placeholder="Search name or email" value={search} onChange={event => setSearch(event.target.value)}/>
        <select aria-label="Filter users by role" value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option>{AUTH_ROLES.map(r => <option key={r}>{r}</option>)}</select>
        <select aria-label="Filter users by status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option></select></>}
      renderRow={user => <tr key={user.id} data-account-id={user.id}><td><strong>{user.name}</strong><small>{user.email}</small>{user.id === directory.actorId && <small>Your account</small>}</td>
        <td>{user.roles.join(", ")}{user.roles.includes("Site Personnel") && <small>{user.projectIds.length} assigned projects</small>}</td>
        <td><span className={`badge ${user.active ? "good" : "neutral"}`}>{user.active ? "Active" : "Inactive"}</span><small>{user.firstSignedInAt ? "Has signed in" : user.confirmed ? "Awaiting first sign-in" : "Awaiting password setup"}</small></td>
        <td><small>{messageLabel(user.messageStatus)}</small></td><td><div className="account-row-actions">
          <button className="button secondary" disabled={busy} onClick={() => open(user)}>Edit</button>
          <button className="button secondary" disabled={busy || !user.active || !directory.emailEnabled} onClick={() => void send(user)}>{user.confirmed ? "Send recovery" : "Send invitation"}</button>
          <button className="button secondary" disabled={busy || user.id === directory.actorId} onClick={() => void changeStatus(user)}>{user.active ? "Deactivate" : "Reactivate"}</button>
        </div></td></tr>}/>
    <section className="panel account-history"><h2>Recent account history</h2>{directory.history.length ? <ol>{directory.history.map(h => <li key={h.id}><strong>{h.actorName}</strong> · {h.action.replaceAll(".", " ")} · {directory.users.find(u => u.id === h.targetId)?.name ?? "Retained account"}<small>{new Date(h.at).toLocaleString()}</small></li>)}</ol> : <p>No account changes recorded.</p>}</section>
    <RecordModal open={!!editor} title={editor?.id ? "Edit account" : "Invite staff"} onClose={() => { if (!busy) setEditor(null); }}>
      {editor && <form className="account-editor" onSubmit={save}>
        <Field label="Name"><input name="name" required maxLength={100} value={editor.draft.name} disabled={busy} onChange={event => update({ name: event.target.value })}/></Field>
        <Field label="Email" hint={editor.id ? "Email is fixed. Deactivate an incorrect recipient and create the correct invitation." : "The recipient chooses their own password."}><input name="email" type="email" required maxLength={254} readOnly={!!editor.id} disabled={busy} value={editor.email} onChange={event => setEditor({ ...editor, email: event.target.value })}/></Field>
        <fieldset disabled={busy}><legend>Roles</legend><p>Site Personnel cannot hold another role.</p><div className="account-choices">{AUTH_ROLES.map(r => <label key={r}><input type="checkbox" name="roles" value={r} checked={editor.draft.roles.includes(r)} disabled={editor.id === directory.actorId && r === "Administrator"} onChange={event => toggleRole(r, event.target.checked)}/>{r}</label>)}</div></fieldset>
        {editor.draft.roles.includes("Site Personnel") && <fieldset disabled={busy}><legend>Project assignments</legend><p>Zero or more projects. Project setup is available in a later update.</p><div className="account-choices">{directory.projects.map(project => <label key={project.id}><input type="checkbox" name="projectIds" value={project.id} checked={editor.draft.projectIds.includes(project.id)} onChange={event => update({ projectIds: event.target.checked ? [...editor.draft.projectIds, project.id] : editor.draft.projectIds.filter(id => id !== project.id) })}/>{project.name}</label>)}</div>{!directory.projects.length && <p>No projects available for assignment.</p>}</fieldset>}
        <InlineError message={error}/>
        {editor.conflict && <div role="status"><p>The latest account must be reviewed before saving your draft.</p>{(() => {
          const latest = directory.users.find(user => user.id === editor.id);
          return latest ? <><p>Current: {latest.name}; {latest.roles.join(", ")}; {latest.projectIds.length} projects; {latest.active ? "active" : "inactive"}.</p><button className="button secondary" type="button" onClick={() => { retry.current = null; setEditor({ ...editor, version: latest.version, conflict: false }); setError(""); }}>I reviewed the latest account; keep my draft</button></> : <p>The account is no longer available.</p>;
        })()}</div>}
        <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</button><button className="button primary" disabled={busy || editor.conflict || !editor.draft.roles.length}>{busy ? "Saving…" : editor.id ? "Save changes" : "Save invitation"}</button></div>
      </form>}
    </RecordModal>{confirmation}
  </>;
}
