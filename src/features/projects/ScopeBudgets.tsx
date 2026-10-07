"use client";

import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { money } from "@/src/domain/format";
import { roundMoney } from "@/src/domain/pricing";
import { projectScopes, scopeBudgetFor } from "@/src/domain/scope-budgets";

export function ScopeBudgets({ siteId, editable = false }: { siteId: string; editable?: boolean }) {
  const { snapshot: state, run } = useDemo();
  const [draft, setDraft] = useState({ id: "", name: "", budget: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!state) return null;
  const site = state.sites.find(value => value.id === siteId);
  if (!site) return null;
  const scopes = projectScopes(state, siteId), canEdit = editable && state.role === "Administrator";
  const allocated = roundMoney(scopes.reduce((sum, scope) => sum + scope.budget, 0));
  const clear = () => { setDraft({ id: "", name: "", budget: "" }); setError(""); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await run({ type: "saveProjectScope", id: draft.id || undefined, siteId, name: draft.name, budget: Number(draft.budget) });
      if (result.ok) clear(); else setError(result.message);
    } catch { setError("The scope allocation could not be saved. Try again."); }
    finally { setSaving(false); }
  };
  return <section className="scope-budgets" aria-label={`Scope budgets for ${site.name}`}>
    <h3 className="subheading">Scope budgets</h3>
    <p className="helper-note">Allocated to scopes: {money(allocated)} · Unallocated: {money(roundMoney(site.budget - allocated))}</p>
    {scopes.length ? <div className="table-frame"><table><thead><tr><th>Scope of work</th><th>Allocated</th><th>Committed</th><th>Spent</th><th>Available</th>{canEdit && <th>Action</th>}</tr></thead><tbody>{scopes.map(scope => {
      const budget = scopeBudgetFor(state, scope.id);
      return <tr key={scope.id}><th scope="row">{scope.name}</th><td>{money(budget.allocated)}</td><td>{money(budget.committed)}</td><td>{money(budget.spent)}</td><td>{money(budget.available)}</td>{canEdit && <td><button className="text-link" type="button" disabled={saving} aria-label={`Edit allocation for ${scope.name}`} onClick={() => { setDraft({ id: scope.id, name: scope.name, budget: String(scope.budget) }); setError(""); }}>Edit allocation</button></td>}</tr>;
    })}</tbody></table></div> : <p className="muted">An Administrator must add a funded scope before new requests can be submitted.</p>}
    {canEdit && <form className="scope-budget-form subform" onSubmit={save}>
      <h4>{draft.id ? "Edit scope allocation" : "Add scope of work"}</h4>
      <div className="form-grid"><Field label="Scope name"><input name="scopeName" value={draft.name} required disabled={saving} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></Field><Field label="Scope allocation (PHP)"><input name="scopeBudget" type="number" min="0" step="0.01" value={draft.budget} required disabled={saving} onChange={event => setDraft(current => ({ ...current, budget: event.target.value }))}/></Field></div>
      <p className="helper-note">Scope allocations share the project cap. Committed and spent funds stay allocated to their scope.</p>
      <InlineError message={error}/><div className="button-row"><button className="button secondary" disabled={saving}>{saving ? "Saving…" : "Save scope allocation"}</button>{draft.id && <button className="button secondary" type="button" disabled={saving} onClick={clear}>Cancel editing</button>}</div>
    </form>}
  </section>;
}
