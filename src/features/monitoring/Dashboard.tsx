"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { businessDate } from "@/src/domain/business-dates";
import type { MonitoringAction, MonitoringView } from "@/src/domain/monitoring/contracts";
import { useMonitoring } from "./useMonitoring";
import { DashboardProgress } from "./DashboardProgress";
import "./monitoring.css";

const defaults = {};
const businessDayNumber = (date: string) => Date.parse(date) / 86400000;

export function Dashboard({ initial, progress }: {
  initial: MonitoringView<"dashboard"> | null;
  progress: MonitoringView<"dashboardProgress"> | null;
}) {
  const [projectId, setProject] = useState("");
  const { view, error, refresh } = useMonitoring("dashboard", { projectId }, initial, defaults);
  const projects = view?.projects ?? initial?.projects ?? [];
  const name = (id: string) => projects.find(project => project.id === id)?.name ?? "Project";
  const today = businessDayNumber(businessDate());
  function queue(title: string, rows: MonitoringAction[], waiting: boolean) {
    return <section aria-label={title}>
      <h2>{title} <span className="monitoring-count">{rows.length}</span></h2>
      <Register embedded rows={rows} resetKey={projectId} unit={waiting ? "waiting actions" : "ready actions"}
        empty={waiting ? "No queued actions are waiting on prerequisites." : "No actions are ready for your current role."}
        headers={<><th scope="col">Action</th><th scope="col">Project</th><th scope="col">Age</th></>}
        renderRow={action => {
          const days = Math.max(0, today - businessDayNumber(businessDate(action.at)));
          return <tr key={action.key}><th scope="row">
            <Link className="text-link" href={action.href}>{action.label}</Link>
            <small>{action.ref}</small>
            {action.blocker && <small>{action.blocker}</small>}
            {action.flag && <Badge value={action.flag}>{action.flag}</Badge>}
          </th><td>{name(action.projectId)}</td><td>{days === 0 ? "Today" : `${days}d`}</td></tr>;
        }} />
    </section>;
  }
  return <div className="monitoring-page">
    <PageHeader title="Dashboard" description="Follow work assigned to your active role across current projects." />
    <div className="monitoring-filters"><Field label="Project"><select value={projectId} onChange={event => setProject(event.target.value)}>
      <option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></Field></div>
    {error && <div><InlineError message={error}/><button className="button secondary" onClick={refresh}>Retry</button></div>}
    {!view && !error && <p role="status">Checking project work…</p>}
    {view && <>
      <div className="monitoring-queues" id="actions">
        {queue("Ready", view.actions.filter(action => !action.blocker), false)}
        {queue("Waiting", view.actions.filter(action => action.blocker), true)}
      </div>
    </>}
    <DashboardProgress projectId={projectId} initial={progress} />
    {view && <>
      <section aria-labelledby="dashboard-projects"><h2 id="dashboard-projects">Material request overview</h2>
        <Register embedded rows={view.overview} resetKey={projectId} unit="projects" empty="No accessible projects."
          headers={<><th scope="col">Project</th><th scope="col">Draft or returned</th><th scope="col">For review</th><th scope="col">Approved</th></>}
          renderRow={row => <tr key={row.projectId}>
            <th scope="row"><Link className="text-link" href={`/projects/${row.projectId}`}>{name(row.projectId)}</Link></th>
            <td>{row.draft}</td><td>{row.review}</td><td>{row.approved}</td>
          </tr>}/>
      </section>
    </>}
  </div>;
}
