import type { MRF, PO, PODocument, Quote, Site } from "./types.ts";

export function newPoDocument(request: MRF, quote: Quote, site: Site, at: string): PODocument {
  return { date: at.slice(0, 10), vendorName: quote.supplierDetails?.name || "", vendorAddress: quote.supplierDetails?.address || "", vendorContact: quote.supplierDetails?.contactName || "", vendorPhone: quote.supplierDetails?.phone || "", bankName: "", bankAccountName: "", bankAccountNumber: "", shipToName: site.name, shipToAddress: site.location, shipToContact: site.personnel, shipToPhone: "", requisitioner: request.requestedBy, terms: quote.terms, fob: "", shippingTerms: quote.deliveryTerms || "" };
}
export function initializePoDocument(po: PO, request: MRF, quote: Quote, site: Site, at: string) {
  po.lines ||= quote.lines?.filter(line => line.requestItemId).map(line => ({ itemId: line.requestItemId, quoteLineId: line.id, quantity: line.quantity * line.conversionFactor, unitPrice: line.unitPrice / line.conversionFactor, discountType: line.discountType, discountValue: line.discountValue, taxRate: line.taxRate, fixedDiscountConfirmed: line.discountType !== "fixed" })) || request.items.map(item => ({ itemId: item.id, quoteLineId: "", quantity: item.quantity, unitPrice: quote.prices[item.id] || 0 }));
  po.adjustments ||= quote.adjustments?.map(value => ({ ...value, included: true, confirmed: false, taxable: true })) || [
    ...((po.freight ?? quote.freight) ? [{ id: "freight", label: "Delivery Fee", kind: "shipping" as const, calculation: "fixed" as const, value: po.freight ?? quote.freight ?? 0, included: true, confirmed: false, taxable: true }] : []),
    ...((po.discount ?? quote.discount) ? [{ id: "discount", label: "Discount", kind: "discount" as const, calculation: "fixed" as const, value: po.discount ?? quote.discount ?? 0, included: true, confirmed: false, taxable: true }] : []),
  ];
  po.document = newPoDocument(request, quote, site, at);
  po.financial = { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, ewtGoods: 0, ewtServices: 0, reviewed: false };
}
