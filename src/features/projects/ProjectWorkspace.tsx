"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { projectCommandAction } from "@/app/(workspace)/projects/actions";
import {
  SCOPE_NAMES,
  formatPhp,
  record,
  type ProjectSummary,
  type ProjectDetail,
  type ProjectScope,
  type ProjectHistory,
  type ProjectDraft,
  type ProjectInput,
  type ProjectResult,
} from "@/src/domain/projects/projects";
import type { AuthRole } from "@/src/domain/auth/session";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { BudgetInput } from "@/src/components/ui/BudgetInput";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";

const subscribe = () => () => {};
const canManage = (role: AuthRole) =>
  role === "Administrator" || role === "Project Manager";
function useProjectOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
  const pending = useRef(false),
    retry = useRef<{ key: string; id: string } | null>(null);
  const run = async (input: ProjectInput): Promise<ProjectResult> => {
    if (pending.current)
      return { ok: false, message: "Wait for the current save." };
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setConflict(false);
    const key = JSON.stringify(input);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    try {
      const result = await projectCommandAction({
        ...input,
        requestId: retry.current.id,
      });
      if (result.ok) {
        setNotice(result.message);
        retry.current = null;
      } else {
        setError(result.message);
        setConflict(!!result.conflict);
      }
      return result;
    } catch {
      const message =
        "The response was interrupted. Retry this request to check its saved outcome.";
      setError(message);
      return { ok: false, message };
    } finally {
      refresh();
      pending.current = false;
      setBusy(false);
    }
  };
  const reviewed = () => {
    setConflict(false);
    setError("");
    retry.current = null;
  };
  return { busy, error, notice, conflict, run, reviewed };
}

