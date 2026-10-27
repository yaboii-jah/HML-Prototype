import { useState } from "react";
import { Field } from "@/src/components/ui/Primitives";
import { materialId } from "@/src/domain/ids";
import { normalizedQuantity } from "@/src/domain/delivery-flow";
import { rankStockCandidates, type StockMaterial } from "@/src/domain/stock-matching";
import type { Item, TransferStockDestination } from "@/src/domain/types";

type InventoryMaterial = StockMaterial & { onHand: number };
type Props = {
  item: Item;
  source: { sourceName: string; unit: string };
  materials: InventoryMaterial[];
  quantity: number;
  value?: TransferStockDestination;
  onChange: (value: TransferStockDestination) => void;
  plannedAddition: (id: string) => number;
  busy: boolean;
};

export function TransferStockPostingField({ item, source, materials, quantity, value, onChange, plannedAddition, busy }: Props) {
  const [search, setSearch] = useState("");
  const ranked = rankStockCandidates(item, materials, search);
  const selected = value?.mode === "existing" ? materials.find(material => material.id === value.materialId) : undefined;
  if (selected && !ranked.some(material => material.id === selected.id)) ranked.push({ ...selected, exact: false, suggested: false, similarity: 0 });
  const hasSuggestions = rankStockCandidates(item, materials).some(material => material.suggested);
  const newId = materialId(item.name, item.unit);
  const exactExists = materials.some(material => material.id === newId);
  const targetId = selected?.id || (value?.mode === "new" ? newId : "");
  return <section className="transfer-stock-choice" data-posting-item={item.id}>
    <h3>{item.name}</h3>
    <div className="stock-specs"><div><small>Source stock</small><strong>{source.sourceName}</strong><span>{source.unit}</span></div><div><small>Destination MRF</small><strong>{item.name}</strong><span>{quantity} {item.unit} accepted</span></div></div>
    <Field label="Search destination inventory"><input aria-label={"Search destination stock for " + item.name} value={search} disabled={busy} placeholder="Search material names" onChange={event => setSearch(event.target.value)}/></Field>
    <Field label="Inventory to credit"><select aria-label={"Destination stock for " + item.name} value={value?.mode === "new" ? "new" : value?.materialId || ""} disabled={busy} onChange={event => {
      if (!event.target.value) return;
      onChange(event.target.value === "new" ? { mode: "new", reason: "" } : { mode: "existing", materialId: event.target.value, specificationsConfirmed: false });
    }}>
      <option value="" disabled>Choose inventory or create a material</option>
      {["Exact description", "Similar names: verify specifications", "Other inventory"].map((label, index) => <optgroup key={label} label={label}>{ranked.filter(material => index === 0 ? material.exact : !material.exact && (index === 1 ? material.suggested : !material.suggested)).map(material => <option key={material.id} value={material.id}>{material.name} ({material.unit}) · {material.onHand} on hand</option>)}</optgroup>)}
      {!exactExists && <option value="new">Create: {item.name} ({item.unit})</option>}
    </select></Field>
    <p className="helper-note">Similar names are suggestions only. Verify size, grade, type, brand and package size where specified. Equivalent unit labels do not convert quantities.</p>
    {selected && value?.mode === "existing" && <label className="stock-check"><input type="checkbox" aria-label={"Confirm destination specifications for " + item.name} checked={value.specificationsConfirmed} disabled={busy} onChange={event => onChange({ ...value, specificationsConfirmed: event.target.checked })}/><span>I verified that {selected.name} ({selected.unit}) has the same specifications as the accepted material.</span></label>}
    {value?.mode === "new" && <Field label={hasSuggestions ? "Reason for a separate material (required)" : "Reason for a separate material (optional)"}><textarea aria-label={"Reason for separate " + item.name} value={value.reason} disabled={busy} minLength={hasSuggestions ? 5 : undefined} onChange={event => onChange({ ...value, reason: event.target.value })}/>{hasSuggestions && <small>Explain the difference from existing suggested stock.</small>}</Field>}
    {targetId && <p className="transfer-stock-balance" aria-live="polite"><strong>{selected?.name || item.name}</strong> · On hand: {selected?.onHand || 0} · This line adds: {quantity} · Balance after this trip: {normalizedQuantity((selected?.onHand || 0) + plannedAddition(targetId))} {selected?.unit || item.unit}</p>}
  </section>;
}
