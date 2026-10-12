"use client";

import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useActionFeedback } from "@/src/app-state/action-feedback";
import { BudgetInput } from "@/src/components/ui/BudgetInput";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { money } from "@/src/domain/format";
import { roundMoney } from "@/src/domain/pricing";
import { projectScopes, scopeBudgetFor, scopeRemovalReason, SCOPE_OF_WORK_OPTIONS } from "@/src/domain/scope-budgets";
import { useConfirmation, type ConfirmAction } from "@/src/components/ui/ConfirmDialog";

export function ScopeBudgets({ siteId, editable = false, confirmChange }: { siteId: string; editable?: boolean; confirmChange?: ConfirmAction }) {
  const { snapshot: state } = useDemo();
  const { runAction } = useActionFeedback();
  const [draft, setDraft] = useState({ id: "", name: "", budget: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const ownPrompt = useConfirmation(), confirm = confirmChange || ownPrompt.confirm;
  if (!state) return null;
  const site = state.sites.find(value => value.id === siteId);
  if (!site) return null;
  const scopes = projectScopes(state, siteId), canEdit = editable && ["Administrator", "Project Manager"].includes(state.role);
  const existingScopeName = scopes.find(scope => scope.id === draft.id)?.name;
  const allocated = roundMoney(scopes.reduce((sum, scope) => sum + scope.budget, 0));
  const clear = () => { setDraft({ id: "", name: "", budget: "" }); setError(""); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || pending.current) return;
    pending.current = true;
    setSaving(true);
    setMessage(""); setError("");
    try {
      if (!await confirm(draft.id ? "Save scope changes?" : "Add scope of work?", `${draft.name.trim()} · ${money(Number(draft.budget))} allocated within ${site.name}.`, "Save scope allocation")) return;
      const result = await runAction({ type: "saveProjectScope", id: draft.id || undefined, siteId, name: draft.name, budget: Number(draft.budget) }, { progress: draft.id ? "Saving scope allocation…" : "Adding scope of work…", success: draft.id ? "Scope allocation saved." : "Scope of work added." });
      if (result.ok) { clear(); setMessage(result.message); } else setError(result.message);
    } catch { setError("The scope allocation could not be saved. Try again."); }
    finally { pending.current = false; setSaving(false); }
  };
  const remove = async (scopeId: string) => {
    if (!canEdit || pending.current) return;
    const scope = scopes.find(value => value.id === scopeId);
    if (!scope) return;
    pending.current = true; setSaving(true); setError(""); setMessage("");
    try {
      if (!await confirm("Remove unused scope?", `Remove ${scope.name} from ${site.name}? Its ${money(scope.budget)} allocation will become unallocated. The project budget stays unchanged.`, "Remove scope", true)) return;
      const result = await runAction({ type: "removeProjectScope", siteId, id: scopeId }, { progress: "Removing unused scope…", success: `${scope.name} removed.` });
      if (result.ok) { if (draft.id === scopeId) clear(); setMessage(result.message); } else setError(result.message);
    } catch { setError("The scope could not be removed. Try again."); }
    finally { pending.current = false; setSaving(false); }
  };
  return <section className="scope-budgets" aria-label={`Scope budgets for ${site.name}`}>
    <h3 className="subheading">Scope budgets</h3>
    <p className="helper-note">Allocated to scopes: {money(allocated)} · Unallocated: {money(roundMoney(site.budget - allocated))}</p>
    {scopes.length ? <Register embedded rows={scopes} unit="scopes" resetKey={siteId} headers={<><th>Scope of work</th><th className="numeric">Allocated</th><th className="numeric">Committed</th><th className="numeric">Spent</th><th className="numeric">Available</th>{canEdit && <th>Action</th>}</>} renderRow={scope => {
      const budget = scopeBudgetFor(state, scope.id), blocked = scopeRemovalReason(state, scope.id);
      return <tr key={scope.id}><th scope="row">{scope.name}</th><td className="numeric">{money(budget.allocated)}</td><td className="numeric">{money(budget.committed)}</td><td className="numeric">{money(budget.spent)}</td><td className="numeric">{money(budget.available)}</td>{canEdit && <td><div className="button-row scope-actions"><button className="text-link" type="button" disabled={saving} aria-label={`Edit allocation for ${scope.name}`} onClick={() => { setDraft({ id: scope.id, name: scope.name, budget: String(scope.budget) }); setError(""); setMessage(""); }}>Edit allocation</button><button className="text-link" type="button" disabled={saving || !!blocked} aria-label={`Remove scope ${scope.name}`} onClick={() => void remove(scope.id)}>Remove scope</button></div>{blocked && <small>{blocked}</small>}</td>}</tr>;
    }}/> : <p className="muted">An Administrator must add a funded scope before new requests can be submitted.</p>}
    {canEdit && <form className="scope-budget-form subform" onSubmit={save}>
      <h4>{draft.id ? "Edit scope allocation" : "Add scope of work"}</h4>
      <div className="form-grid">
        <Field label="Scope of work">
          <select name="scopeName" value={draft.name} required disabled={saving} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}>
            <option value="">Choose a scope of work</option>
            {existingScopeName && !SCOPE_OF_WORK_OPTIONS.some(name => name === existingScopeName) && <option value={existingScopeName}>{existingScopeName}</option>}
            {SCOPE_OF_WORK_OPTIONS.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Scope allocation (PHP)"><BudgetInput name="scopeBudget" value={draft.budget} required disabled={saving} onValueChange={budget => setDraft(current => ({ ...current, budget }))}/></Field>
      </div>
      <p className="helper-note">Scope allocations share the project cap. Committed and spent funds stay allocated to their scope.</p>
      <InlineError message={error}/><div className="button-row"><button className="button secondary" disabled={saving}>{saving ? "Saving…" : "Save scope allocation"}</button>{draft.id && <button className="button secondary" type="button" disabled={saving} onClick={clear}>Cancel editing</button>}</div>
    </form>}
    {error && !canEdit && <InlineError message={error}/>}{message && <p className="admin-feedback success" role="status">{message}</p>}
    {!confirmChange && ownPrompt.confirmation}
  </section>;
}
