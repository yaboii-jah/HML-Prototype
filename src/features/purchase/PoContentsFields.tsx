"use client";

import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { useState } from "react";
import { MaterialDetailsModal, MaterialDetailsRow, MaterialDetailsTrigger } from "@/src/components/ui/MaterialDetails";
import { money } from "@/src/domain/format";
import { poLineTotal } from "@/src/domain/pricing";
import { Field } from "@/src/components/ui/Primitives";
import { newId } from "@/src/domain/ids";
import { orderedFor, poSupplierId } from "@/src/domain/selectors";
import { adjustmentClassification } from "@/src/domain/expense-classification";
import type { DemoSnapshot, PO, POAdjustment, POLine } from "@/src/domain/types";

export function PoContentsFields({ state, po, onChange, editSupplier = true }: { state: DemoSnapshot; po: PO; onChange: (po: PO) => void; editSupplier?: boolean }) {
  const { confirm, confirmation } = useConfirmation();
  const [selectedLineId, setSelectedLineId] = useState("");
  const request = state.requests.find(value => value.id === po.mrfId)!;
  const lines = po.lines || [];
  const selectedLine = lines.find(line => line.quoteLineId === selectedLineId);
  const selectedItem = request.items.find(item => item.id === selectedLine?.itemId);
  const editLine = (index: number, patch: Partial<POLine>) => onChange({ ...po, lines: lines.map((line, i) => i === index ? { ...line, ...patch, fixedDiscountConfirmed: false } : line) });
  const editCharge = (id: string, patch: Partial<POAdjustment>) => onChange({ ...po, adjustments: (po.adjustments || []).map(value => value.id === id ? { ...value, ...patch, confirmed: patch.confirmed ?? false } : value) });
  const available = (itemId: string) => Math.max(0, (request.items.find(item => item.id === itemId)?.quantity || 0) - state.pos.filter(value => value.id !== po.id && value.mrfId === po.mrfId && value.status !== "rejected").reduce((sum, value) => sum + orderedFor(state, value, itemId), 0));
  return <>
    <h3 className="subheading">Supplier and materials</h3>
    {editSupplier && <Field label="PO supplier"><select value={poSupplierId(state, po) || ""} onChange={event => { const supplier = state.suppliers.find(value => value.id === event.target.value)!; onChange({ ...po, supplierId: supplier.id, document: po.document && { ...po.document, vendorName: supplier.name, vendorAddress: supplier.location || "", vendorContact: supplier.contact || "", vendorPhone: "", bankName: "", bankAccountName: "", bankAccountNumber: "" } }); }}><option value="" disabled>Choose supplier</option>{state.suppliers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>}
    <p className="helper-note">PO changes keep the original quotation unchanged. Quantities must stay within the linked MRF.</p>
    <div className="qa-bounded-table" tabIndex={0} role="region" aria-label="Editable purchase order materials"><table><thead><tr><th>MRF material</th><th>Quantity</th><th>Unit price</th><th>Discount</th><th>Line total</th><th>Actions</th></tr></thead><tbody>
      {lines.map((line, index) => <MaterialDetailsRow key={line.quoteLineId} onOpen={() => setSelectedLineId(line.quoteLineId)}>
        <td><MaterialDetailsTrigger onClick={() => setSelectedLineId(line.quoteLineId)}>{request.items.find(item => item.id === line.itemId)?.name || "Material details"}</MaterialDetailsTrigger><Field label={`Material ${index + 1}`}><select aria-label={`PO material ${index + 1}`} value={line.itemId} onChange={event => editLine(index, { itemId: event.target.value })}>{request.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field></td>
        <td><Field label="Quantity"><input aria-label={`PO quantity ${index + 1}`} type="number" min="0.000001" max={available(line.itemId)} step="any" value={line.quantity} onChange={event => editLine(index, { quantity: Number(event.target.value) })}/><small>MRF allowance: {available(line.itemId)}</small></Field></td>
        <td><Field label="Unit price"><input aria-label={`PO unit price ${index + 1}`} type="number" min="0.000001" step="any" value={line.unitPrice} onChange={event => editLine(index, { unitPrice: Number(event.target.value) })}/></Field></td>
        <td><Field label="Line discount"><select aria-label={`PO discount ${index + 1}`} value={line.discountType || "none"} onChange={event => editLine(index, { discountType: event.target.value as POLine["discountType"] })}><option value="none">None</option><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></Field>
          {line.discountType && line.discountType !== "none" && <Field label="Discount amount"><input type="number" min="0" max={line.discountType === "percentage" ? 100 : line.quantity * line.unitPrice} step="any" value={line.discountValue || 0} onChange={event => editLine(index, { discountValue: Number(event.target.value) })}/></Field>}
          {line.discountType === "fixed" && <label className="quote-check"><input type="checkbox" checked={line.fixedDiscountConfirmed === true} onChange={event => onChange({ ...po, lines: lines.map((value, i) => i === index ? { ...value, fixedDiscountConfirmed: event.target.checked } : value) })}/> Confirm fixed discount</label>}
        </td><td><strong>{money(poLineTotal(line))}</strong></td>
        <td><button type="button" className="button danger-outline" aria-label={`Remove PO material ${index + 1}`} onClick={async () => { if (await confirm("Remove this PO material?", "This removes the material from the current PO edit. Save the review to apply the change.", "Remove material", true)) onChange({ ...po, lines: lines.filter((_, i) => i !== index) }); }}>Remove</button></td>
      </MaterialDetailsRow>)}
      {!lines.length && <tr><td colSpan={6}>No materials. Add an MRF material to this PO.</td></tr>}
    </tbody></table></div>
    <button type="button" className="button secondary" onClick={() => { const item = request.items.find(value => available(value.id) > 0); if (item) onChange({ ...po, lines: [...lines, { itemId: item.id, quoteLineId: newId("po-line"), quantity: Math.min(1, available(item.id)), unitPrice: 0, discountType: "none", discountValue: 0, fixedDiscountConfirmed: true }] }); }}>Add MRF material</button>
    <Field label="PO notes"><textarea name="notes" value={po.notes} onChange={event => onChange({ ...po, notes: event.target.value })}/></Field>
    <h3 className="subheading">PO charges and deductions</h3>
    {(po.adjustments || []).map(value => <div className="po-adjustment-row" key={value.id}>
      <Field label="Charge label"><input value={value.label} required onChange={event => editCharge(value.id, { label: event.target.value })}/><small>{adjustmentClassification(value.kind)}</small></Field>
      <Field label="Type"><select value={value.kind} onChange={event => editCharge(value.id, { kind: event.target.value as POAdjustment["kind"] })}>{["shipping", "discount", "tax", "other"].map(kind => <option key={kind}>{kind}</option>)}</select></Field>
      <Field label="Calculation"><select value={value.calculation} onChange={event => editCharge(value.id, { calculation: event.target.value as POAdjustment["calculation"] })}><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></Field>
      <Field label="Amount"><input type="number" min="0" max={value.calculation === "percentage" ? 100 : undefined} step="0.01" value={value.value} onChange={event => editCharge(value.id, { value: Number(event.target.value) })}/></Field>
      <label className="quote-check"><input type="checkbox" checked={value.included} onChange={event => editCharge(value.id, { included: event.target.checked })}/> Include</label>
      {value.kind !== "tax" && <label className="quote-check"><input type="checkbox" checked={value.taxable !== false} onChange={event => editCharge(value.id, { taxable: event.target.checked })}/> Taxable</label>}
      <label className="quote-check"><input type="checkbox" checked={value.confirmed} onChange={event => editCharge(value.id, { confirmed: event.target.checked })}/> Confirm</label>
      <button type="button" className="text-link" onClick={async () => { if (await confirm("Remove this charge?", `${value.label || "Unnamed charge"} will be removed from the current PO edit.`, "Remove charge", true)) onChange({ ...po, adjustments: po.adjustments?.filter(charge => charge.id !== value.id) }); }}>Remove charge</button>
    </div>)}
    <button type="button" className="button secondary" onClick={() => onChange({ ...po, adjustments: [...(po.adjustments || []), { id: newId("adjustment"), label: "", kind: "other", calculation: "fixed", value: 0, included: true, taxable: true, confirmed: false }] })}>Add charge or deduction</button>
    <MaterialDetailsModal item={selectedItem} onClose={() => setSelectedLineId("")}>{selectedLine && <div className="data-rows"><div><span>PO quantity</span><strong>{selectedLine.quantity} {selectedItem?.unit}</strong></div><div><span>Unit price</span><strong>{money(selectedLine.unitPrice)}</strong></div><div><span>Discount</span><strong>{selectedLine.discountValue || 0} ({selectedLine.discountType || "none"})</strong></div><div><span>Calculated line total</span><strong>{money(poLineTotal(selectedLine))}</strong></div></div>}</MaterialDetailsModal>
    {confirmation}
  </>;
}
