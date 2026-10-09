"use client";

import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { Field } from "@/src/components/ui/Primitives";
import type { PODocument, POFinancial } from "@/src/domain/types";
import type { poFinancialBreakdown } from "@/src/domain/pricing";
import { money } from "@/src/domain/format";

const fields: [keyof PODocument, string][] = [["date", "PO date"], ["vendorName", "Vendor name"], ["vendorAddress", "Vendor address"], ["vendorContact", "Vendor contact"], ["vendorPhone", "Vendor phone"], ["bankName", "Bank name"], ["bankAccountName", "Bank account name"], ["bankAccountNumber", "Bank account number"], ["shipToName", "Ship-to name"], ["shipToAddress", "Ship-to address"], ["shipToContact", "Ship-to contact"], ["shipToPhone", "Ship-to phone"], ["requisitioner", "Requisitioner"], ["terms", "Payment terms"], ["fob", "F.O.B."], ["shippingTerms", "Shipping terms"]];
export function readPoDocument(form: FormData): PODocument {
  return Object.fromEntries(fields.map(([key]) => [key, String(form.get(`poDocument.${key}`) || "").trim()])) as PODocument;
}
export function readPoFinancial(form: FormData): POFinancial {
  return { vatStatus: form.get("vatStatus") === "NON-VAT" ? "NON-VAT" : "VAT", priceBasis: form.get("priceBasis") === "exclusive" ? "exclusive" : "inclusive", vatRate: Number(form.get("vatRate")), ewtGoods: Number(form.get("ewtGoods")), ewtServices: Number(form.get("ewtServices")), ewtMode: form.get("ewtMode") === "manual" ? "manual" : form.get("ewtMode") === "automatic" ? "automatic" : undefined, ewtGoodsManual: form.get("ewtGoodsManual") === "true", ewtServicesManual: form.get("ewtServicesManual") === "true", reviewed: form.get("financialReviewed") === "on" };
}
type FinancialProps = { financial: POFinancial; reviewed: boolean; onReview: (value: boolean) => void; onFinancialChange: (value: POFinancial) => void; breakdown?: ReturnType<typeof poFinancialBreakdown>; allowOverride?: boolean };
export function PoDocumentFields({ document, ...financialProps }: FinancialProps & { document: PODocument }) {
  return <section className="panel"><CollapsibleSection title="Purchase order document">
    <div className="form-grid">{fields.filter(([key]) => !key.startsWith("bank")).map(([key, label]) => <Field key={key} label={label}><input name={`poDocument.${key}`} type={key === "date" ? "date" : "text"} defaultValue={document[key]} /></Field>)}</div>
    <CollapsibleSection title="Bank details" defaultOpen={false}><div className="form-grid">{fields.filter(([key]) => key.startsWith("bank")).map(([key, label]) => <Field key={key} label={label}><input name={`poDocument.${key}`} defaultValue={document[key]}/></Field>)}</div></CollapsibleSection></CollapsibleSection>
    <PoFinancialFields {...financialProps}/>
  </section>;
}

export function PoFinancialFields({ financial, reviewed, onReview, onFinancialChange, breakdown, allowOverride = false }: FinancialProps) {
  const update = (patch: Partial<POFinancial>) => { onReview(false); onFinancialChange({ ...financial, ...patch, reviewed: false }); };
  const manual = financial.ewtMode === "manual";
  const nonVat = financial.vatStatus === "NON-VAT";
  return <CollapsibleSection title="VAT and withholding">
    <p className="helper-note">Accounting confirms the price basis and deductions before approval. This VAT setting replaces source line taxes and tax adjustments. Payments use the net total after EWT.</p>
    <div className="form-grid">
      <Field label="VAT / NON VAT"><select name="vatStatus" value={financial.vatStatus} onChange={event => update({ vatStatus: event.target.value as POFinancial["vatStatus"], ...(event.target.value === "NON-VAT" ? { ewtMode: "automatic", ewtGoods: 0, ewtServices: 0, ewtGoodsManual: false, ewtServicesManual: false } : {}) })}><option value="VAT">VAT</option><option value="NON-VAT">NON VAT</option></select></Field>
      <Field label="Quoted price basis"><select name="priceBasis" value={financial.priceBasis} onChange={event => update({ priceBasis: event.target.value as POFinancial["priceBasis"] })}><option value="inclusive">VAT-inclusive</option><option value="exclusive">VAT-exclusive</option></select></Field>
      <Field label="VAT rate (%)"><input name="vatRate" type="number" min="0" max="100" step="any" value={financial.vatRate} readOnly={nonVat} onChange={event => update({ vatRate: Number(event.target.value) })}/></Field>
      {(["Goods", "Services"] as const).map(category => {
        const key = category === "Goods" ? "ewtGoods" : "ewtServices", flag = category === "Goods" ? "ewtGoodsManual" : "ewtServicesManual";
        const overridden = manual && financial[flag] !== false;
        return <Field key={key} label={`EWT (${category.toLowerCase()})${overridden ? " · Manual" : ""}`}><input name={key} type="number" min="0" step="0.01" readOnly={!allowOverride || nonVat} value={nonVat && financial.ewtMode ? 0 : overridden ? financial[key] : breakdown?.[key] ?? financial[key]} onChange={event => { if (allowOverride && !nonVat) update({ [key]: Number(event.target.value), ewtMode: "manual", ewtGoodsManual: manual ? financial.ewtGoodsManual !== false : false, ewtServicesManual: manual ? financial.ewtServicesManual !== false : false, [flag]: true }); }}/>{breakdown && <small>Calculated: {money(category === "Goods" ? breakdown.calculatedGoods : breakdown.calculatedServices)}</small>}</Field>;
      })}
    </div>
    <input type="hidden" name="ewtMode" value={financial.ewtMode || ""}/><input type="hidden" name="ewtGoodsManual" value={String(manual && financial.ewtGoodsManual !== false)}/><input type="hidden" name="ewtServicesManual" value={String(manual && financial.ewtServicesManual !== false)}/>
    {allowOverride && manual && <p className="helper-note">Manual EWT is retained when prices or quantities change.</p>}
    {(allowOverride || !financial.ewtMode) && <button type="button" className="button secondary" onClick={() => update({ ewtMode: "automatic", ewtGoodsManual: false, ewtServicesManual: false })}>Use calculated EWT</button>}
    <label className="quote-check"><input name="financialReviewed" type="checkbox" checked={reviewed} onChange={event => onReview(event.target.checked)}/> I reviewed the VAT basis, source taxes and both EWT amounts.</label>
    </CollapsibleSection>;
}
