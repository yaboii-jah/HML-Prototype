# ConstructSync process flowcharts

Six connected business figures describe the intended production workflow. The request and fulfillment overview introduces five focused flows: purchasing, payments, site transfers, receiving/inventory and receipt review. Each uses descriptive entry events and process handoffs. See the [production design basis](../PRODUCTION_DESIGN.md).

## Active figures

| Figure | PDF | Image | Vector | Editable source |
|---|---|---|---|---|
| Request and fulfillment overview | [PDF](constructsync-overview.pdf) | [PNG](constructsync-overview.png) | [SVG](constructsync-overview.svg) | [Mermaid](constructsync-overview.mmd) |
| Supplier purchasing and PO approval | [PDF](constructsync-purchasing.pdf) | [PNG](constructsync-purchasing.png) | [SVG](constructsync-purchasing.svg) | [Mermaid](constructsync-purchasing.mmd) |
| Payment coordination and delivery clearance | [PDF](constructsync-payments.pdf) | [PNG](constructsync-payments.png) | [SVG](constructsync-payments.svg) | [Mermaid](constructsync-payments.mmd) |
| Inter-site stock transfer | [PDF](constructsync-stock-transfer.pdf) | [PNG](constructsync-stock-transfer.png) | [SVG](constructsync-stock-transfer.svg) | [Mermaid](constructsync-stock-transfer.mmd) |
| Delivery, receiving and inventory | [PDF](constructsync-delivery-receiving.pdf) | [PNG](constructsync-delivery-receiving.png) | [SVG](constructsync-delivery-receiving.svg) | [Mermaid](constructsync-delivery-receiving.mmd) |
| Receipt documentation and review | [PDF](constructsync-document-review.pdf) | [PNG](constructsync-document-review.png) | [SVG](constructsync-document-review.svg) | [Mermaid](constructsync-document-review.mmd) |

Use the request and fulfillment overview as the main figure and the five focused flows as supporting figures. Add captions outside the images and assign the paper's figure numbers separately. Supplier PO issuance begins payment coordination; delivery clearance begins supplier delivery scheduling; site-transfer dispatch begins destination receiving. Warehouse or site receipt evidence begins documentation and review.

## Reading and print layout

The overview, purchasing, site transfer and receipt-review figures use A4 portrait. Payment coordination and delivery/receiving use A4 landscape. All PDFs have 10 mm margins. Keep portrait images at 19 cm and landscape images at 27.7 cm wide, with their aspect ratios preserved. Printed labels are at least 10 pt. SVG/PDF retain selectable vector text; PNGs are generated at four times the canvas size.

Activities read downward and alternative branches sit beside each other. White shapes, black text and arrows, consistent spacing, and bold responsible roles preserve the paper style. No internal title or legend is inserted.

Rectangles are activities; diamonds are decisions; rounded symbols are entries or recorded milestones. Double-sided rectangles refer to named subprocesses. Pentagons identify the next process, not automatic system closure. The Credit connector routes independent delivery-clearance and payment paths. Warehouse and site receipt evidence each proceeds to receipt review without waiting for the other path.

## What changed and why

- Starting events and named process handoffs replace figure letters, so each flow can be understood independently of its caption or position in the paper.
- Entry and handoff shapes are resized, and their connector ports are adjusted, to keep the longer descriptive labels readable.
- Purchasing and PO approval remain separate from payment coordination and clearance, making responsibility and payment gates easier to follow.
- Procurement verifies matching descriptions and units, rechecks availability and requests source release directly. Reduced/rejected releases and transfer shortages return explicitly to material sourcing.
- Warehouse evidence can reach receipt review before goods arrive at the site, and site stock posting never waits for document review.
- The overview begins with a ready project and marks purchasing/transfer quantities as applicable, preserving purchase-only, transfer-only and mixed requests.

## Request and fulfillment overview

The overview begins with an existing project and shows MRF submission, Project Manager review, and Procurement allocation of requested quantities. Supplier purchasing and site transfers may fulfill the same request independently. Cleared supplier deliveries and dispatched transfers proceed to receiving and stock posting, while receipt evidence proceeds to documentation and review. These milestones do not establish automatic MRF closure.

- Project setup is a prerequisite, not an activity repeated for each MRF.
- Use purchase quantities, transfer quantities, or both; one item may be split across sources.
- Cleared supplier deliveries and dispatched site transfers enter receiving independently. Warehouse or site receipt evidence proceeds to receipt review as it becomes available.
- Stock posting, payment settlement and document review are separate milestones; none automatically closes the MRF.

## Supplier purchasing and PO approval

The purchasing flow begins with materials allocated for purchase and covers supplier quotation evaluation, material awards, PO preparation, and Accounting review of costs, budget and terms. Returned POs go back for correction, held reviews remain pending, and rejected POs end that purchasing path. Approved POs are archived and issued to suppliers before payment coordination begins.

