"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { monitoringParams, parseMonitoringFilters, type MonitoringFilters, type MonitoringView } from "@/src/domain/monitoring/contracts";
import { MonitoringFilterForm } from "./MonitoringFilters";
import { useMonitoring } from "./useMonitoring";
import "./monitoring.css";

const columns = [
  ["Opening balance", "opening"], ["Opening stock added", "openingEntries"], ["Receipts", "receipts"],
  ["Usage", "usage"], ["Transfer dispatch", "dispatch"], ["Corrections", "corrections"], ["Closing balance", "closing"],
] as const;

export function ConsumptionReport({ initial, initialFilters }: {
  initial: MonitoringView<"consumption"> | null; initialFilters: MonitoringFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [project, setProject] = useState(initialFilters.projectId ?? "");
  const [scope, setScope] = useState(initialFilters.scopeId ?? "");
  const [filterError, setFilterError] = useState("");
  const { view, error, refresh, query } = useMonitoring("consumption", filters, initial, initialFilters);
  const projects = view?.projects ?? initial?.projects ?? [];
  const scopes = (view?.scopes ?? initial?.scopes ?? []).filter(item => !project || item.projectId === project);
  return <div className="monitoring-page">
    <PageHeader title="Site inventory" actions={view && !error && <a className="button secondary"
      href={`/api/monitoring/consumption.csv?${query}`}>Download CSV</a>} />
    <nav aria-label="Inventory view" className="button-row monitoring-tabs">
      <Link className="button secondary" href="/inventory">Stock</Link>
      <Link className="button secondary" href="/inventory?view=usage">Usage entries</Link>
      <Link className="button primary" aria-current="page" href="/inventory?view=consumption">Consumption</Link>
    </nav>
    <section aria-labelledby="consumption-title">
      <h2 id="consumption-title">Consumption reconciliation</h2>
      <p className="muted">Balances use Philippine posting dates. Receipt scope filters select materials by origin and show their full pooled balances.</p>
      <MonitoringFilterForm projects={projects} project={project} onProjectChange={value => { setProject(value); setScope(""); }}
        from={initialFilters.from} to={initialFilters.to} error={filterError} onApply={values => {
          const parsed = parseMonitoringFilters("consumption", monitoringParams(values));
          setFilterError(parsed ? "" : "Check the dates and filters. The end date must follow or match the start date.");
          if (parsed) setFilters(parsed);
        }}>
        <Field label="Material"><input name="search" type="search" defaultValue={initialFilters.search} maxLength={4000} /></Field>
        <Field label="Unit"><input name="unit" defaultValue={initialFilters.unit} maxLength={4000} /></Field>
        <Field label="Receipt scope"><select name="scopeId" value={scope} onChange={event => setScope(event.target.value)}>
          <option value="">All receipt scopes</option>
          {scopes.map(item => <option value={item.id} key={item.id}>{item.name}{project ? "" : ` · ${projects.find(p => p.id === item.projectId)?.name ?? "Project"}`}</option>)}
        </select></Field>
      </MonitoringFilterForm>
      {error && <><InlineError message={error}/><button className="button secondary" onClick={refresh}>Retry</button></>}
      {!view && !error && <p role="status">Checking stock movements…</p>}
      {view && <Register rows={view.rows} resetKey={query} unit="materials" empty="No materials match this posting period and filters."
        tableClassName="monitoring-quantity-table"
        headers={<><th scope="col">Material / unit</th><th scope="col">Project</th>{columns.map(([title]) => <th scope="col" key={title}>{title}</th>)}</>}
        renderRow={row => <tr key={row.id}><th scope="row">
          <Link className="text-link" href={`/inventory/${row.projectId}/${row.id}`}>{row.material}</Link><small>{row.unit}</small>
        </th><td>{row.project}</td>{columns.map(([, key]) => <td key={key}>{row[key]}</td>)}</tr>} />}
    </section>
  </div>;
}
