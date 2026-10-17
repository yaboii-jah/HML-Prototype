# DFD flow register

These are logical data flows, not payment transactions or workflow-control arrows.

## Level 1 boundary flows

| External entity | Process | Direction | Display label | Data carried |
|---|---|---|---|---|
| Administrator | 1.0 Manage Users & Projects | Into system | User settings | user-details, project-settings, scope-budgets |
| Administrator | 1.0 Manage Users & Projects | Out of system | Directory | user-directory, project-status |
| Project Manager | 1.0 Manage Users & Projects | Into system | Budgets | project-details, scope-allocations |
| Project Manager | 1.0 Manage Users & Projects | Out of system | Project status | project-budget-status |
| Site Personnel | 2.0 Manage Requests | Into system | MRF / files | requested-materials, mrf-source-files, supporting-pdf |
| Site Personnel | 2.0 Manage Requests | Out of system | MRF status | mrf-progress |
| Project Manager | 2.0 Manage Requests | Into system | MRF decisions | mrf-review-decisions |
| Project Manager | 2.0 Manage Requests | Out of system | Review MRFs | mrf-review-records |
| Procurement | 3.0 Manage Procurement | Into system | Sourcing data | reviewed-quotation-data, material-allocations, transfer-proposals, allocation-cancellations, po-drafts, po-issuance |
| Procurement | 3.0 Manage Procurement | Out of system | Sourcing / POs | approved-mrf-data, stock-availability, remaining-purchase-quantities, transfer-status, comparative-bids, po-documents |
| Accounting | 3.0 Manage Procurement | Into system | PO review | costing-tax-review, po-approval-decisions, credit-due-date |
| Accounting | 3.0 Manage Procurement | Out of system | PO / budget | po-costing-data, budget-data |
| Supplier | 3.0 Manage Procurement | Into system | Quotations | supplier-quotation-files |
| Supplier | 3.0 Manage Procurement | Out of system | Issued POs | issued-supplier-pos |
| Accounting | 4.0 Manage Payments | Into system | Verified proof | payment-proof-files, payment-verification, delivery-clearance |
| Accounting | 4.0 Manage Payments | Out of system | Pay status | verified-payment-records, payment-balances |
| Finance | 4.0 Manage Payments | Into system | Payment plans | payment-priority, planned-payment-date, coordination-status |
| Finance | 4.0 Manage Payments | Out of system | Balances | served-po-details, outstanding-balances, settled-balances |
| Logistics | 5.0 Manage Delivery & Inventory | Into system | Dispatch data | delivery-schedules, dispatch-updates, transfer-trip-schedules, transfer-dispatch-updates |
| Logistics | 5.0 Manage Delivery & Inventory | Out of system | Ready goods | cleared-delivery-quantities, approved-transfer-quantities |
| Site Personnel | 5.0 Manage Delivery & Inventory | Into system | Release/entry | source-release-decisions, confirmed-release-quantities, site-receipts, transfer-receipts, stock-posting, material-usage |
| Site Personnel | 5.0 Manage Delivery & Inventory | Out of system | Release/stock | source-release-proposals, site-delivery-data, transfer-trip-data, stock-balances |
| Procurement | 5.0 Manage Delivery & Inventory | Into system | WH receipts | warehouse-receipts |
| Procurement | 5.0 Manage Delivery & Inventory | Out of system | WH quantities | warehouse-delivery-data |
| AI Extraction Service | 6.0 Manage Documents | Into system | AI drafts | extracted-mrf-fields, extracted-offer-lines, suggested-material-matches |
| AI Extraction Service | 6.0 Manage Documents | Out of system | Pages/context | mrf-source-pages, quote-source-pages, requested-item-context |
| Google Drive | 6.0 Manage Documents | Into system | Archive data | folder-identifiers, archive-file-references, retrieved-document-data, archive-results |
| Google Drive | 6.0 Manage Documents | Out of system | Files / lookups | project-folder-data, generated-document-files, supporting-evidence-files, file-retrieval-requests |
| Accounting | 6.0 Manage Documents | Into system | Doc review | invoice-receipt-references, transfer-receipt-evidence, document-review-results |
| Accounting | 6.0 Manage Documents | Out of system | Evidence | archived-evidence, document-completion-status |

## Store flows

| From | To | Display label | Information carried |
|---|---|---|---|
| P1 | D1 | Settings | Saved settings |
| D1 | P1 | User / project | User / project data |
| P1 | D6 | Folder details | Folder details |
| D6 | P1 | Folder refs | Folder references |
| P2 | D2 | MRFs | Saved MRFs |
| D2 | P2 | MRF records | MRF records |
| P2 | D6 | MRF sources | MRF source files |
| D6 | P2 | AI drafts | Extracted MRF drafts |
| P3 | D3 | Sourcing | Saved quotations, awards, POs, transfer proposals and sourcing allocations/cancellations |
| D3 | P3 | Allocations | Quotation/PO data, transfer reservations, release decisions and remaining demand |
| D2 | P3 | Approved MRF | Approved MRFs |
| D1 | P3 | Budget data | Project and scope budget data |
| P3 | D6 | Quote / PO | Quotation and PO files |
| D6 | P3 | Drafts / refs | Extracted drafts and file references |
| D5 | P3 | Site stock | Project stock movements and balances used with D3 reservations to determine availability |
| P4 | D4 | Payment data | Saved payment verification and coordination data |
| D4 | P4 | Pay status | Payment and delivery clearance status |
| D3 | P4 | PO terms | Served PO terms |
| P4 | D6 | Proof files | Payment proof files |
| D6 | P4 | Proof refs | Archived proof references |
| P5 | D5 | Stock entries | Saved purchasing and transfer trips, accepted receipts, transfer-out and transfer-in stock movements |
| D5 | P5 | Stock data | Purchasing/transfer trip information and project stock movements/balances |
| D4 | P5 | PO clearance | Accounting delivery clearance |
| P5 | D3 | Releases | Source release decisions and confirmed transfer quantities |
| D3 | P5 | Sourced goods | Ordered material quantities and stock-transfer proposals/released allocations |
| P5 | D6 | Receipt files | Purchasing and transfer receipt files |
| D6 | P5 | Receipt refs | Archived purchasing and transfer receipt references |
| P6 | D6 | Drafts / refs | Extraction drafts and archive references |
| D6 | P6 | Sources / refs | Source files and document metadata |

## Context balance

Context labels summarize the exact union of Level 1 boundary data for each entity and direction. The generator checks those sets for equality. This logical view includes Supplier as the original source of quotations and the intended recipient of issued purchase orders. Procurement's flows carry reviewed quotation data and sourcing/PO decisions, rather than duplicating the supplier document exchanges.

Supplier quotations and issued purchase orders are exchanged through Procurement; suppliers do not directly access the application.
