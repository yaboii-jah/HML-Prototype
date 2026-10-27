import { materialId } from "./ids.ts";
import { equivalentStockUnit, rankStockCandidates, stockMaterialsAt } from "./stock-matching.ts";
import type { DemoSnapshot, Item, TransferStockDestination, TransferStockPosting } from "./types.ts";

export function resolveTransferStockPosting(state: DemoSnapshot, siteId: string, item: Item, selection: TransferStockDestination | undefined): { posting: TransferStockPosting; error?: never } | { error: string; posting?: never } {
  const materials = stockMaterialsAt(state, siteId);
  if (selection?.mode === "existing") {
    const target = materials.find(material => material.id === selection.materialId);
    if (!target || !equivalentStockUnit(item.unit, target.unit)) return { error: "Choose current destination inventory with an equivalent unit." };
    if (selection.specificationsConfirmed !== true) return { error: "Confirm the selected inventory has the same specifications, including size, grade, brand and package size where specified." };
    return { posting: { mode: "existing", materialId: target.id, name: target.name, unit: target.unit, specificationsConfirmed: true } };
  }
  if (selection?.mode !== "new") return { error: "Choose destination inventory or create a material for each accepted line." };
  if (materials.some(material => material.id === materialId(item.name, item.unit))) return { error: "This material already exists at the destination. Select its inventory record." };
  const reasonRequired = rankStockCandidates(item, materials).some(material => material.suggested);
  if (typeof selection.reason !== "string" || reasonRequired && selection.reason.trim().length < 5) return { error: "Explain why a separate material is needed despite the suggested matches (at least 5 characters)." };
  return { posting: { mode: "new", materialId: materialId(item.name, item.unit), name: item.name, unit: item.unit, reasonRequired, reason: selection.reason.trim() } };
}

export function validTransferStockPosting(value: TransferStockPosting, item: Item) {
  if (!value || typeof value !== "object" || typeof value.name !== "string" || !value.name.trim() || typeof value.unit !== "string" || !value.unit.trim() || value.materialId !== materialId(value.name, value.unit) || !equivalentStockUnit(item.unit, value.unit)) return false;
  if (value.mode === "existing") return value.specificationsConfirmed === true;
  return value.mode === "new" && value.name === item.name && value.unit === item.unit && typeof value.reasonRequired === "boolean" && typeof value.reason === "string" && (!value.reasonRequired || value.reason.trim().length >= 5);
}
