"use client";

import Link from "next/link";
import { useState } from "react";
import { InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { Register, ViewTabs } from "@/src/components/ui/Register";
import { monitoringParams, parseMonitoringFilters, type MonitoringFilters, type MonitoringView } from "@/src/domain/monitoring/contracts";
import { MonitoringFilterForm } from "./MonitoringFilters";
import { useMonitoring } from "./useMonitoring";
import "./monitoring.css";

const sections = ["Recorded activity", "Current exceptions", "Current site stock", "Budgets and payments"];
const defaults = {};
const financial = [
  ["Allocated", "allocated"], ["Committed", "committed"], ["Spent", "spent"], ["Available", "available"],
  ["Verified paid", "paid"], ["Outstanding Credit", "credit"], ["Overdue Credit", "overdue"],
] as const;

function peso(value: string | null) {
  if (value === null) return "—";
  const [whole, fraction = ""] = value.split(".");
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

export function OperationsReports({ initial }: { initial: MonitoringView<"reports"> | null }) {
  const [project, setProject] = useState("");
  const [active, setActive] = useState(0);
  const [filters, setFilters] = useState<MonitoringFilters>(defaults);
  const [filterError, setFilterError] = useState("");
  const { view, error, refresh, query } = useMonitoring("reports", filters, initial, defaults);
  const projects = view?.projects ?? initial?.projects ?? [];
  const name = (id: string) => projects.find(project => project.id === id)?.name ?? "Project";
  return <div className="monitoring-page">
    <PageHeader title="Operations reports" description="Project activity, current stock, exceptions and financial balances." />
    <MonitoringFilterForm projects={projects} project={project} onProjectChange={setProject} error={filterError} onApply={values => {
      const parsed = parseMonitoringFilters("reports", monitoringParams(values));
      setFilterError(parsed ? "" : "Choose a valid date range.");
      if (parsed) setFilters(parsed);
    }} />
    <p className="muted">Dates filter recorded activity. Current balances and exceptions reflect the latest records for the selected projects.</p>
    <ViewTabs labels={sections} active={active} onChange={setActive} id="operations-report" />
    {error && <><InlineError message={error}/><button className="button secondary" onClick={refresh}>Retry</button></>}
    {!view && !error && <p role="status">Checking operations records…</p>}
    {view && <section role="tabpanel" id={`operations-report-panel-${active}`} aria-labelledby={`operations-report-tab-${active}`}>
      {active === 0 && <Register rows={view.activity} resetKey={query} unit="activity totals" empty="No activity was recorded for this selection."
        headers={<><th scope="col">Activity</th><th scope="col">Project</th><th scope="col">Count</th></>}
        renderRow={row => <tr key={row.projectId + row.label}><th scope="row">{row.label}</th><td>{name(row.projectId)}</td><td>{row.total}</td></tr>} />}
      {active === 1 && <Register rows={view.exceptions} resetKey={query} unit="exceptions" empty="There are no open exceptions for these projects."
        headers={<><th scope="col">Exception</th><th scope="col">Project</th><th scope="col">Record</th></>}
        renderRow={row => <tr key={row.href + row.ref + row.label}><th scope="row">{row.label}</th><td>{name(row.projectId)}</td>
          <td><Link className="text-link" href={row.href}>{row.ref}</Link></td></tr>} />}
      {active === 2 && <Register rows={view.balances} resetKey={query} unit="materials" empty="No site stock records are available for these projects."
        headers={<><th scope="col">Material / unit</th><th scope="col">Project</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th></>}
        renderRow={row => <tr key={row.accountId}><th scope="row"><Link className="text-link" href={`/inventory/${row.projectId}/${row.accountId}`}>{row.description}</Link>
          <small>{row.unit}</small></th><td>{name(row.projectId)}</td><td>{row.onHand}</td><td>{row.reserved}</td><td>{row.available}</td></tr>} />}
      {active === 3 && <Register rows={view.financial} resetKey={query} unit="projects" empty="No projects match this selection."
        tableClassName="monitoring-quantity-table"
        headers={<><th scope="col">Project</th>{financial.map(([title]) => <th scope="col" key={title}>{title}</th>)}
          <th scope="col">Unsettled POs</th><th scope="col">Uncleared POs</th></>}
        renderRow={row => <tr key={row.projectId}><th scope="row"><Link className="text-link" href={`/projects/${row.projectId}`}>{name(row.projectId)}</Link></th>
          {financial.map(([, key]) => <td key={key}>{peso(row[key])}</td>)}<td>{row.unsettled}</td><td>{row.uncleared}</td></tr>} />}
    </section>}
  </div>;
}
