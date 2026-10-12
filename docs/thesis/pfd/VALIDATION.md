# Process flow validation

Checked against docs/WORKFLOW.md and revised delivery/payment rules on 2026-10-11.

- **Full Disbursement and Credit / Terms**: 35 symbols, 41 connections. One A4 landscape PDF, selectable text of at least 10.04 pt; PNG 6960 × 4800 pixels. 0 connector crossings, 0 overlapping segments and 0 connector/label collisions.

- All nodes are reachable, decisions have labeled outcomes, and approval returns/rejections/holds retain their meaning.
- Upfront delivery cannot bypass full verified payment. A failed payment/proof check loops for resolution.
- Credit delivery reaches site inventory without entering the payment path. Payment settlement is reachable without entering delivery/document activities. Partial payment loops to Finance follow-up.
- Direct site receipt and warehouse receipt/transfer/site receipt are both reachable.
- Site inventory and document review finish independently; neither closes the MRF. Warehouse receipt does not post site inventory.
- Connectors are orthogonal and continuous, start/end on separate symbol ports and do not touch unrelated shapes. Geometry checks reject connector crossings, shared segments and self-intersections. Intentional split/merge points have explicit junction dots.
- Actual rendered label bounds are checked against every connector, including their own, with 2 px clearance. Label backgrounds cannot hide lines. No white under-strokes erase connector intersections. Layout checks also reject clipped text, overlapping labels, labels covering shapes, and text outside decision diamonds.
- The combined PDF is one A4 landscape page with selectable node/branch text and actual text of at least 10 pt. The SVG preserves vector text; the PNG renders at 3× resolution.
- Run node docs/thesis/pfd/generate.mjs --check to check model and editable-source consistency.

These are documentation/export checks. No application or database changes were made.
