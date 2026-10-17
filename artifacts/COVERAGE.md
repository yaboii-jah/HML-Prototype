# Screenshot Coverage

Validated 483 readable PNG files, each exactly 1440 × 900. All 26 page templates and all seven role dashboards are covered.

## Capture groups

- [x] Access — 2 images
- [x] Dashboards — 78 images
- [x] Projects — 35 images
- [x] Requests — 33 images
- [x] Procurement — 29 images
- [x] Purchase Orders — 36 images
- [x] Accounting — 63 images
- [x] Finance — 19 images
- [x] Deliveries — 24 images
- [x] Inventory — 9 images
- [x] Stock Transfers — 24 images
- [x] Suppliers And Reports — 33 images
- [x] Administration — 14 images
- [x] Archived Document Viewer — 4 images
- [x] Supporting Views — 43 images
- [x] Operational Form Examples — 11 images
- [x] Notification Menu — 1 images
- [x] Stock Sourcing Review — 7 images
- [x] Quotation Review Modes — 12 images
- [x] Mrf Import Sources — 6 images

## Page routes

| Page | Captured roles | Images |
| --- | --- | ---: |
| `/accounting` | Accounting | 7 |
| `/accounting/[poId]` | Accounting | 85 |
| `/admin` | Administrator | 14 |
| `/dashboard` | Accounting, Administrator, Finance, Logistics, Procurement, Project Manager, Site Personnel | 79 |
| `/deliveries` | Logistics | 8 |
| `/deliveries/[id]` | Logistics, Procurement, Site Personnel | 22 |
| `/deliveries/new` | Logistics | 3 |
| `/demo-files/[fileId]` | Project Manager | 4 |
| `/finance` | Finance | 7 |
| `/finance/[poId]` | Finance | 14 |
| `/inventory` | Site Personnel | 5 |
| `/inventory/[siteId]/[materialId]` | Accounting, Site Personnel | 4 |
| `/projects` | Finance, Project Manager, Site Personnel | 8 |
| `/projects/[siteId]` | Project Manager, Site Personnel | 29 |
| `/purchase-orders` | Procurement | 3 |
| `/purchase-orders/[id]` | Procurement, Site Personnel | 29 |
| `/purchase-orders/[id]/edit` | Procurement | 4 |
| `/reports` | Project Manager | 30 |
| `/requests` | Project Manager, Site Personnel | 6 |
| `/requests/[id]` | Project Manager, Site Personnel | 30 |
| `/requests/[id]/edit` | Site Personnel | 7 |
| `/requests/[id]/quotes` | Procurement, Project Manager | 54 |
| `/requests/new` | Site Personnel | 8 |
| `/sign-in` | Public | 2 |
| `/stock-transfers/[id]` | Accounting, Logistics, Site Personnel | 29 |
| `/suppliers` | Procurement | 3 |

The root `/` and retired `/admin/maintenance` redirect to active pages and are excluded. Dynamic route counts may overlap static paths with the same shape; representative detail records are also present.

## Interpretation and limits

- Shared views are captured once unless the role changes visible information or controls. The index identifies the role actually used.
- All visible sections, substantive tabs/dialogs, independent scrolling areas, and hidden table columns are covered using representative populated records. This is interface coverage, not a screenshot of every database record or pagination page.
- Full disbursement, credit/terms, partial and fully paid credit, supplier issuance, receiving, stock posting, inter-project transfers, document previews, management reports, and account administration have representative views.
- MRF AI source selection and hardcopy preview are included. AI extraction was not invoked or mocked for screenshots.
- Actual legacy Finance tabs are documented as the current app presents them; no historical payment records were invented.
- The collection uses fresh isolated browser profiles. A few real commands advance only isolated demo copies to expose usable scheduling, warehouse receiving, and transfer posting forms. The user's existing workspace is unchanged.
- Artificial loading, network failure, access-denied, or recovery screens are excluded. Sign-in and transfer-quantity validation messages are included.
- Passwords and credentials are not exposed. Reset-password forms remain blank.
