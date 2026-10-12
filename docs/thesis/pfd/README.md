# ConstructSync process flow diagram

One combined business workflow figure covers full disbursement/upfront and credit/terms. It shares purchasing and delivery activities, while keeping their payment rules distinct. It shows activities, decisions and responsible roles for the intended production application, assuming authenticated users and shared persistent records. Prototype-only storage and sign-in behavior are not part of the flow. It is not a data flow diagram or screen-level system flowchart. See the [production design basis](../PRODUCTION_DESIGN.md).

## Figures

- **Combined process flow:** [PDF](constructsync-combined.pdf), [PNG](constructsync-combined.png), [SVG](constructsync-combined.svg), [Mermaid](constructsync-combined.mmd).

The PDF is one A4 landscape page with 10 mm margins. Keep the figure at 27.4 cm wide for labels of at least 10 pt. Place the caption outside the image, for example *Process flow of ConstructSync*. The figure uses white shapes with black text, borders and arrows, no internal title and no legend. Use the 6960 ? 4800 PNG when pasting into documents, or SVG/PDF for vector text. Preserve its proportions and avoid image compression. Roles appear in bold inside activity boxes. Diamonds indicate decisions; rounded shapes indicate starts, rejection outcomes or recorded milestones. Filled dots mark intentional splits or merges. The credit dot splits independent delivery/payment paths; the delivery dot accepts either eligible arrangement without waiting for both; the receipt dot splits inventory and document milestones. They are not additional decisions.

Read the shared purchasing steps across the top two rows, then the payment arrangement in the center. Upfront payment is on the left and credit payment on the right. Shared delivery runs across the lower row, with inventory and documents beneath it. Return and follow-up routes use reserved corridors. Arrows are continuous, with no crossings or shared connector segments, and every branch label sits beside its connector rather than covering it.

The earlier [separate upfront PDF](constructsync-upfront.pdf) and [separate credit PDF](constructsync-credit-terms.pdf) are retained for reference. Regeneration now produces the combined figure only.

## Reading the flow

- Activity boxes use short action labels. Project setup includes budgets, scopes and the Drive folder; MRF submission includes the supporting PDF. Quotation review includes finalization, archiving and comparative bids before allocation. PO cost review includes prices, VAT/EWT, adjustments and allocated budget. Issuing the PO means supplier issuance is confirmed and the PO becomes Served. The notes below retain the requirements summarized by each short label.
- The shared path begins with project setup and MRF submission, then shows approval, quotation review, comparison/allocation, PO review, approval/archive and supplier issuance. The same MRF can produce multiple supplier POs: repeat each PO's downstream path as needed. Approved MRF evidence is archived before procurement continues; AI extraction, when used, is reviewed before submission/finalization.
- MRF returns go to Site Personnel for correction. PO returns go to Procurement for correction. Accounting holds await another Accounting review rather than being treated as approved or returned. Rejected MRFs and POs stop their respective paths.
- The selected payment arrangement is confirmed by Accounting. Upfront clearance follows full verified **net supplier payment** with archived proof; failed payment/proof checks loop back for resolution. Finance coordinates actual payment outside ConstructSync and cannot verify payment or clear delivery.
- Credit requires an Accounting-agreed due date. After the PO is Served, payment and delivery proceed independently. The two outgoing paths are concurrent possibilities, not alternatives and not a synchronization barrier. Accounting may clear delivery before any payment. Each verified partial payment leaves an outstanding balance for Finance follow-up; full verified settlement ends the payment path.
- Finance may coordinate payment before Accounting's check, but Accounting verification does not require a particular Finance coordination status. A planned payment date is distinct from the agreed due date. Overdue credit balances require follow-up; they do not automatically stop delivery.
- Direct deliveries go to Site Personnel. Warehouse deliveries are received by Procurement, then transferred by Logistics and received at site. Receiving teams record accepted quantities, shortages and damage. Only accepted site quantities are posted to site inventory; warehouse receipt alone does not post site stock. Repeat the delivery path for partial batches.
- After receipt, inventory posting and document evidence progress separately. Generated and signed receipts for **every received batch**, including warehouse and site batches, must be archived to Google Drive. Receiving teams upload signed receipts; Accounting can supply missing evidence and archives remaining accounting documents. Corrected quantities require current-version evidence before Accounting can mark document review complete.
- Payment settlement, site inventory posting and document review are distinct milestones. Their rounded shapes do not imply automatic PO/MRF closure. Material usage is ongoing after inventory posting, not a completion gate. Core review steps include resolution of invalid evidence; the figures omit screen actions, detailed formulas, archive retry mechanics and legacy payment requests.

## Maintain and regenerate

Update the logical flow and fixed publication positions in model.mjs when [the workflow](../../WORKFLOW.md) changes. The Mermaid files describe the same connections with automatic layout; publication SVGs use fixed routes for legible paper figures.

```powershell
node docs/thesis/pfd/generate.mjs
node docs/thesis/pfd/generate.mjs --check
node docs/thesis/pfd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter reuses the existing cached Puppeteer installation and Edge configuration, without adding application dependencies. [Validation](VALIDATION.md) records flow checks, layout checks and export checks. No app or database behavior is changed.

Sources: [workflow](../../WORKFLOW.md), [delivery-clearance rules](../../../src/domain/workflow.ts), [payment coordination](../../../src/domain/payment-coordination.ts), and [receipt evidence requirements](../../../src/domain/delivery-archive.ts).
