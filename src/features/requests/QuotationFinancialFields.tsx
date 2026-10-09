"use client";

import { Field } from "@/src/components/ui/Primitives";
import { quoteFinancialBreakdown, defaultQuotationFinancial } from "@/src/domain/pricing";
import { money } from "@/src/domain/format";
import type { Quote, QuotationFinancial } from "@/src/domain/types";

export function QuotationFinancialSummary({ quote }: { quote: Quote }) {
  const summary = quoteFinancialBreakdown(quote);
  if (!summary) return <p className="helper-note">VAT treatment not reviewed for this legacy quotation.</p>;
  const format = (value: number) => quote.currency && quote.currency !== "PHP" ? `${quote.currency} ${value.toFixed(2)}` : money(value);
  return <div className="data-rows">
    <div><span>VAT / NON VAT</span><strong>{quote.financial!.vatStatus === "VAT" ? `VAT · ${quote.financial!.vatRate}% · ${quote.financial!.priceBasis}` : "NON VAT"}</strong></div>
    <div><span>Goods / services (before EWT)</span><strong>{format(summary.lines.reduce((sum, value) => sum + value.amount, 0))} / {format(summary.adjustments.filter(value => value.adjustment.kind === "shipping" || value.adjustment.kind === "other").reduce((sum, value) => sum + value.amount, 0))}</strong></div>
    <div><span>Gross quotation value</span><strong>{format(summary.gross)}</strong></div>
    <div><span>Calculated EWT goods / services</span><strong>{format(summary.ewtGoods)} / {format(summary.ewtServices)}</strong></div>
    <div><span>Estimated net payable</span><strong>{format(summary.net)}</strong></div>
  </div>;
}

export function QuotationFinancialFields({ quote, disabled, onChange }: { quote: Quote; disabled: boolean; onChange: (financial: QuotationFinancial) => void }) {
  const settings = quote.financial || defaultQuotationFinancial();
  const update = (patch: Partial<QuotationFinancial>) => onChange({ ...settings, ...patch, reviewed: false });
  return <section id={`quote-${quote.id}-financial`} tabIndex={-1}>
    <h3>VAT and withholding</h3>
    <fieldset disabled={disabled} className="quotation-operation-fields"><div className="form-grid">
      <Field label="VAT / NON VAT"><select aria-label={`Quotation VAT status ${quote.id}`} value={settings.vatStatus} onChange={event => update({ vatStatus: event.target.value as QuotationFinancial["vatStatus"] })}><option value="VAT">VAT</option><option value="NON-VAT">NON VAT</option></select></Field>
      <Field label="Quoted price basis"><select value={settings.priceBasis} onChange={event => update({ priceBasis: event.target.value as QuotationFinancial["priceBasis"] })}><option value="inclusive">VAT-inclusive</option><option value="exclusive">VAT-exclusive</option></select></Field>
      <Field label="VAT rate (%)"><input type="number" min="0" max="100" step="any" value={settings.vatRate} readOnly={settings.vatStatus === "NON-VAT"} onChange={event => update({ vatRate: Number(event.target.value) })}/></Field>
    </div><label className="quote-check"><input aria-label={`Confirm quotation VAT ${quote.id}`} type="checkbox" checked={quote.financial?.reviewed === true} onChange={event => onChange({ ...settings, reviewed: event.target.checked })}/> I reviewed the VAT / NON VAT status and price basis.</label></fieldset>
    <p className="helper-note">VAT settings replace source taxes. EWT uses material totals at 1% and delivery/other services at 2%, excluding VAT. General discounts do not reduce the EWT bases.</p>
    <QuotationFinancialSummary quote={quote}/>
  </section>;
}
