"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/src/components/ui/CollapsibleSection";
import { Field } from "@/src/components/ui/Primitives";
import type { PODocument, POFinancial } from "@/src/domain/types";

const fields: [keyof PODocument, string][] = [["date", "PO date"], ["vendorName", "Vendor name"], ["vendorAddress", "Vendor address"], ["vendorContact", "Vendor contact"], ["vendorPhone", "Vendor phone"], ["bankName", "Bank name"], ["bankAccountName", "Bank account name"], ["bankAccountNumber", "Bank account number"], ["shipToName", "Ship-to name"], ["shipToAddress", "Ship-to address"], ["shipToContact", "Ship-to contact"], ["shipToPhone", "Ship-to phone"], ["requisitioner", "Requisitioner"], ["terms", "Payment terms"], ["fob", "F.O.B."], ["shippingTerms", "Shipping terms"]];
export function readPoDocument(form: FormData): PODocument {
  return Object.fromEntries(fields.map(([key]) => [key, String(form.get(`poDocument.${key}`) || "").trim()])) as PODocument;
}
export function readPoFinancial(form: FormData): POFinancial {
  return { vatStatus: form.get("vatStatus") === "NON-VAT" ? "NON-VAT" : "VAT", priceBasis: form.get("priceBasis") === "exclusive" ? "exclusive" : "inclusive", vatRate: Number(form.get("vatRate")), ewtGoods: Number(form.get("ewtGoods")), ewtServices: Number(form.get("ewtServices")), reviewed: form.get("financialReviewed") === "on" };
}
export function PoDocumentFields({ document, financial, reviewed, onReview }: { document: PODocument; financial: POFinancial; reviewed: boolean; onReview: (value: boolean) => void }) {
  const [vatStatus, setVatStatus] = useState(financial.vatStatus);
  return <section className="panel"><CollapsibleSection title="Purchase order document">
    <div className="form-grid">{fields.filter(([key]) => !key.startsWith("bank")).map(([key, label]) => <Field key={key} label={label}><input name={`poDocument.${key}`} type={key === "date" ? "date" : "text"} defaultValue={document[key]} /></Field>)}</div>
    <CollapsibleSection title="Bank details" defaultOpen={false}><div className="form-grid">{fields.filter(([key]) => key.startsWith("bank")).map(([key, label]) => <Field key={key} label={label}><input name={`poDocument.${key}`} defaultValue={document[key]}/></Field>)}</div></CollapsibleSection></CollapsibleSection>
    <CollapsibleSection title="VAT and withholding">
    <p className="helper-note">Review the supplier&apos;s price basis. This VAT setting replaces inherited quotation line taxes and tax adjustments. Enter both EWT deductions, including zero where applicable. Finance and payments use the net total after EWT.</p>
    <div className="form-grid">
      <Field label="VAT status"><select name="vatStatus" value={vatStatus} onChange={event => setVatStatus(event.target.value as POFinancial["vatStatus"])}><option>VAT</option><option>NON-VAT</option></select></Field>
      <Field label="Quoted price basis"><select name="priceBasis" defaultValue={financial.priceBasis}><option value="inclusive">VAT-inclusive</option><option value="exclusive">VAT-exclusive</option></select></Field>
      <Field label="VAT rate (%)"><input name="vatRate" type="number" min="0" max="100" step="any" defaultValue={financial.vatRate} readOnly={vatStatus === "NON-VAT"}/></Field>
      <Field label="EWT (goods)"><input name="ewtGoods" type="number" min="0" step="0.01" defaultValue={financial.ewtGoods}/></Field>
      <Field label="EWT (services)"><input name="ewtServices" type="number" min="0" step="0.01" defaultValue={financial.ewtServices}/></Field>
    </div>
    <label className="quote-check"><input name="financialReviewed" type="checkbox" checked={reviewed} onChange={event => onReview(event.target.checked)}/> I reviewed the VAT basis, source taxes and both EWT amounts.</label>
    </CollapsibleSection>
  </section>;
}
