import { roundMoney } from "./pricing.ts";
import { paidTotal, poTotal, requestForPO } from "./selectors.ts";
import type { DemoSnapshot } from "./types.ts";

export const projectScopes = (state: DemoSnapshot, siteId: string) => (state.scopes || []).filter(scope => scope.siteId === siteId);
export const scopeName = (state: DemoSnapshot, scopeId?: string) => state.scopes?.find(scope => scope.id === scopeId)?.name || "Scope not assigned";
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
