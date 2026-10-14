# Process flow validation

Checked against docs/WORKFLOW.md and revised delivery/payment rules on 2026-10-13.

- **Request and fulfillment overview**: 11 symbols, 12 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 5280 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Supplier purchasing and payment**: 21 symbols, 24 connections. One A4 landscape PDF, selectable text of at least 10.42 pt; PNG 7840 × 5360 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Site stock transfer**: 7 symbols, 6 connections. One A4 portrait PDF, selectable text of at least 11.75 pt; PNG 4400 × 4720 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.
- **Delivery, receiving and records**: 14 symbols, 14 connections. One A4 landscape PDF, selectable text of at least 10.42 pt; PNG 7840 × 5360 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.

- A supports purchase-only, transfer-only and mixed MRF quantities. C requires source release and dispatch before destination receiving in D, with no PO/payment path.
- Warehouse receipt evidence reaches document review independently of site arrival through matching W connectors.
- All nodes are reachable, decisions have labeled outcomes, and approval returns/rejections/holds retain their meaning.
- Upfront delivery cannot bypass full verified payment. A failed payment/proof check loops for resolution.
- Credit delivery reaches site inventory without entering the payment path. Payment settlement is reachable without entering delivery/document activities. Partial payment loops to Finance follow-up.
- Direct site receipt and warehouse receipt/transfer/site receipt are both reachable.
- Site inventory and document review finish independently; neither closes the MRF. Warehouse receipt does not post site inventory.
- Connectors are orthogonal and continuous, start/end on separate symbol ports and do not touch unrelated shapes. Geometry checks reject connector crossings, shared segments and self-intersections. Named CR and W circles explain independent credit paths and warehouse-evidence continuations. All cross-chart references identify existing A-D figures.
- Actual rendered label bounds are checked against every connector, including their own, with 2 px clearance. Label backgrounds cannot hide lines. No white under-strokes erase connector intersections. Layout checks also reject clipped text, overlapping labels, labels covering shapes, and text outside decision diamonds.
- Each active PDF is one A4 page in its documented orientation with selectable node/branch text and actual text of at least 10 pt. The SVG preserves vector text; the PNG renders at 4× resolution.
- Run node docs/thesis/pfd/generate.mjs --check to check model and editable-source consistency.

These are documentation/export checks. No application or database changes were made.
