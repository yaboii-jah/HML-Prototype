import { businessDate, businessRangeError } from "./business-dates.ts";
import { normalizedQuantity as q } from "./delivery-flow.ts";
import { materialId } from "./ids.ts";
import type { DemoSnapshot, Movement } from "./types.ts";

export type ConsumptionFilters = { from: string; to: string; projectIds: readonly string[]; search?: string; unit?: string };
export type ConsumptionRow = {
  id: string; siteId: string; project: string; name: string; unit: string;
  opening: number | null; added: number; used: number; transferredOut: number; adjustments: number; closing: number | null;
  openingEntries: number; receipts: number; transfersIn: number; undated: number; movements: Movement[];
};

/** A read-only period projection; grouped usage metadata never adds a second deduction. */
export function consumptionRows(state: DemoSnapshot, filters: ConsumptionFilters): ConsumptionRow[] {
  if (businessRangeError(filters.from, filters.to)) return [];
  const projects = new Map(state.sites.filter(s => filters.projectIds.includes(s.id)).map(s => [s.id, s.name]));
  const rows = new Map<string, ConsumptionRow>();
  for (const m of state.movements) {
    const project = projects.get(m.siteId);
    if (!project) continue;
    const day = typeof m.at === "string" && m.at ? businessDate(m.at) : "";
    if (day && filters.to && day > filters.to) continue;
    const id = materialId(m.itemName, m.unit), key = `${m.siteId}/${id}`;
    let row = rows.get(key);
    if (!row) { row = { id, siteId: m.siteId, project, name: m.itemName, unit: m.unit, opening: 0, added: 0, used: 0, transferredOut: 0, adjustments: 0, closing: 0, openingEntries: 0, receipts: 0, transfersIn: 0, undated: 0, movements: [] }; rows.set(key, row); }
    if (!day) { row.undated++; row.movements.push(m); continue; }
    if (filters.from && day < filters.from) { row.opening = q(row.opening! + m.quantity); continue; }
    row.movements.push(m);
    if (m.kind === "opening") row.openingEntries = q(row.openingEntries + m.quantity);
    else if (m.kind === "receipt") row.receipts = q(row.receipts + m.quantity);
    else if (m.kind === "transfer-in") row.transfersIn = q(row.transfersIn + m.quantity);
    else if (m.kind === "usage") row.used = q(row.used - m.quantity);
    else if (m.kind === "transfer-out") row.transferredOut = q(row.transferredOut - m.quantity);
    else row.adjustments = q(row.adjustments + m.quantity);
  }
  const search = filters.search?.trim().toLowerCase() || "";
  return [...rows.values()].filter(row => (!filters.unit || row.unit.trim().toLowerCase() === filters.unit.trim().toLowerCase()) && (!search || `${row.name} ${row.project} ${row.unit}`.toLowerCase().includes(search))).map(row => {
    row.added = q(row.openingEntries + row.receipts + row.transfersIn);
    row.closing = q(row.opening! + row.added - row.used - row.transferredOut + row.adjustments);
    if (row.undated) { row.opening = null; row.closing = null; }
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name) || a.project.localeCompare(b.project) || a.unit.localeCompare(b.unit));
}

const csvText = (value: string) => '"' + (/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
export function consumptionCsv(rows: readonly ConsumptionRow[], from: string, to: string): string {
  const headers = ["Project", "Material", "Unit", "From", "To", "Opening balance", "Stock added", "Used", "Transferred out", "Adjustments", "Closing balance", "Opening entries", "Receipts", "Transfers in", "Balance status"];
  const lines = rows.map(r => [csvText(r.project), csvText(r.name), csvText(r.unit), csvText(from), csvText(to), r.opening ?? "", r.added, r.used, r.transferredOut, r.adjustments, r.closing ?? "", r.openingEntries, r.receipts, r.transfersIn, csvText(r.undated ? `Incomplete: ${r.undated} undated movements` : "Complete")].join(","));
  return "\uFEFF" + headers.map(csvText).join(",") + "\r\n" + lines.join("\r\n");
}
