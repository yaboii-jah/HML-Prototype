// Logical data flows for the current revised workflow; not a physical schema or control-flow chart.
export const entities = [
  { id: "admin", name: "Administrator", input: "User / project settings", output: "User / project status" },
  { id: "pm", name: "Project Manager", input: "Project data / MRF decisions", output: "Project / MRF records" },
  { id: "site", name: "Site Personnel", input: "MRFs / releases / receipts / usage", output: "Requests / release proposals / stock" },
  { id: "proc", name: "Procurement", input: "Reviewed quotes / POs / transfers / warehouse receipts", output: "Sourcing / PO / delivery records" },
  { id: "supplier", name: "Supplier", input: "Supplier quotations", output: "Issued purchase orders" },
  { id: "finance", name: "Finance", input: "Payment plans / priorities", output: "Payable / settled balances" },
  { id: "accounting", name: "Accounting", input: "Reviews / payment verification", output: "PO / payment / evidence records" },
  { id: "logistics", name: "Logistics", input: "Schedules / dispatch details", output: "Authorized delivery quantities" },
  { id: "ai", name: "AI Extraction Service", input: "Extracted fields / match suggestions", output: "Source pages / MRF context" },
  { id: "drive", name: "Google Drive", input: "Folder / file refs and archive results", output: "Folder data / files / retrieval requests" },
];

export const stores = [
  { id: "D1", name: "Users and Project Records", display: ["Users /", "Projects"] },
  { id: "D2", name: "MRF Records", display: ["MRF", "Records"] },
  { id: "D3", name: "Procurement Records", display: ["Sourcing", "Records"] },
  { id: "D4", name: "Payment Records", display: ["Payment /", "Clearance"] },
  { id: "D5", name: "Delivery and Inventory Records", display: ["Delivery /", "Inventory"] },
  { id: "D6", name: "Document and Archive Records", display: ["Documents"] },
];

