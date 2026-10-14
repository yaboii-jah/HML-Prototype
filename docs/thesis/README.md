# Current thesis diagrams

Updated **2026-10-13** for mixed MRF fulfillment through supplier purchases and other-site stock transfers. Start with the request and fulfillment overview, then use the five focused process figures. Entry events and handoffs name the actual workflow rather than referring to figure letters. The figures describe the intended production business design; prototype storage is not their basis.

## Figures ready for the paper

| Figure | PDF | PNG | Purpose |
|---|---|---|---|
| Request and fulfillment overview | [PDF](pfd/constructsync-overview.pdf) | [PNG](pfd/constructsync-overview.png) | MRF review, stock checking and quantity allocation to either or both sourcing paths. |
| Supplier purchasing and PO approval | [PDF](pfd/constructsync-purchasing.pdf) | [PNG](pfd/constructsync-purchasing.png) | Quotation evaluation, PO review, approval, archiving and supplier issuance; proceeds to payment coordination. |
| Payment coordination and delivery clearance | [PDF](pfd/constructsync-payments.pdf) | [PNG](pfd/constructsync-payments.png) | Starts with an issued supplier PO; upfront verification and clearance; independent credit delivery/payment paths. |
| Inter-site stock transfer | [PDF](pfd/constructsync-stock-transfer.pdf) | [PNG](pfd/constructsync-stock-transfer.png) | Suitability, source release, return of unreleased quantities to material sourcing, scheduling/dispatch and source deduction. |
| Delivery, receiving and inventory | [PDF](pfd/constructsync-delivery-receiving.pdf) | [PNG](pfd/constructsync-delivery-receiving.png) | Starts with supplier delivery clearance or site-transfer dispatch; direct/warehouse routes, accepted stock and transfer-shortage resourcing. |
| Receipt documentation and review | [PDF](pfd/constructsync-document-review.pdf) | [PNG](pfd/constructsync-document-review.png) | Starts with available warehouse or site receipt evidence; archiving, correction and Accounting review independent of stock posting. |
| Core ERD | [PDF](erd/constructsync-erd.pdf) | [PNG](erd/constructsync-erd.png) | Eleven core entities, including Stock Transfer and a Delivery with exactly one PO or transfer parent. |
| Core UML class diagram | [PDF](uml/constructsync-class-diagram.pdf) | [PNG](uml/constructsync-class-diagram.png) | Eleven business classes with essential attributes, conceptual operations, multiplicities, MRF-item composition, and exclusive Delivery ownership. |
| DFD Level 0 / context | [PDF](dfd/constructsync-context.pdf) | [PNG](dfd/constructsync-context.png) | One system process and ten external information sources/recipients, including Supplier. |
| DFD Level 1 | [PDF](dfd/constructsync-level1.pdf) | [PNG](dfd/constructsync-level1.png) | Six major functions and six logical stores, balanced with the context exchanges. |

SVG and Mermaid versions are in the same directories. PDF/SVG retain vector text; PNG is suitable for Word. Preserve proportions and follow the documented insertion widths: [flowcharts](pfd/README.md), [ERD](erd/README.md), [DFDs](dfd/README.md), [UML class diagram](uml/README.md). Captions belong outside the images. Assign the paper's final figure numbers separately; process connections remain understandable through their descriptive labels.

## What changed and why

| Change | Reason |
|---|---|
| Six connected flowcharts replace the previous four-figure grouping. | PO processing is separate from payments, and inventory posting is separate from receipt review. |
| Entry events and process handoffs replace figure-letter references; affected shapes and connectors are resized and repositioned. | Each flow remains understandable independently of its caption and position in the paper. |
| Stock Transfer links its MRF and source/destination projects. | Internal stock can fulfill demand independently of supplier purchasing. |
| Delivery permits one PO **or** one transfer, exclusively. | A mandatory PO would incorrectly impose purchasing obligations on transfers. |
| DFD sourcing, release, trip, stock and receipt information is extended. | Existing business functions now process internal transfers as well as purchases. |
| Supplier is restored as a logical quotation source and PO recipient in both DFD levels. | Procurement handles the actual exchange; the accompanying notes clarify that suppliers do not directly access the application. |
| Source release and source/destination stock effects are visible. | Authorization and changes to both sites' balances are essential business behavior. |
| Payment settlement, stock posting and evidence review remain separate. | Credit delivery can precede settlement; transfer evidence does not require supplier payment or invoices. |

Reservations, source suitability, project assignments, cancellations, shortages, partial trips and evidence-version/retry rules remain in the accompanying notes. The core ERD is not a full physical schema. Additional DFD levels are not needed for this overview.

[Production design and cross-figure mapping](PRODUCTION_DESIGN.md), [ERD data dictionary](erd/DATA_DICTIONARY.md), [DFD information register](dfd/FLOW_REGISTER.md), and [flowchart explanations](pfd/README.md) explain the business rules. [Research references](research/diagram-conventions.md) document the published modeling conventions; they are not additions to the recent RRL list.

## Regenerate and verify

```powershell
node docs/thesis/erd/generate.mjs --check
node docs/thesis/dfd/generate.mjs --check
node docs/thesis/pfd/generate.mjs --check
node docs/thesis/uml/generate.mjs --check
node docs/thesis/export-all.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter checks workflow paths, references, diagram geometry, actual rendered text and selectable single-page PDF content. Use `--only erd`, `--only dfd`, `--only pfd`, or `--only uml` to export one group. Add `--validate-mermaid` to render and validate the editable sources separately in temporary files. The current set contains ten sources: one ERD, two DFDs, six PFDs and one UML class diagram. Existing cached Puppeteer and Edge are reused; application dependencies and behavior are unchanged.

The previous four-figure set is retained in [its archive](pfd/previous-four-figure/ARCHIVE.md). Former combined, upfront and credit flowcharts remain historical files with their original labels. Use the six active process figures listed above for the current paper.
