import { materialId } from "./ids.ts";
import type { DemoSnapshot } from "./types.ts";

// Eligibility only. Never use aliases to group ledger movements or reservations.
const unitGroups = [
  ["pc", "pcs", "piece", "pieces"],
  ...["bag", "sheet", "length", "roll", "pail", "set", "cartridge"].map(unit => [unit, unit + "s"]),
  ["box", "boxes"],
  ["cu.m", "m3", "m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"],
];
const unitAliases = new Map(unitGroups.flatMap(group => group.map(unit => [unit, group[0]] as const)));
const comparableUnit = (unit: string) => { const label = unit.trim().toLowerCase(); return unitAliases.get(label) || label; };
export const equivalentStockUnit = (a: string, b: string) => comparableUnit(a) === comparableUnit(b);
export const normalizedMaterialName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
export type StockMaterial = { id: string; name: string; unit: string };
export const matchingStockDescription = (item: { name: string; unit: string }, name: string, unit: string) => normalizedMaterialName(item.name) === normalizedMaterialName(name) && equivalentStockUnit(item.unit, unit);

export function stockMaterialsAt(state: Pick<DemoSnapshot, "movements">, siteId: string): StockMaterial[] {
  const entries = new Map<string, StockMaterial>();
  for (const movement of state.movements) if (movement.siteId === siteId) {
    const id = materialId(movement.itemName, movement.unit);
    entries.set(id, { id, name: movement.itemName, unit: movement.unit });
  }
  return [...entries.values()];
}

function bigrams(value: string) {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) { const pair = value.slice(i, i + 2); counts.set(pair, (counts.get(pair) || 0) + 1); }
  return counts;
}

// Numbers and specification words remain in the comparison. A score is a search
// aid, never evidence that dimensions, grades, brands, or package sizes agree.
export function stockNameSimilarity(a: string, b: string) {
  const left = normalizedMaterialName(a), right = normalizedMaterialName(b);
  if (left === right) return 1;
  const wordsA = new Set(left.match(/[\p{L}\p{N}]+/gu) || []), wordsB = new Set(right.match(/[\p{L}\p{N}]+/gu) || []);
  const intersection = [...wordsA].filter(word => wordsB.has(word)).length;
  const wordScore = intersection / (wordsA.size + wordsB.size - intersection || 1);
  const pairsA = bigrams(left), pairsB = bigrams(right);
  const common = [...pairsA].reduce((sum, [pair, count]) => sum + Math.min(count, pairsB.get(pair) || 0), 0);
  return Math.max(wordScore, 2 * common / (Math.max(0, left.length - 1) + Math.max(0, right.length - 1) || 1));
}

export function rankStockCandidates<T extends StockMaterial>(item: { name: string; unit: string }, materials: readonly T[], search = "") {
  const query = normalizedMaterialName(search);
  return materials.filter(material => equivalentStockUnit(item.unit, material.unit) && (!query || normalizedMaterialName(material.name + " " + material.unit).includes(query)))
    .map(material => ({ ...material, exact: matchingStockDescription(item, material.name, material.unit), similarity: stockNameSimilarity(item.name, material.name) }))
    .map(material => ({ ...material, suggested: material.similarity >= 0.6 }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
