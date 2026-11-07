import { randomUUID } from "node:crypto";
import {
  emptyQuoteBody,
  emptyQuoteLine,
} from "../../src/domain/quotations/drafts.ts";
import {
  calculateQuotation,
  emptyFinancialReview,
} from "../../src/domain/quotations/financial.ts";
import {
  initialOrderBody,
  makeOrderLine,
} from "../../src/domain/purchasing/pricing.ts";
export function purchasingFixture({
  price = "112",
  factor = "1",
  quoted = "100",
  vat = "VAT",
  fixed = "",
  charges = false,
} = {}) {
  const item = randomUUID(),
    quoteId = randomUUID(),
    mrfId = randomUUID(),
    supplierId = randomUUID();
  const line = {
    ...emptyQuoteLine(),
    requestItemId: item,
    description: "Cement",
    unit: "bag",
    quantity: quoted,
    unitPrice: price,
    conversionFactor: factor,
    discountValue: fixed,
  };
  const body = {
    ...emptyQuoteBody(),
    supplierName: "Fixture supplier",
    ref: "OFFER-1",
    date: "2026-11-06",
    paymentTerms: "30 days",
    deliveryTerms: "Delivered",
    lines: [line],
  };
  if (charges)
    body.adjustments = [
      {
        id: randomUUID(),
        label: "Delivery",
        kind: "shipping",
        basis: "fixed",
        value: "1000",
        taxable: "",
        sourceDetails: "",
      },
      {
        id: randomUUID(),
        label: "Discount",
        kind: "discount",
        basis: "percentage",
        value: "5",
        taxable: "",
        sourceDetails: "",
      },
    ];
  const review = {
    ...emptyFinancialReview(body),
    vatStatus: vat,
    priceBasis: "inclusive",
    vatRate: vat === "VAT" ? "12" : "",
  };
  review.rows = review.rows.map((row) => ({
    ...row,
    role: "material",
    discountType: fixed ? "fixed" : "none",
  }));
  review.adjustments = review.adjustments.map((row, index) => ({
    ...row,
    kind: index ? "discount" : "shipping",
    calculation: index ? "percentage" : "fixed",
    taxable: true,
  }));
  const q = {
    id: quoteId,
    mrfId,
    supplierId,
    body,
    state: "finalized",
    version: "1",
    contentVersion: "1",
    fileVersion: "1",
    creatorName: "Procurement fixture",
    createdAt: "2026-11-06T00:00:00.000Z",
    checked: true,
    matches: [line.id],
    files: [],
    groups: [],
    jobs: [],
    financial: {
      version: "1",
      sourceVersion: "1",
      filesVersion: "1",
      checked: true,
      review,
      calculation: calculateQuotation(body, review),
    },
    family: {
      id: randomUUID(),
      version: "1",
      currentQuoteId: quoteId,
      pendingQuoteId: null,
      currentMrfArchiveId: randomUUID(),
      supplierActive: true,
    },
    revision: {
      id: randomUUID(),
      number: "1",
      finalizedBy: "Procurement fixture",
      finalizedAt: "2026-11-06T00:00:00.000Z",
      mrfArchiveId: randomUUID(),
      withdrawn: false,
      current: true,
      eligible: true,
      blockers: [],
      archiveState: "complete",
      archiveMessage: null,
      pdfAvailable: true,
    },
  };
  const view = {
    role: "Procurement",
    version: "0",
    demandVersion: "0",
    records: [],
    reports: [],
    claims: [],
    history: [],
    quotations: {
      role: "Procurement",
      request: {
        id: mrfId,
        ref: "QA-PO-MRF-0001",
        procurementReady: true,
        items: [{ id: item, name: "Cement", unit: "bag", quantity: "1000" }],
      },
      suppliers: [],
      quotes: [q],
      history: [],
    },
  };
  const order = initialOrderBody(q);
  order.reason = "Reviewed supplier selection";
  order.lines = [makeOrderLine(q, line.id, "40", randomUUID())];
  return { q, view, order, line, item };
}
