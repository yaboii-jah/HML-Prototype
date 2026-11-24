"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import type { MonitoringView } from "@/src/domain/monitoring/contracts";
import { mrfStatusLabel } from "@/src/domain/requests/workflow";
import { useMonitoring } from "./useMonitoring";

type ProgressView = MonitoringView<"dashboardProgress">;
const defaults = {};
const stages = [["sourcing", "Sourcing"], ["receipt", "Site receipt"], ["posting", "Stock posting"]] as const;
const labels = {
  unavailable: "No approved lines", "not-started": "Not started",
  partial: "Partial", complete: "Complete",
};

export function DashboardProgress({ projectId, initial }: { projectId: string; initial: ProgressView | null }) {
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [paging, setPaging] = useState({ projectId, page: 1 });
  const page = paging.projectId === projectId ? paging.page : 1;
  const setPage = (next: number) => setPaging({ projectId, page: next });
  const { view, error, refresh } = useMonitoring("dashboardProgress", {
    projectId, status: status === "active" ? undefined : status, search,
    page: page === 1 ? undefined : String(page),
  }, initial, defaults);
  return <section aria-labelledby="dashboard-progress-title">
    <h2 id="dashboard-progress-title">Material request progress</h2>
    <form className="monitoring-filters monitoring-filter-form" onSubmit={event => {
      event.preventDefault();
      setSearch(String(new FormData(event.currentTarget).get("reference") ?? "").trim());
      setPage(1);
    }}>
      <Field label="Requests">
        <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="active">Active</option><option value="all">All</option>
        </select>
      </Field>
      <Field label="MRF number">
        <input name="reference" type="search" maxLength={128} defaultValue={search} />
      </Field>
      <button className="button secondary">Search</button>
    </form>
    {error && <><InlineError message={error} /><button className="button secondary" onClick={refresh}>Retry</button></>}
    {!view && !error && <p role="status">Checking request progress…</p>}
    {view && (view.rows.length > 0 ? <>
      <div className="table-frame progress-register">
        <table role="table" aria-labelledby="dashboard-progress-title"><thead role="rowgroup"><tr role="row">
          <th scope="col" role="columnheader">Request</th><th scope="col" role="columnheader">Project</th><th scope="col" role="columnheader">Review</th>
          {stages.map(([key, label]) => <th scope="col" role="columnheader" key={key}>{label}</th>)}
        </tr></thead><tbody role="rowgroup">
          {view.rows.map(row => <tr role="row" key={row.id} data-progress-request={row.id}>
            <th scope="row" role="rowheader"><Link className="text-link" href={`/requests/${row.id}#request-lifecycle-title`}>{row.ref}</Link></th>
            <td role="cell"><span className="progress-mobile-label" aria-hidden="true">Project</span>{row.project}</td>
            <td role="cell"><span className="progress-mobile-label" aria-hidden="true">Review</span>{mrfStatusLabel(row)}</td>
            {stages.map(([key, label]) => <td role="cell" key={key} data-stage={key}>
              <span className="progress-mobile-label" aria-hidden="true">{label}</span>
              <span>{labels[row[key].state]}</span>
              {row.totalLines > 0 && <small>{row[key].completeLines} of {row.totalLines} {row.totalLines === 1 ? "line" : "lines"}</small>}
            </td>)}
          </tr>)}
        </tbody></table>
      </div>
      <div className="register-footer" aria-label="Request progress pagination">
        <span role="status">Page {view.page} of {view.pages} · {view.total} {view.total === 1 ? "request" : "requests"}</span>
        <div className="register-page-controls">
          <button type="button" className="button secondary" aria-label="Previous request page" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>Previous</button>
          <button type="button" className="button secondary" aria-label="Next request page" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>Next</button>
        </div>
      </div>
    </> : <p className="muted">No requests match these filters.</p>)}
  </section>;
}
