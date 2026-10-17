# ConstructSync data flow diagrams

Two figures describe the current revised workflow using Gane–Sarson notation. This is a proposed logical production view based on authenticated users and shared persistent company records, not browser-local prototype storage. It is not a physical database schema or a claim that production infrastructure is installed. See the [production design basis](../PRODUCTION_DESIGN.md).

## Figures

- [Context PDF](constructsync-context.pdf), [PNG](constructsync-context.png), [SVG](constructsync-context.svg), [Mermaid](constructsync-context.mmd): one light blue ConstructSync process with black text and lines, with five external entities above and five below. The horizontal figure measures 27.7 × 14.8 cm; insert at 27.7 cm wide on a landscape page for text of approximately 13.46 pt. The 5600 × 3000 PNG is suitable for pasting into documents; SVG/PDF preserve vector text. The figure contains no explanatory footer; supplier mediation is explained in the accompanying notes. The [previous portrait PDF](previous-portrait/constructsync-context.pdf) remains available.
- [Level 1 PDF](constructsync-level1.pdf), [PNG](constructsync-level1.png), [SVG](constructsync-level1.svg), [Mermaid](constructsync-level1.mmd): six processes and six logical stores. The PDF uses one A4 landscape page with 10 mm margins. Insert it at 27.7 cm wide on a landscape document page: the smallest text is approximately 11.06 pt. Use SVG for sharp scaling or the 8800 × 6000 PNG for pasting into Word/Google Docs. Keep the original aspect ratio and avoid image compression; shrinking it to a portrait text column also shrinks the labels.

Suggested captions, placed outside the images: *Figure X. Context diagram of ConstructSync.* and *Figure Y. Level 1 data flow diagram of ConstructSync.*

Rectangles represent external entities, numbered rounded boxes represent processes, and open-ended boxes represent stores. Directed, labeled arrows carry information. Repeated external entities and stores retain the same names/IDs; they are copies of one logical participant or repository, not additional roles or databases. A doubled left store edge marks a repeated store. Level 1 uses light blue process boxes with blue borders and white external-entity boxes. Text and arrows remain black. D1?D6 stores use pale orange fill and brown borders; shape types distinguish processes, people/systems and stores. Neither image has an internal title or legend.

## Processes

| Process | Purpose |
|---|---|
| 1.0 Manage Users & Projects | Administrator, Project Manager supply or receive its business information. |
| 2.0 Manage Requests | Site Personnel, Project Manager supply or receive its business information. |
| 3.0 Manage Procurement | Procurement, Accounting, Supplier supply or receive its business information. |
| 4.0 Manage Payments | Accounting, Finance supply or receive its business information. |
| 5.0 Manage Delivery & Inventory | Logistics, Site Personnel, Procurement supply or receive its business information. |
| 6.0 Manage Documents | AI Extraction Service, Google Drive, Accounting supply or receive its business information. |

## Important distinctions

- Finance submits payment priorities, planned dates and coordination status. Actual payment occurs outside the app. Accounting supplies archived proof and verifies payments; a Finance plan does not establish that money was paid.
- Upfront needs full verified net payment before Accounting's separate delivery clearance. Credit supports clearance before settlement and multiple partial payments. The diagram carries payment mode, verified balances and clearance as data, not a control-flow decision diamond.
- Supplier is an external source/recipient in this logical business-information view. Supplier quotations and issued purchase orders are exchanged through Procurement; suppliers do not directly access the application. Its arrows identify document provenance and destination; Procurement's arrows identify reviewed quotation data, sourcing decisions, transfers and PO preparation. No supplier portal or direct integration is implied.
- AI receives MRF/quotation pages and requested-item context; it returns draft fields and match suggestions. Site Personnel/Procurement review them before approved business records are saved. AI cannot approve requests, awards or payments.
- D6 groups source files, temporary extraction drafts and archive metadata at a logical level. Document processing reads source/staged information and returns references/drafts to that logical store; request/procurement/payment processes consume them. This abstracts interactive extraction and archiving, not a new background job or physical extraction-results table.
- Google Drive exchanges folder information, generated PDFs, supporting files, evidence, archive results and retrieved document data. D6 stores document references/staged data, not a second independent Google Drive archive.
- D4 includes payment coordination, verified payments and Accounting delivery-clearance records. D5 distinguishes warehouse receipt from accepted site quantities and inventory movements. Warehouse receiving does not automatically post site stock.
- D1 groups accounts, projects, scopes and budgets; D2 groups requests/items; D3 groups suppliers, quotation/award/bid/PO information, transfer proposals, allocations and source release decisions. Stores group multiple ERD entities; they are not one-to-one mappings to SQL tables.

- Procurement reads D5 site stock and D3 allocations/releases to determine availability and remaining purchase quantities. Proposals and cancellations are retained in D3.
- Source Site Personnel submit release decisions to 5.0; released quantities are retained in D3. Logistics receives approved transfer quantities alongside separately cleared supplier quantities. D5 retains trips, source transfer-out and accepted destination transfer-in movements.
- Transfers bypass 4.0 payment processing and supplier clearance. Accounting reviews transfer receipt evidence through 6.0 without requiring an invoice or payment proof. Site Personnel is one role covering distinct authorized source and destination responsibilities.
- Level 0 and Level 1 are business overviews; no Level 2 is added. See [diagram conventions](../research/diagram-conventions.md).

[Flow register](FLOW_REGISTER.md) lists the data carried by each boundary arrow and all store connections. [Validation](VALIDATION.md) records structural and export checks.

## Regenerate

Edit model.mjs first. Publication diagrams use fixed positions; Mermaid describes the same logical graph with automatic positions and rectangular data-store proxies. Level 1 uses two columns and three rows, with local entities on the left and stores on the right. Separate horizontal lanes keep arrows continuous and labels clear. Necessary repeated symbols avoid long connectors across process groups.

```powershell
node docs/thesis/dfd/generate.mjs
node docs/thesis/dfd/generate.mjs --check
node docs/thesis/dfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter reuses Puppeteer from the previously installed Mermaid CLI package and Edge from the ERD's configuration; app dependencies do not change. SVG/PDF retain vector text and PNGs are high resolution. Add --level1-only to export the revised figure without rewriting the context image files. The fixed approved-flows.json baseline protects existing boundary information and store connections; Level 1 export checks connector crossings, overlapping segments and connector/label collisions.

Sources: [current workflow](../../WORKFLOW.md), [domain records](../../../src/domain/types.ts), and request/quotation extraction and Drive routes under app/api.
