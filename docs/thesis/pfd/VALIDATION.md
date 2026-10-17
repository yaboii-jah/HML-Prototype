# Process flow validation

Checked against docs/WORKFLOW.md and the delivery/payment rules on 2026-10-15.

- **Request and fulfillment overview**: 11 symbols, 12 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 5520 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Supplier purchasing and PO approval**: 9 symbols, 10 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 5760 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Payment coordination and delivery clearance**: 14 symbols, 15 connections. One A4 landscape PDF, selectable text of at least 10.42 pt; PNG 7840 × 5360 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Inter-site stock transfer**: 9 symbols, 9 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 5520 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Delivery, receiving and inventory**: 14 symbols, 14 connections. One A4 landscape PDF, selectable text of at least 10.42 pt; PNG 7840 × 5360 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Receipt documentation and review**: 6 symbols, 6 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 4480 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.

- The request and fulfillment overview supports purchase-only, transfer-only and mixed MRF quantities. Existing project setup is a prerequisite. Issued supplier POs proceed to payment coordination.
- Site transfers require Procurement's matching-description/unit verification and availability check, followed directly by source release and dispatch before destination receiving; transfers have no destination suitability-review or PO/payment path.
- Reduced/rejected release quantities and missing transfer quantities return to material sourcing without reversing source dispatch; accepted site quantities still reach stock posting independently.
- Warehouse and site receipt evidence each proceeds to documentation and review. Warehouse documentation does not wait for site arrival, and receipt review never gates site stock posting.
- All nodes are reachable, decisions have labeled outcomes, and approval returns/rejections/holds retain their meaning.
- Upfront delivery cannot bypass full verified payment. A failed payment/proof check loops for resolution.
- Credit clearance reaches supplier delivery without entering the payment path. Payment settlement is reachable without entering delivery/document activities. Partial payment loops to Finance follow-up and never retriggers clearance.
- Direct site receipt and warehouse receipt/transfer/site receipt are both reachable.
- Site inventory and document review finish independently; neither closes the MRF. Warehouse receipt does not post site inventory. Receipt review loops incomplete or unacceptable evidence for correction and re-archiving.
- Entries and handoffs name business events and processes. Visible node/arrow labels and active explanations are checked to reject figure-letter references and the former abbreviated credit connector.
- Connectors are orthogonal and continuous, start/end on separate symbol ports and do not touch unrelated shapes. Geometry checks reject connector crossings, shared segments and self-intersections. The Credit connector routes independent credit paths; off-page handoffs name their next process.
- Actual rendered label bounds are checked against every connector, including their own, with 2 px clearance. Label backgrounds cannot hide lines. No white under-strokes erase connector intersections. Layout checks also reject clipped text, overlapping labels, labels covering shapes, and text outside decision diamonds.
- Each active PDF is one A4 page in its documented orientation with selectable node/branch text and actual text of at least 10 pt. The SVG preserves vector text; the PNG renders at 4× resolution.
- Run node docs/thesis/pfd/generate.mjs --check to check model and editable-source consistency.

These are documentation/export checks. No application or database changes were made.
