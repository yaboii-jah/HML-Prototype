# ConstructSync process flowcharts

Four connected business figures describe the intended production workflow. The overview references the focused purchasing, transfer and receiving charts. See the [production design basis](../PRODUCTION_DESIGN.md).

## Active figures

| Ref | Figure | PDF | Image | Vector | Editable source |
|---|---|---|---|---|---|
| A | Request and fulfillment overview | [PDF](constructsync-overview.pdf) | [PNG](constructsync-overview.png) | [SVG](constructsync-overview.svg) | [Mermaid](constructsync-overview.mmd) |
| B | Supplier purchasing and payment | [PDF](constructsync-purchasing.pdf) | [PNG](constructsync-purchasing.png) | [SVG](constructsync-purchasing.svg) | [Mermaid](constructsync-purchasing.mmd) |
| C | Site stock transfer | [PDF](constructsync-stock-transfer.pdf) | [PNG](constructsync-stock-transfer.png) | [SVG](constructsync-stock-transfer.svg) | [Mermaid](constructsync-stock-transfer.mmd) |
| D | Delivery, receiving and records | [PDF](constructsync-delivery-receiving.pdf) | [PNG](constructsync-delivery-receiving.png) | [SVG](constructsync-delivery-receiving.svg) | [Mermaid](constructsync-delivery-receiving.mmd) |

Use A as the main figure and B-D as supporting process figures. Add captions outside the images: *Process A. Request and fulfillment overview*, and matching captions for B-D. Letter references remain valid when the paper's figure numbers change.

## Reading and print layout

A and C use A4 portrait; B and D use A4 landscape, all with 10 mm PDF margins. Keep portrait images at 19 cm and landscape images at 27.7 cm wide, with their aspect ratios preserved. Printed labels are at least 10 pt. SVG/PDF retain selectable vector text; PNGs are generated at four times the canvas size.

Activities read downward, with the shared PO preparation steps in a short left-to-right row in B. Alternative branches sit beside each other. White shapes, black text and arrows, consistent spacing, and bold responsible roles preserve the paper style. No internal title or legend is inserted.

Rectangles are activities; diamonds are decisions; rounded symbols are entries or recorded milestones. Double-sided rectangles refer to subprocesses B-D. Pentagons indicate handoffs to another chart, not an automatic system closure. CR is a named connector routing both independent credit paths. The two W circles continue warehouse receipt evidence into the document path; no line is drawn across the chart between matching connectors.

## A: Request and fulfillment overview

- Allocate quantities to purchases, transfers, or both, including splitting one MRF item.
- Each cleared purchase delivery or dispatched transfer enters D independently; there is no wait-for-both merge.
- Stock posting and document review are separate milestones; neither automatically closes the MRF.

## B: Supplier purchasing and payment

- Repeat for each supplier PO. Accounting means Accounting / Auditing.
- CR routes both independent credit paths. Credit clearance can precede payment; settlement does not retrigger delivery.
- Upfront clearance requires full verified net supplier payment with archived proof. Finance coordinates payment outside the app.
- Accounting agrees the credit due date before issuance; Finance's planned date is separate.

## C: Site stock transfer

- Proposals reserve stock and MRF demand. Source-assigned Site Personnel confirm quantities; reduced release leaves the balance for sourcing in A.
- No supplier quotation, PO, payment, budget charge or purchase delivery-clearance step applies.
- Repeat for multiple source sites and trips. Dispatch deducts source stock once; D posts accepted destination quantities once.
- Undispatched allocations can be cancelled explicitly. Shortages reopen demand without restoring dispatched stock.

## D: Delivery, receiving and records

- B enters at supplier scheduling; C enters at destination receiving after transfer dispatch.
- Matching W connectors carry warehouse receipt evidence to the document path without waiting for site arrival.
- Only accepted site quantities post to destination stock. Warehouse receipt alone does not post site inventory.
- Archive generated and current signed receipts for every received batch. Stock posting and Accounting document review proceed independently.
- Repeat receiving for partial deliveries. Shortages reopen sourcing in A; separate milestones do not automatically close requests.

## Details kept in notes

MRFs and supplier quotations retain reviewed supporting files and archive requirements. PO review includes VAT/EWT, adjustments and budget checks. Stock matching requires compatible units and Procurement suitability confirmation. Project assignments control source release and destination receipt/posting. Detailed reservation, cancellation, shortage, evidence-version and archive-retry rules remain in [the workflow](../../WORKFLOW.md) rather than adding screen-level boxes.

Receipt evidence review remains independent of payment settlement and stock posting. Transfer receipts require no supplier invoice or payment proof. Generated and current signed receipts must cover every received trip, including warehouse batches. Material usage continues after stock posting and is not a completion gate.

## Historical figures

The [former combined chart](constructsync-combined.pdf), [former upfront chart](constructsync-upfront.pdf), and [former credit chart](constructsync-credit-terms.pdf) are retained only for historical reference. They omit site stock transfers and are not the current figures. Active regeneration does not overwrite them.

## Regenerate

Edit flows.mjs for current business content and fixed publication positions. model.mjs re-exports those figures and retains historical definitions. Mermaid uses automatic layout; publication SVGs use the checked fixed positions.

```powershell
node docs/thesis/pfd/generate.mjs
node docs/thesis/pfd/generate.mjs --check
node docs/thesis/pfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter reuses the installed PDF utilities, cached Puppeteer and Edge; application dependencies and behavior do not change. [Validation](VALIDATION.md) records structural, cross-chart, geometry and rendered-text checks. [Diagram conventions](../research/diagram-conventions.md) explains the modeling sources.