const actor = (id, input, output, inputData, outputData) => ({ id, input, output, inputData, outputData });
const store = (id, write, read) => ({ id, write, read });
export const processes = [
  {
    id: "P1", number: "1.0", name: "Manage Users & Projects", display: ["Manage", "Users &", "Projects"], position: [10, 10],
    actors: [
      actor("admin", "User settings", "Directory", ["user-details", "project-settings", "scope-budgets"], ["user-directory", "project-status"]),
      actor("pm", "Budgets", "Project status", ["project-details", "scope-allocations"], ["project-budget-status"]),
    ],
    stores: [store("D1", "Settings", "User / project"), store("D6", "Folder details", "Folder refs")],
  },
  {
    id: "P2", number: "2.0", name: "Manage Requests", display: ["Manage", "Requests"], position: [1110, 10],
    actors: [
      actor("site", "MRF / files", "MRF status", ["requested-materials", "mrf-source-files", "supporting-pdf"], ["mrf-progress"]),
      actor("pm", "MRF decisions", "Review MRFs", ["mrf-review-decisions"], ["mrf-review-records"]),
    ],
    stores: [store("D2", "MRFs", "MRF records"), store("D6", "MRF sources", "AI drafts")],
  },
  {
    id: "P3", number: "3.0", name: "Manage Procurement", display: ["Manage", "Procurement"], position: [10, 510],
    actors: [
      actor("proc", "Sourcing data", "Sourcing / POs", ["reviewed-quotation-data", "material-allocations", "transfer-proposals", "allocation-cancellations", "po-drafts", "po-issuance"], ["approved-mrf-data", "stock-availability", "remaining-purchase-quantities", "transfer-status", "comparative-bids", "po-documents"]),
      actor("accounting", "PO review", "PO / budget", ["costing-tax-review", "po-approval-decisions", "credit-due-date"], ["po-costing-data", "budget-data"]),
      actor("supplier", "Quotations", "Issued POs", ["supplier-quotation-files"], ["issued-supplier-pos"]),
    ],
    stores: [store("D3", "Sourcing", "Allocations"), store("D2", null, "Approved MRF"), store("D1", null, "Budget data"), store("D6", "Quote / PO", "Drafts / refs"), store("D5", null, "Site stock")],
  },
  {
    id: "P4", number: "4.0", name: "Manage Payments", display: ["Manage", "Payments"], position: [1110, 510],
    actors: [
      actor("accounting", "Verified proof", "Pay status", ["payment-proof-files", "payment-verification", "delivery-clearance"], ["verified-payment-records", "payment-balances"]),
      actor("finance", "Payment plans", "Balances", ["payment-priority", "planned-payment-date", "coordination-status"], ["served-po-details", "outstanding-balances", "settled-balances"]),
    ],
    stores: [store("D4", "Payment data", "Pay status"), store("D3", null, "PO terms"), store("D6", "Proof files", "Proof refs")],
  },
  {
    id: "P5", number: "5.0", name: "Manage Delivery & Inventory", display: ["Manage", "Delivery &", "Inventory"], position: [10, 1010],
    actors: [
      actor("logistics", "Dispatch data", "Ready goods", ["delivery-schedules", "dispatch-updates", "transfer-trip-schedules", "transfer-dispatch-updates"], ["cleared-delivery-quantities", "approved-transfer-quantities"]),
      actor("site", "Release/entry", "Release/stock", ["source-release-decisions", "confirmed-release-quantities", "site-receipts", "transfer-receipts", "stock-posting", "material-usage"], ["source-release-proposals", "site-delivery-data", "transfer-trip-data", "stock-balances"]),
      actor("proc", "WH receipts", "WH quantities", ["warehouse-receipts"], ["warehouse-delivery-data"]),
    ],
    stores: [store("D5", "Stock entries", "Stock data"), store("D4", null, "PO clearance"), store("D3", "Releases", "Sourced goods"), store("D6", "Receipt files", "Receipt refs")],
  },
  {
    id: "P6", number: "6.0", name: "Manage Documents", display: ["Manage", "Documents"], position: [1110, 1010],
    actors: [
      actor("ai", "AI drafts", "Pages/context", ["extracted-mrf-fields", "extracted-offer-lines", "suggested-material-matches"], ["mrf-source-pages", "quote-source-pages", "requested-item-context"]),
      actor("drive", "Archive data", "Files / lookups", ["folder-identifiers", "archive-file-references", "retrieved-document-data", "archive-results"], ["project-folder-data", "generated-document-files", "supporting-evidence-files", "file-retrieval-requests"]),
      actor("accounting", "Doc review", "Evidence", ["invoice-receipt-references", "transfer-receipt-evidence", "document-review-results"], ["archived-evidence", "document-completion-status"]),
    ],
    stores: [store("D6", "Drafts / refs", "Sources / refs")],
  },
];

export const diagrams = {
  context: { width: 1400, height: 750, fontSize: 24, printWidthMm: 277, minimumPoints: 13 },
  level1: { width: 2200, height: 1500, fontSize: 31, printWidthMm: 277, minimumPoints: 11 },
};

export const supplierExchangeNote = "Supplier quotations and issued purchase orders are exchanged through Procurement; suppliers do not directly access the application.";

// One model for both levels: context payloads are the union of Level 1 boundary flows.
export const boundaryFlows = processes.flatMap(process => process.actors.flatMap(actor => [
  { from: actor.id, to: process.id, label: actor.input, data: actor.inputData },
  { from: process.id, to: actor.id, label: actor.output, data: actor.outputData },
]));
export const contextFlows = entities.flatMap(entity => [
  { from: entity.id, to: "P0", label: entity.input, data: [...new Set(boundaryFlows.filter(flow => flow.from === entity.id).flatMap(flow => flow.data))] },
  { from: "P0", to: entity.id, label: entity.output, data: [...new Set(boundaryFlows.filter(flow => flow.to === entity.id).flatMap(flow => flow.data))] },
]);
export const storeFlows = processes.flatMap(process => process.stores.flatMap(store => [
  ...(store.write ? [{ from: process.id, to: store.id, label: store.write }] : []),
  ...(store.read ? [{ from: store.id, to: process.id, label: store.read }] : []),
]));
