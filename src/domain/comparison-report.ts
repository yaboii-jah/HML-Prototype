import { bidLines } from "./bid-reports.ts";
import { roundMoney } from "./pricing.ts";
import { comparableMaterialAmount } from "./comparative-pricing.ts";
import type { BidOffer, BidReport, BidReportData, ComparisonSelections, Item, QuoteLine } from "./types.ts";

export const comparisonOffers = (data: BidReportData) => data.offers.filter(offer => offer.source !== "PO source");
export const materialOffers = (data: BidReportData, offer: BidOffer, item: Item) => bidLines(data, offer.quote).filter(line => line.requestItemId === item.id);

/** Resolve only single offers automatically. Alternatives require the purchaser's choice. */
export function resolveComparisonSelections(data: BidReportData, input: ComparisonSelections = {}): ComparisonSelections {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Review the comparison selections.");
  const offers = comparisonOffers(data);
  if (!offers.length) throw new Error("Finalize at least one PHP supplier bid for the comparison.");
  for (const [quoteId, selections] of Object.entries(input)) {
    const offer = offers.find(value => value.quote.id === quoteId);
    if (!offer || !selections || typeof selections !== "object" || Array.isArray(selections)) throw new Error("A comparison selection refers to an ineligible quotation.");
    for (const [itemId, lineId] of Object.entries(selections)) {
      const item = data.request.items.find(value => value.id === itemId);
      if (!item || typeof lineId !== "string" || !materialOffers(data, offer, item).some(line => line.id === lineId)) throw new Error("A comparison selection does not match its supplier and MRF material.");
    }
  }
  const result: ComparisonSelections = {};
  for (const offer of offers) {
    const chosen: Record<string, string> = {};
    for (const item of data.request.items) {
      const lines = materialOffers(data, offer, item);
      if (!lines.length) continue;
      const selected = input[offer.quote.id]?.[item.id] || (lines.length === 1 ? lines[0].id : "");
      if (!selected) throw new Error(`Choose an alternative for ${offer.supplierName}: ${item.name}.`);
      const line = lines.find(line => line.id === selected);
      if (!line) throw new Error("A selected comparison offer no longer matches this material.");
      if (!(line.conversionFactor > 0) || !Number.isFinite(quotedComparisonPrice(line)) || !Number.isFinite(requiredComparisonAmount(item, line))) throw new Error("Review the comparison unit conversion and material amount.");
      chosen[item.id] = selected;
    }
    result[offer.quote.id] = chosen;
  }
  return result;
}

export const quotedComparisonPrice = (line: QuoteLine) => line.unitPrice / line.conversionFactor;
export const requiredComparisonAmount = (item: Item, line: QuoteLine) => roundMoney(item.quantity * quotedComparisonPrice(line));
export function selectedComparisonLine(report: BidReport, offer: BidOffer, item: Item) {
  return materialOffers(report.data, offer, item).find(line => line.id === report.comparisonSelections?.[offer.quote.id]?.[item.id]);
}
export function comparisonCoverage(report: BidReport, offer: BidOffer) {
  const gaps: string[] = [];
  let total = 0;
  report.data.request.items.forEach((item, index) => {
    const line = selectedComparisonLine(report, offer, item);
    if (!line) gaps.push(`Item ${index + 1}: not quoted`);
    else {
      const amount = report.comparisonRevision === 4 ? comparableMaterialAmount(offer.quote, line, item) : requiredComparisonAmount(item, line);
      if (amount === undefined) throw new Error(`Review VAT treatment for ${offer.supplierName} before generating the comparison.`);
      total += amount;
      const offered = line.quantity * line.conversionFactor;
      if (offered + 0.000001 < item.quantity) gaps.push(`Item ${index + 1}: offered ${offered} of ${item.quantity} ${item.unit}`);
    }
  });
  if (!Number.isFinite(total)) throw new Error("The comparison total exceeds the supported amount.");
  return { total: roundMoney(total), gaps, complete: gaps.length === 0 };
}
