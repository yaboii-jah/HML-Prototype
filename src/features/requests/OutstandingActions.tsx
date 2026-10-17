"use client";
import Link from "next/link";
import { useDemo } from "@/src/app-state/DemoProvider";
import { canActOnWorkflowAction, workflowActions, type WorkflowAction } from "@/src/domain/workflow-actions";
import { ROLES, type DemoSnapshot } from "@/src/domain/types";
import { roleLabel } from "@/src/domain/format";
import { siteName } from "@/src/domain/selectors";

export function OutstandingActions({ state, requestId, actions }: { state: DemoSnapshot; requestId: string; actions?: readonly WorkflowAction[] }) {
  const { access, session, siteIds } = useDemo();
  const rows = actions || workflowActions(state, requestId);
  return <section className="outstanding-actions" aria-label="Outstanding actions"><h3>Outstanding actions · {rows.length}</h3><p className="helper-note">Departments can work in parallel. A blocker applies to the action beside it.</p>{rows.length ? ROLES.map(role => {
    const group = rows.filter(a => a.department === role);
    return group.length ? <section key={role} className="action-department"><h4>{roleLabel(role)}</h4><ul>{group.map(a => <li key={a.id}><div><strong>{a.label}</strong><small>{siteName(state, a.siteId)} · {a.detail}</small>{a.blocker && <p className="action-blocker">Blocked: {a.blocker}</p>}</div>{canActOnWorkflowAction(a, session.role, siteIds) && access.canOpen(a.href) ? <Link className="button secondary" href={a.href}>Open action</Link> : access.canOpen(a.href) ? <Link className="text-link" href={a.href}>View record</Link> : <span className="muted">Awaiting {roleLabel(role)}</span>}</li>)}</ul></section> : null;
  }) : <p className="muted">No outstanding actions for the current records.</p>}</section>;
}
