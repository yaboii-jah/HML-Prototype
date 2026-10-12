"use client";

import { Field } from "@/src/components/ui/Primitives";
import { quoteFinancialBreakdown, defaultQuotationFinancial } from "@/src/domain/pricing";
import { money } from "@/src/domain/format";
import type { Quote, QuotationFinancial } from "@/src/domain/types";
import { quotationReviewMoney, quotationReviewSummary } from "./quotation-review-summary";

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
  return <section id={`quote-${quote.id}-financial`} tabIndex={-1} className="quote-tax-controls" aria-labelledby={`quote-${quote.id}-financial-heading`}>
    <h3 id={`quote-${quote.id}-financial-heading`}>VAT treatment</h3>
    <fieldset disabled={disabled} className="quotation-operation-fields">
      <div className="quote-vat-fields">
      <div className="quote-vat-status-row"><fieldset className="quote-radio-group"><legend>VAT status</legend><div>{(["VAT", "NON-VAT"] as const).map(value => <label key={value}><input type="radio" name={`quote-${quote.id}-vat-status`} aria-label={`Quotation VAT status ${quote.id}: ${value}`} checked={settings.vatStatus === value} value={value} onChange={() => update({ vatStatus: value })}/><span>{value}</span></label>)}</div></fieldset>
      {settings.vatStatus === "VAT" && <Field label="VAT rate (%)"><input aria-label={`Quotation VAT rate ${quote.id}`} type="number" min="0" max="100" step="any" value={Number.isFinite(settings.vatRate) ? settings.vatRate : ""} onChange={event => update({ vatRate: Number(event.target.value) })}/></Field>}</div>
      {settings.vatStatus === "VAT" ? <fieldset className="quote-radio-group quote-price-basis"><legend>Quoted price basis</legend><div>{(["inclusive", "exclusive"] as const).map(value => <label key={value}><input type="radio" name={`quote-${quote.id}-price-basis`} aria-label={`Quotation price basis ${quote.id}: ${value}`} value={value} checked={settings.priceBasis === value} onChange={() => update({ priceBasis: value })}/><span>VAT-{value}</span></label>)}</div><p className="helper-note">{settings.priceBasis === "inclusive" ? "VAT is already included in the supplier’s prices." : "VAT is added to the supplier’s prices."}</p></fieldset> : <p className="helper-note">No VAT or calculated EWT applies to this NON-VAT quotation.</p>}
      </div>
    </fieldset>
  </section>;
}

export function QuotationFinancialConfirmation({ quote, disabled, onChange }: { quote: Quote; disabled: boolean; onChange: (financial: QuotationFinancial) => void }) {
  const settings = quote.financial || defaultQuotationFinancial();
  return <label className="quote-check quote-tax-confirm"><input aria-label={`Confirm quotation VAT ${quote.id}`} type="checkbox" disabled={disabled} checked={quote.financial?.reviewed === true} onChange={event => onChange({ ...settings, reviewed: event.target.checked })}/> I checked the VAT treatment against the quotation.</label>;
}

export function QuotationReviewSummary({ quote, recordedTotal }: { quote: Quote; recordedTotal: number }) {
  const summary = quotationReviewSummary(quote);
  const format = (value: number) => quotationReviewMoney(quote, value);
  const exclusive = quote.financial?.vatStatus === "VAT" && quote.financial.priceBasis === "exclusive";
  return <section className="quote-computation-summary" aria-labelledby={`quote-${quote.id}-computation-heading`}>
    <div className="quote-computation-heading"><h3 id={`quote-${quote.id}-computation-heading`}>Quotation computations</h3><small>{!summary ? "Recorded total" : quote.financial?.reviewed ? "VAT treatment reviewed" : "Draft estimate · VAT review needed"}</small></div>
    {summary ? <dl>
      <div><dt>Materials <small>After item discounts{exclusive ? ", before VAT" : ""}</small></dt><dd>{format(summary.materials)}</dd></div>
      {summary.adjustments.map(({ adjustment, amount, ignored }) => <div className={ignored ? "quote-summary-ignored" : undefined} key={adjustment.id}><dt>{adjustment.label || "Unnamed adjustment"}<small>{ignored ? "Not added separately; VAT settings apply" : adjustment.kind === "discount" ? "Quotation discount" : adjustment.taxable === false ? "Non-taxable service" : "Delivery / other charge"}{exclusive && !ignored && adjustment.taxable !== false ? " · before VAT" : ""}</small></dt><dd>{ignored ? "Not added" : format(amount)}</dd></div>)}
      <div><dt>{quote.financial?.vatStatus === "NON-VAT" ? "VAT" : exclusive ? `VAT added (${quote.financial?.vatRate}%)` : `VAT already included (${quote.financial?.vatRate}%)`}</dt><dd>{quote.financial?.vatStatus === "NON-VAT" ? format(0) : exclusive ? format(summary.vatAdded) : "Included"}</dd></div>
      <div id={`quote-${quote.id}-total`} tabIndex={-1} className="quote-summary-gross"><dt>Quotation total</dt><dd>{format(summary.gross)}</dd></div>
      <div><dt>Estimated EWT · goods (1%)</dt><dd>{format(-summary.ewtGoods)}</dd></div>
      <div><dt>Estimated EWT · services (2%)</dt><dd>{format(-summary.ewtServices)}</dd></div>
      <div className="quote-summary-net"><dt>Estimated supplier payable</dt><dd>{format(summary.net)}</dd></div>
    </dl> : <><div id={`quote-${quote.id}-total`} tabIndex={-1} className="quote-summary-recorded"><span>Quotation total</span><strong>{format(recordedTotal)}</strong></div><p className="helper-note">VAT and EWT treatment has not been reviewed for this quotation. No withholding estimate is shown.</p></>}
    {summary && <details className="quote-summary-help"><summary>How this is calculated</summary><p className="helper-note">Materials include item discounts. Taxable VAT-exclusive amounts receive VAT once; VAT-inclusive amounts already include VAT. Quotation adjustments use the materials subtotal after item discounts.</p><p className="helper-note">EWT is estimated before payment verification: 1% for goods and 2% for taxable services, using amounts before VAT. NON-VAT quotations have no calculated EWT. Quotation discounts reduce the total, but not the goods or services EWT bases.</p></details>}
  </section>;
}