- Repeat for each supplier PO; only the allocated purchasing quantities enter this flow.
- Accounting reviews costs, taxes, adjustments and budget, agrees the credit due date when applicable, and archives the approved PO.
- Hold preserves pending review; Return requires PO correction; Reject does not close the entire MRF.
- Supplier quotation and PO exchanges are handled by Procurement. Issued supplier POs proceed to payment coordination; actual payments occur outside the application.

## Payment coordination and delivery clearance

The payment flow separates upfront and credit arrangements after PO issuance. Upfront deliveries require full verified net payment and Accounting clearance. Under credit terms, delivery clearance and payment coordination proceed independently; partial payments retain the outstanding balance and payment settlement does not trigger another delivery.

- Finance coordinates actual payments outside the application; Accounting archives proof and verifies paid amounts.
- Upfront requires full verified net payment followed by separate Accounting delivery clearance.
- The Credit connector routes two independent paths. Cleared supplier deliveries proceed to Logistics while Finance follows outstanding balances.
- Finance's planned payment date differs from the agreed credit due date. Settlement never retriggers delivery; site transfers bypass payment coordination.

## Inter-site stock transfer

The transfer flow begins with materials allocated for site transfer. Procurement verifies matching material descriptions and units, rechecks available quantities, and requests release directly from the source project. Source Site Personnel authorize the quantities their project can spare. Approved quantities proceed to Logistics for scheduling and dispatch, while rejected or unreleased quantities return to material sourcing. Dispatch deducts source stock before the trip proceeds to destination receiving and inventory posting.

- Procurement verifies matching descriptions and units before requesting source release. Destination suitability reviews retained for previously submitted requests are outside this current workflow figure.
- Source proposals reserve stock and MRF demand. Only confirmed release quantities continue to Logistics; unreleased quantities return to material sourcing.
- No supplier quotation, PO, payment, budget charge or purchase delivery clearance applies.
- Repeat for multiple sites and trips. Dispatch deducts source stock once; destination receiving posts accepted site stock once. Cancellation of undispatched allocations remains in the workflow notes.

## Delivery, receiving and inventory

The receiving flow begins with either a cleared supplier delivery or a dispatched site transfer. Supplier deliveries may travel directly to the project or through the warehouse, while dispatched transfers enter at destination receiving. Site personnel record accepted quantities and post stock independently of receipt review. Warehouse receipts produce evidence without adding site stock. Missing transfer quantities return to material sourcing without restoring dispatched source stock.

- Supplier deliveries enter before scheduling; site transfers enter after their trip has been dispatched.
- Warehouse receipt alone does not post site stock. Warehouse and site evidence each proceed to receipt review immediately.
- Only accepted site quantities are posted. Posting and document review do not depend on one another.
- Transfer shortages return to material sourcing. Supplier discrepancies remain associated with their PO and delivery records; further batches may still be pending.
- Repeat for partial deliveries. Neither posting nor document completion automatically closes an MRF.

## Receipt documentation and review

Warehouse and site receipt evidence enter the documentation flow independently of stock posting. Receiving teams archive generated and current signed receipts, and Accounting checks the required evidence. Missing or unacceptable documents return for completion and re-archiving before review is completed. Transfers require no supplier invoice or payment proof.

- Run for each received warehouse or site batch; receipt evidence becomes available without waiting for stock posting or site arrival.
- Archive generated and current signed receipts. Corrected quantities require evidence for the current version.
- Accounting checks applicable purchasing evidence; transfer receipts require no supplier invoice or payment proof. Payment verification remains in the payment coordination process.
- Archive failures and missing evidence are resolved without undoing receiving or stock posting. Document review does not close the MRF.

## Details kept in notes

MRFs and supplier quotations retain reviewed supporting files and archive requirements. PO review includes VAT/EWT, adjustments and budget checks. Stock matching requires compatible units and Procurement suitability confirmation. Project assignments control source release and destination receipt/posting. Detailed reservation, cancellation, shortage, evidence-version and archive-retry rules remain in [the workflow](../../WORKFLOW.md) rather than adding screen-level boxes.

Receipt evidence review remains independent of payment settlement and stock posting. Transfer receipts require no supplier invoice or payment proof. Generated and current signed receipts must cover every received trip, including warehouse batches. Material usage continues after stock posting and is not a completion gate.

## Historical figures

The [previous four-figure set](previous-four-figure/ARCHIVE.md) retains its original labels and is not the active version. The [former combined chart](constructsync-combined.pdf), [former upfront chart](constructsync-upfront.pdf), and [former credit chart](constructsync-credit-terms.pdf) remain historical files. Use the six active figures above; regeneration does not overwrite the archives.

## Regenerate

Edit flows.mjs for current business content and fixed publication positions. model.mjs re-exports those figures and retains historical definitions. Mermaid uses automatic layout; publication SVGs use the checked fixed positions.

```powershell
node docs/thesis/pfd/generate.mjs
node docs/thesis/pfd/generate.mjs --check
node docs/thesis/pfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter reuses the installed PDF utilities, cached Puppeteer and Edge; application dependencies and behavior do not change. [Validation](VALIDATION.md) records structural, cross-chart, geometry and rendered-text checks. [Diagram conventions](../research/diagram-conventions.md) explains the modeling sources.