function ProjectEditor({
  source,
  latest,
  onClose,
}: {
  source: ProjectSummary | null;
  latest?: ProjectSummary;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>({
    name: source?.name ?? "",
    location: source?.location ?? "",
    code: source?.code ?? "",
    budget: source?.financial?.budget ?? "",
  });
  const [expected, setExpected] = useState(source?.version ?? "");
  const operation = useProjectOperation(),
    { confirm, confirmation } = useConfirmation();
  const stale = !!source && (!latest || expected !== latest.version);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (operation.busy || operation.conflict || stale) return;
    if (
      !(await confirm(
        source ? "Save project changes?" : "Create project?",
        `${draft.name.trim()} / ${draft.location.trim()} / ${formatPhp(draft.budget)}. No documents or Drive folder will be created.`,
        source ? "Save project" : "Create project",
      ))
    )
      return;
    const result = await operation.run(
      source
        ? {
            type: "saveProject",
            projectId: source.id,
            projectVersion: expected,
            ...draft,
          }
        : { type: "createProject", ...draft },
    );
    if (result.ok) onClose();
  };
  return (
    <>
      <RecordModal
        open
        title={source ? "Project settings" : "Add project"}
        onClose={() => {
          if (!operation.busy) onClose();
        }}
      >
        <form onSubmit={save} className="form-stack project-editor">
          <fieldset disabled={operation.busy}>
            <div className="form-grid">
              <Field label="Project name">
                <input
                  name="projectName"
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Location">
                <input
                  name="location"
                  required
                  maxLength={500}
                  value={draft.location}
                  onChange={(e) =>
                    setDraft({ ...draft, location: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Document code"
                hint={
                  source?.codeLocked
                    ? "Locked after document use."
                    : "Unique across projects; editable until document use."
                }
              >
                <input
                  name="documentCode"
                  required
                  maxLength={20}
                  pattern="[A-Z0-9]+(-[A-Z0-9]+)*"
                  readOnly={source?.codeLocked}
                  value={draft.code}
                  onChange={(e) =>
                    setDraft({ ...draft, code: e.target.value.toUpperCase() })
                  }
                />
              </Field>
              <Field
                label="Project budget (PHP)"
                hint="Zero is valid. The budget cannot fall below scope allocations."
              >
                <BudgetInput
                  name="projectBudget"
                  required
                  value={draft.budget}
                  onValueChange={(budget) => setDraft({ ...draft, budget })}
                />
              </Field>
            </div>
          </fieldset>
          <InlineError message={operation.error} />
          {(operation.conflict || stale) && (
            <div role="status">
              <p>
                Your draft is preserved. Latest saved project:{" "}
                {latest?.name ?? "Removed"}; location: {latest?.location}; code:{" "}
                {latest?.code}; budget:{" "}
                {formatPhp(latest?.financial?.budget ?? null)}.
              </p>
              {latest && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setExpected(latest.version);
                    operation.reviewed();
                  }}
                >
                  I reviewed the latest project; keep my draft
                </button>
              )}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={operation.busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={operation.busy || operation.conflict || stale}
            >
              {operation.busy
                ? "Saving…"
                : source
                  ? "Save project"
                  : "Create project"}
            </button>
          </div>
        </form>
      </RecordModal>
      {confirmation}
    </>
  );
}

function ScopeEditor({
  project,
  source,
  onClose,
  removed = false,
}: {
  project: ProjectDetail;
  source: ProjectScope | null;
  onClose: () => void;
  removed?: boolean;
}) {
  const [draft, setDraft] = useState({
    name: source?.name ?? "",
    budget: source?.budget ?? "",
  });
  const [expected, setExpected] = useState({
    project: project.version,
    scope: source?.version ?? "",
  });
  const operation = useProjectOperation(),
    { confirm, confirmation } = useConfirmation();
  const latest = source
    ? project.scopes.find((scope) => scope.id === source.id)
    : null;
  const stale = removed || project.version !== expected.project ||
    (!!source && (!latest || latest.version !== expected.scope));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (operation.busy || operation.conflict || stale) return;
    if (
      !(await confirm(
        source ? "Save scope changes?" : "Add scope of work?",
        `${draft.name} / ${formatPhp(draft.budget)} within ${project.name}.`,
        "Save scope allocation",
      ))
    )
      return;
    const base = {
      projectId: project.id,
      projectVersion: expected.project,
      ...draft,
    };
    const result = await operation.run(
      source
        ? {
            ...base,
            type: "saveScope",
            scopeId: source.id,
            scopeVersion: expected.scope,
          }
        : { ...base, type: "createScope" },
    );
    if (result.ok) onClose();
  };
  return (
    <>
      <RecordModal
        open
        title={source ? "Edit scope allocation" : "Add scope of work"}
        onClose={() => {
          if (!operation.busy) onClose();
        }}
      >
        <form onSubmit={save} className="form-stack scope-editor">
          <fieldset disabled={operation.busy}>
            <Field label="Scope of work">
              <select
                name="scopeName"
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              >
                <option value="">Choose a scope of work</option>
                {source && !SCOPE_NAMES.some((n) => n === source.name) && (
                  <option value={source.name}>{source.name}</option>
                )}
                {SCOPE_NAMES.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Scope allocation (PHP)">
              <BudgetInput
                name="scopeBudget"
                required
                value={draft.budget}
                onValueChange={(budget) => setDraft({ ...draft, budget })}
              />
            </Field>
            <p>
              Total allocations cannot exceed the project budget. Zero is valid.
            </p>
          </fieldset>
          <InlineError message={operation.error} />
          {(operation.conflict || stale) && (
            <div role="status">
              <p>
                Your draft is preserved. Current project budget:{" "}
                {formatPhp(project.financial?.budget ?? null)}; total
                allocations: {formatPhp(project.financial?.allocated ?? null)}.
                {latest &&
                  ` Current scope: ${latest.name}, ${formatPhp(latest.budget ?? null)}.`}
              </p>
              {removed && <p>This project was removed. Your draft cannot be saved.</p>}
              {source && !latest && <p>This scope was removed. Your draft cannot be saved.</p>}
              {!removed && (!source || latest) && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setExpected({
                      project: project.version,
                      scope: latest?.version ?? "",
                    });
                    operation.reviewed();
                  }}
                >
                  I reviewed the latest allocation; keep my draft
                </button>
              )}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={operation.busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={operation.busy || operation.conflict || stale}
            >
              {operation.busy ? "Saving…" : "Save scope allocation"}
            </button>
          </div>
        </form>
      </RecordModal>
      {confirmation}
    </>
  );
}

function ChangeHistory({ history }: { history: ProjectHistory[] }) {
  return (
    <section className="panel project-history">
      <h2>Recent project changes</h2>
      {history.length ? (
        <ol>
          {history.map((event) => {
            const before = record(event.changes.before),
              after = record(event.changes.after);
            const labels: Record<string, string> = {
              name: "Name",
              location: "Location",
              code: "Document code",
              budget: "Budget",
            };
            const display = (key: string, value: unknown) =>
              key === "budget"
                ? formatPhp(typeof value === "string" ? value : null)
                : typeof value === "string"
                  ? value
                  : "Not set";
            return (
              <li key={event.id}>
                <strong>{event.projectName}</strong> ·{" "}
                {event.action.replaceAll(".", " ")}
                <small>
                  {event.actorName} / {event.actorRole} ·{" "}
                  {new Date(event.at).toLocaleString()}
                </small>
                <details>
                  <summary>Change details</summary>
                  <ul>
                    {Object.entries(labels)
                      .filter(([key]) => before?.[key] !== after?.[key])
                      .map(([key, label]) => (
                        <li key={key}>
                          {label}: {display(key, before?.[key])} →{" "}
                          {display(key, after?.[key])}
                        </li>
                      ))}
                  </ul>
                  {typeof event.changes.clearedAssignments === "number" &&
                    event.changes.clearedAssignments > 0 && (
                      <p>
                        {event.changes.clearedAssignments} staff assignments
                        removed.
                      </p>
                    )}
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No changes recorded.</p>
      )}
    </section>
  );
}

export function ProjectDirectoryScreen({
  projects: initialProjects,
  history: initialHistory,
  role,
}: {
  projects: ProjectSummary[];
  history: ProjectHistory[];
  role: AuthRole;
}) {
  const { view } = useFoundationRealtime();
  const projects = view?.kind === "projects" ? view.data.projects : initialProjects;
  const history = view?.kind === "projects" ? view.data.history : initialHistory;
  const [search, setSearch] = useState(""),
    [editor, setEditor] = useState<ProjectSummary | null | undefined>();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const financial = role !== "Site Personnel",
    editable = canManage(role);
  const rows = projects.filter((project) =>
    `${project.name} ${project.location} ${project.code ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description={
          financial
            ? "Shared project setup and scope allocations."
            : "Your assigned projects and scopes of work."
        }
        actions={
          editable && (
            <button
              className="button primary"
              disabled={!hydrated}
              onClick={() => setEditor(null)}
            >
              Add project
            </button>
          )
        }
      />
      <Register
        rows={rows}
        resetKey={search}
        unit="projects"
        empty={
          role === "Site Personnel"
            ? "No assigned projects match this view. An Administrator manages your assignments."
            : "No projects match this view."
        }
        filters={
          <input
            type="search"
            aria-label="Search project directory"
            placeholder="Search project, location or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
        headers={
          <>
            <th>Project</th>
            <th>Location / code</th>
            <th>Scopes</th>
            {financial && (
              <>
                <th className="numeric">Project budget</th>
                <th className="numeric">Allocated to scopes</th>
                <th className="numeric">Unallocated</th>
              </>
            )}
            {editable && <th>Settings</th>}
          </>
        }
        renderRow={(project) => (
          <tr key={project.id} data-project-id={project.id}>
            <td>
              <Link className="table-primary" href={`/projects/${project.id}`}>
                {project.name}
              </Link>
            </td>
            <td>
              {project.location || "Not set"}
              <small>{project.code ?? "Not assigned"}</small>
            </td>
            <td>{project.scopeCount}</td>
            {financial && (
              <>
                <td className="numeric">
                  {formatPhp(project.financial?.budget ?? null)}
                </td>
                <td className="numeric">
                  {formatPhp(project.financial?.allocated ?? null)}
                </td>
                <td className="numeric">
                  {formatPhp(project.financial?.unallocated ?? null)}
                </td>
              </>
            )}
            {editable && (
              <td>
                <button
                  className="button secondary"
                  disabled={!hydrated}
                  onClick={() => setEditor(project)}
                >
                  Project settings
                </button>
              </td>
            )}
          </tr>
        )}
      />
      {financial && <ChangeHistory history={history} />}
      {editor !== undefined && (
        <ProjectEditor
          source={editor}
          latest={projects.find((p) => p.id === editor?.id)}
          onClose={() => setEditor(undefined)}
        />
      )}
    </>
  );
}

export function ProjectDetailScreen({
  project: initialProject,
  history: initialHistory,
  role,
}: {
  project: ProjectDetail;
  history: ProjectHistory[];
  role: AuthRole;
}) {
  const { view } = useFoundationRealtime();
  const current = view?.kind === "project" ? view.data : null;
  const removed = current?.project === null;
  const project = current?.project ?? initialProject;
  const history = current?.history ?? initialHistory;
  const [editing, setEditing] = useState(false),
    [scopeEditor, setScopeEditor] = useState<ProjectScope | null | undefined>();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const operation = useProjectOperation(),
    { confirm, confirmation } = useConfirmation();
  const editable = canManage(role),
    financial = role !== "Site Personnel";
  const removeScope = async (scope: ProjectScope) => {
    if (
      operation.busy ||
      !(await confirm(
        "Remove unused scope?",
        `Remove ${scope.name} and release its allocation? Project budget stays unchanged; history is retained.`,
        "Remove scope",
        true,
      ))
    )
      return;
    await operation.run({
      type: "deleteScope",
      projectId: project.id,
      projectVersion: project.version,
      scopeId: scope.id,
      scopeVersion: scope.version,
    });
  };
  const removeProject = async () => {
    const assignments = project.assignments ?? [];
    if (
      operation.busy ||
      !(await confirm(
        `Delete ${project.name}?`,
        `Delete this unused project and its ${project.scopeCount} scopes. ${assignments.length ? `Clear access for: ${assignments.map((a) => a.name).join(", ")}. Those users must sign in again. ` : ""}Permanent identities and history are retained.`,
        "Delete project",
        true,
      ))
    )
      return;
    await operation.run({
      type: "deleteProject",
      projectId: project.id,
      projectVersion: project.version,
      assignmentIds: assignments.map((a) => a.id),
      clearAssignments: assignments.length > 0,
    });
  };
  const deleteBlocked =
    project.codeLocked ||
    (role === "Project Manager" && (project.assignmentCount ?? 0) > 0);
  return (
    <>
      {removed && <section className="panel" role="status"><h1>Project removed</h1>
        <p>Your open draft is preserved, but this project can no longer be saved.</p>
        <Link href="/projects">Back to projects</Link></section>}
      <div hidden={removed}>
      <Link className="back-link" href="/projects">
        Back to projects
      </Link>
      <PageHeader
        eyebrow="Project setup"
        title={project.name}
        description={`${project.location || "Location not set"} · ${project.code ?? "Code not assigned"}`}
        actions={
          editable && (
            <button
              className="button secondary"
              disabled={!hydrated}
              onClick={() => setEditing(true)}
            >
              Project settings
            </button>
          )
        }
      />
      {financial && (
        <section
          className="metric-strip project-financials"
          aria-label="Project allocation"
        >
          <div>
            <small>Project budget</small>
            <strong>{formatPhp(project.financial?.budget ?? null)}</strong>
          </div>
          <div>
            <small>Allocated to scopes</small>
            <strong>{formatPhp(project.financial?.allocated ?? null)}</strong>
          </div>
          <div>
            <small>Unallocated</small>
            <strong>{formatPhp(project.financial?.unallocated ?? null)}</strong>
          </div>
        </section>
      )}
      <section className="panel project-scope-panel">
        <div className="panel-heading">
          <h2>Scopes of work</h2>
          {editable && (
            <button
              className="button primary"
              disabled={!hydrated || operation.busy}
              onClick={() => setScopeEditor(null)}
            >
              Add scope of work
            </button>
          )}
        </div>
        <Register
          embedded
          rows={project.scopes}
          unit="scopes"
          empty="No scopes have been added."
          headers={
            <>
              <th>Scope of work</th>
              {financial && <th className="numeric">Allocated</th>}
              {editable && <th>Actions</th>}
            </>
          }
          renderRow={(scope) => (
            <tr key={scope.id} data-scope-id={scope.id}>
              <td>{scope.name}</td>
              {financial && (
                <td className="numeric">{formatPhp(scope.budget ?? null)}</td>
              )}
              {editable && (
                <td>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={!hydrated || operation.busy}
                      onClick={() => setScopeEditor(scope)}
                    >
                      Edit allocation
                    </button>
                    <button
                      className="button danger-outline"
                      disabled={!hydrated || operation.busy}
                      onClick={() => void removeScope(scope)}
                    >
                      Remove scope
                    </button>
                  </div>
                </td>
              )}
            </tr>
          )}
        />
      </section>
      <InlineError message={operation.error} />
      {operation.notice && (
        <p role="status" className="project-notice">
          {operation.notice}
        </p>
      )}
      {operation.conflict && (
        <div role="status">
          <p>
            Review the current project and assignments, then retry the removal.
          </p>
          <button className="button secondary" onClick={operation.reviewed}>
            I reviewed the current project
          </button>
        </div>
      )}
      {editable && (
        <section className="panel project-removal">
          <h2>Remove unused project</h2>
          <p>
            {project.codeLocked
              ? "Document use locks this project against deletion."
              : role === "Project Manager" && deleteBlocked
                ? "An Administrator must remove personnel assignments before you can delete this project."
                : "Deletion retains history and permanent user identities. Pending account provisioning blocks deletion."}
          </p>
          {role === "Administrator" && !!project.assignments?.length && (
            <p>
              Assigned personnel:{" "}
              {project.assignments.map((a) => a.name).join(", ")}. Deletion will
              remove only their assignment to this project and require fresh
              sign-in.
            </p>
          )}
          <button
            className="button danger-outline"
            disabled={
              !hydrated || operation.busy || operation.conflict || deleteBlocked
            }
            onClick={() => void removeProject()}
          >
            Delete project
          </button>
        </section>
      )}
      <section className="panel project-unavailable">
        <h2>Documents and operations</h2>
        <p>
          Drive documents, material requests, purchasing, stock and operational
          balances are unavailable while their workflows are migrated.
        </p>
      </section>
      {financial && <ChangeHistory history={history} />}
      </div>
      {editing && (
        <ProjectEditor
          source={project}
          latest={removed ? undefined : project}
          onClose={() => setEditing(false)}
        />
      )}
      {scopeEditor !== undefined && (
        <ScopeEditor
          project={project}
          source={scopeEditor}
          removed={removed}
          onClose={() => setScopeEditor(undefined)}
        />
      )}
      {confirmation}
    </>
  );
}
