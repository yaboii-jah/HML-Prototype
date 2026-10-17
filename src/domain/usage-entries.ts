import { auditRecords, copyIdentity, validIdentity } from "./audit.ts";
import type { CommandContext, CommandResult } from "./commands.ts";
import { materialId } from "./ids.ts";
import { inventoryFor } from "./selectors.ts";
import { sourceStockAvailable } from "./stock-transfers.ts";
import type { DemoSnapshot } from "./types.ts";

export type RecordUsageEntry = {
  type: "recordUsageEntry";
  entryId: string;
  siteId: string;
  reason: string;
  lines: { materialId: string; quantity: number; reason?: string }[];
};

/** Shared by review and commit; commit always checks the current snapshot again. */
export function usageEntryErrors(state: DemoSnapshot, command: RecordUsageEntry) {
  const rows: Record<string, string> = Object.create(null);
  const materials = new Map(inventoryFor(state, command.siteId).map(item => [item.id, item]));
  const seen = new Set<string>();
  for (const line of command.lines) {
    const item = materials.get(line.materialId);
    if (seen.has(line.materialId)) rows[line.materialId] = "Include each material only once.";
    else if (!item) rows[line.materialId] = "This material is no longer in project inventory. Remove it from the draft.";
    else if (!Number.isFinite(line.quantity) || line.quantity <= 0) rows[line.materialId] = "Enter a positive quantity used.";
    else if (line.reason?.trim() && line.reason.trim().length < 5) rows[line.materialId] = "Use at least five characters for the material explanation.";
    else if (line.quantity > sourceStockAvailable(state, command.siteId, item.name, item.unit)) rows[line.materialId] = "Quantity exceeds available stock. Reserved stock cannot be used.";
    seen.add(line.materialId);
  }
  return rows;
}

/** Called with applyCommand's private clone; no mutation occurs until every row passes. */
export function applyUsageEntry(state: DemoSnapshot, command: RecordUsageEntry, ctx: CommandContext): CommandResult {
  const actor = ctx.actor;
  if (!actor || !validIdentity(actor) || actor.role !== "Site Personnel") return { ok: false, message: "Sign in as Site Personnel to record usage." };
  if (!ctx.siteIds?.includes(command.siteId)) return { ok: false, message: "Ask an Administrator to assign your account to this project before recording usage." };
  if (!state.sites.some(site => site.id === command.siteId)) return { ok: false, field: "siteId", message: "Choose a current assigned project." };
  if (command.entryId === "new" || !/^[a-zA-Z0-9-]{1,100}$/.test(command.entryId)) return { ok: false, message: "This draft has an invalid entry ID. Discard it and start again." };
  if (command.reason.trim().length < 5) return { ok: false, field: "reason", message: "Explain the usage in at least five characters." };
  if (!command.lines.length) return { ok: false, message: "Enter a quantity used for at least one material." };

  // Compare saved content before availability: a retry must work after stock was consumed.
  const existing = state.usageEntries?.find(entry => entry.id === command.entryId);
  if (existing) {
    const saved = state.movements.filter(m => existing.movementIds.includes(m.id)).map(m => ({ materialId: materialId(m.itemName, m.unit), quantity: -m.quantity, reason: m.reason })).sort((a, b) => a.materialId.localeCompare(b.materialId));
    const incoming = command.lines.map(line => ({ materialId: line.materialId, quantity: line.quantity, reason: line.reason?.trim() || command.reason.trim() })).sort((a, b) => a.materialId.localeCompare(b.materialId));
    if (existing.siteId !== command.siteId || existing.reason !== command.reason.trim() || existing.actorIdentity.email !== actor.email || existing.actorIdentity.userId !== actor.userId || JSON.stringify(saved) !== JSON.stringify(incoming)) return { ok: false, message: "This entry ID was already used with different content. Open the saved entry or start a new draft." };
    return { ok: true, snapshot: state, recordId: existing.id, message: "Usage entry already recorded." };
  }
  if (auditRecords(state).has(command.entryId) || state.activity.some(a => a.entity === command.entryId)) return { ok: false, message: "This entry ID is already in use. Start a new draft." };
  const rowErrors = usageEntryErrors(state, command);
  if (Object.keys(rowErrors).length) return { ok: false, message: "Review the highlighted materials. No usage was recorded.", rowErrors };

  const at = ctx.now(), identity = copyIdentity(actor)!;
  const materials = inventoryFor(state, command.siteId);
  const movements = command.lines.map(line => {
    const item = materials.find(value => value.id === line.materialId)!;
    return { id: ctx.id("mov"), siteId: command.siteId, itemName: item.name, unit: item.unit, quantity: -line.quantity, kind: "usage" as const, usageEntryId: command.entryId, reason: line.reason?.trim() || command.reason.trim(), actor: "Site Personnel" as const, actorIdentity: copyIdentity(identity), at };
  });
  state.movements.push(...movements);
  (state.usageEntries ||= []).push({ id: command.entryId, siteId: command.siteId, reason: command.reason.trim(), movementIds: movements.map(m => m.id), actor: "Site Personnel", actorIdentity: identity, at });
  state.activity.unshift({ id: ctx.id("act"), entity: command.entryId, action: "Material usage recorded", reason: command.reason.trim(), actor: "Site Personnel", actorIdentity: copyIdentity(identity), at, eventType: "stock.changed", entityType: "usage-entry", entityRef: "Usage entry", projectId: command.siteId });
  return { ok: true, snapshot: state, recordId: command.entryId, message: "Usage entry recorded." };
}

/** Omitted collections remain compatible; malformed linked entries trigger recovery. */
export function validUsageEntries(state: DemoSnapshot): boolean {
  if (state.usageEntries === undefined) return !state.movements.some(m => m.usageEntryId !== undefined);
  if (!Array.isArray(state.usageEntries)) return false;
  const ids = new Set<string>(), linked = new Set<string>();
  for (const entry of state.usageEntries) {
    if (!entry || typeof entry.id !== "string" || entry.id === "new" || !/^[a-zA-Z0-9-]{1,100}$/.test(entry.id) || ids.has(entry.id) || !state.sites.some(s => s.id === entry.siteId) || typeof entry.reason !== "string" || entry.reason.trim().length < 5 || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at)) || entry.actor !== "Site Personnel" || !entry.actorIdentity || !validIdentity(entry.actorIdentity) || entry.actorIdentity.role !== entry.actor || !Array.isArray(entry.movementIds) || !entry.movementIds.length) return false;
    ids.add(entry.id);
    const materials = new Set<string>();
    for (const id of entry.movementIds) {
      const m = state.movements.find(value => value.id === id);
      if (!m || linked.has(id) || m.usageEntryId !== entry.id || m.siteId !== entry.siteId || m.kind !== "usage" || !Number.isFinite(m.quantity) || m.quantity >= 0 || typeof m.reason !== "string" || m.reason.trim().length < 5 || m.at !== entry.at || m.actor !== entry.actor || JSON.stringify(m.actorIdentity) !== JSON.stringify(entry.actorIdentity) || materials.has(materialId(m.itemName, m.unit))) return false;
      linked.add(id); materials.add(materialId(m.itemName, m.unit));
    }
  }
  return state.movements.every(m => m.usageEntryId === undefined || ids.has(m.usageEntryId) && linked.has(m.id));
}
