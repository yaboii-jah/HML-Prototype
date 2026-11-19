"use client";

import type { ReactNode } from "react";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import type { MonitoringFilters } from "@/src/domain/monitoring/contracts";

export function MonitoringFilterForm({ projects, project, onProjectChange, from, to, children, error, onApply }: {
  projects: { id: string; name: string }[]; project: string; onProjectChange: (project: string) => void;
  from?: string; to?: string; children?: ReactNode; error?: string; onApply: (values: MonitoringFilters) => void;
}) {
  return <form className="monitoring-filter-form" onSubmit={event => {
    event.preventDefault();
    onApply(Object.fromEntries(new FormData(event.currentTarget)) as MonitoringFilters);
  }}>
    <div className="monitoring-filters">
      <Field label="Project"><select name="projectId" value={project} onChange={event => onProjectChange(event.target.value)}>
        <option value="">All projects</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field label="From (PH)"><input name="from" type="date" defaultValue={from} /></Field>
      <Field label="Through (PH)"><input name="to" type="date" defaultValue={to} /></Field>
      {children}
      <button type="submit" className="button primary">Apply filters</button>
    </div>
    <InlineError message={error} />
  </form>;
}
