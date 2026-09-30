import { bidLines, bidQuoteTotal } from "./bid-reports.ts";
import { quoteLineTotal } from "./pricing.ts";
import type { BidOffer, BidReport, Item, QuoteLine } from "./types.ts";

export const COMPARISON_COLORS = ["FFF2CC", "CFE2F3", "D9EAD3", "EA9999", "C9DAF8", "EAD1DC", "B4A7D6", "EA9999", "FFF2CC", "CFE2F3", "D9EAD3"];
export type ComparisonRow = { item: Item; number: number; first: boolean; lines: (QuoteLine | undefined)[] };
export type ComparisonPage = { offers: BidOffer[]; rows: ComparisonRow[]; supplierOffset: number; rowOffset: number };
export function comparisonPages(report: BidReport): ComparisonPage[] {
  const offers = report.data.offers.filter(offer => offer.source !== "PO source");
  const pages: ComparisonPage[] = [];
  for (let start = 0; start < Math.max(1, offers.length); start += 11) {
    const group = offers.slice(start, start + 11), rows: ComparisonRow[] = [];
    report.data.request.items.forEach((item, index) => {
      const lines = group.map(offer => bidLines(report.data, offer.quote).filter(line => line.requestItemId === item.id));
      for (let n = 0; n < Math.max(1, ...lines.map(value => value.length)); n++) rows.push({ item, number: index + 1, first: n === 0, lines: lines.map(value => value[n]) });
    });
    for (let row = 0; row < rows.length; row += 13) pages.push({ offers: group, rows: rows.slice(row, row + 13), supplierOffset: start, rowOffset: row });
  }
  return pages;
}
export const comparisonAmount = (line: QuoteLine) => quoteLineTotal(line);
export const comparisonPrice = (line: QuoteLine) => quoteLineTotal(line) / (line.quantity * line.conversionFactor);
export const comparisonTotal = (report: BidReport, offer: BidOffer) => bidQuoteTotal(report.data, offer.quote);
