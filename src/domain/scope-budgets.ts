import { roundMoney } from "./pricing.ts";
import { budgetFor, paidTotal, poTotal, requestForPO } from "./selectors.ts";
import type { DemoSnapshot } from "./types.ts";

export const SCOPE_OF_WORK_OPTIONS = [
  "General Requirement",
  "Structural Works",
  "Civil Works",
  "Architectural",
  "Mechanical",
  "Electrical",
  "Plumbing & Sanitary",
  "Fire Protection",
  "Medical Gas",
  "Variation Order",
] as const;

export const projectScopes = (state: DemoSnapshot, siteId: string) => (state.scopes || []).filter(scope => scope.siteId === siteId);
export const scopeName = (state: DemoSnapshot, scopeId?: string) => state.scopes?.find(scope => scope.id === scopeId)?.name || "Scope not assigned";
export function projectMinimumBudget(state: DemoSnapshot, siteId: string) {
  const budget = budgetFor(state, siteId);
  return roundMoney(Math.max(projectScopes(state, siteId).reduce((sum, scope) => sum + scope.budget, 0), budget.committed + budget.spent));
}
export function scopeRemovalReason(state: DemoSnapshot, scopeId: string) {
  if (!state.scopes?.some(scope => scope.id === scopeId)) return "Scope not found.";
  return state.requests.some(request => request.scopeId === scopeId) ? "This scope is used by an MRF and must remain available for its linked history." : "";
}
export function scopeBudgetFor(state: DemoSnapshot, scopeId: string) {
  const scope = state.scopes?.find(value => value.id === scopeId);
  const pos = scope ? state.pos.filter(po => ["approved", "released"].includes(po.status) && requestForPO(state, po)?.scopeId === scope.id && requestForPO(state, po)?.siteId === scope.siteId) : [];
  const allocated = scope?.budget || 0;
  const committed = roundMoney(pos.reduce((sum, po) => sum + Math.max(0, poTotal(state, po) - paidTotal(state, po.id)), 0));
  const spent = roundMoney(pos.reduce((sum, po) => sum + paidTotal(state, po.id), 0));
  return { allocated, committed, spent, available: roundMoney(allocated - committed - spent) };
}
export function scopeValidationError(state: DemoSnapshot, siteId: string, scopeId?: string, checkFunds = true) {
  if (!scopeId || !state.scopes?.some(scope => scope.id === scopeId && scope.siteId === siteId)) return "Choose a scope of work belonging to this project.";
  if (checkFunds && scopeBudgetFor(state, scopeId).available <= 0) return "This scope has no remaining budget. Ask an Administrator to review its allocation.";
  return "";
}
