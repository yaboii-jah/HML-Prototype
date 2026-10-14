# Core ERD validation

Verified on 2026-10-13.

- Exactly 11 connected entities, 85 business fields and 16 unlabeled Crow's Foot relationships.
- Unique entity/field names, one PK per entity and valid type-matched FK targets.
- All connector endpoints terminate on their entity borders; orthogonal routes do not pass through boxes.
- All sixteen relationship routes have zero crossings, overlapping segments or accidental junctions. Source and destination Project links use separate lanes; every cardinality endpoint remains visible.
- No numeric relationship labels appear. Endpoint symbols retain cardinalities.
- Eleven distinct header colors are retained; no legend is present and tables do not overlap.
- Visible text is limited to table names, fields, keys and the Delivery XOR constraint. No legend, numeric connector labels, diagram title or explanatory caption is present.
- All displayed fields and headers fit their boxes and canvas.
- Every label is at least 8.17 pt at the intended 160 mm width.
- SVG is 160 × 162.54 mm, preserving scalable text and colored headers.
- PNG is 5040 × 5120 pixels, generated from that SVG.
- PDF is exactly one figure-sized page, approximately 160 × 162.54 mm; every entity title and field is selectable text.
- Mermaid and publication outputs use the same entity and relationship definitions; Mermaid's automatic positions differ from the fixed paper layout.

## Scenario review

These checks concern the reduced model, not an installed database or runtime changes.

| Scenario | Representation |
|---|---|
| Internal transfer or mixed fulfillment | Stock Transfer links one MRF to source/destination projects; material-level quantities remain in supporting lines. |
| Independent delivery source | Delivery requires exactly one PO or transfer parent, explicitly marked XOR; trips need no fictional PO. |
| Source release and site balances | Source confirmation, transfer-out at dispatch and transfer-in for accepted destination stock are retained in notes. |
| Several suppliers and split sourcing | Multiple quotations and POs per MRF; detailed line allocations are explained outside the figure. |
| Unmatched offered extras | Detailed matches are omitted; notes preserve the confirmed-match requirement before award. |
| Partial credit payments | One PO can have zero or many Accounting-verified payments; delivery need not wait for settlement. |
| Upfront payment | Full verified net payment remains required before separate Accounting delivery clearance. |
| Finance schedule versus Accounting due date | PO planned_date and due_date remain separate; current coordination is summarized on the PO. |
| Vendor edited during Accounting review | PO has its own supplier FK and separately retains its source quotation. |
| Partial deliveries and warehouse forwarding | A PO has multiple deliveries distinguished by leg; source/line structures are omitted from the core figure. |
| Site receipts, usage and adjustments | Delivery is optional for inventory movements; project is required and balances are derived. |
| Scope budgets and shared material identities | Supporting structures are documented outside the figure. |
| Required proof and other documents | Essential proof reference is visible; document storage and multiple associations remain documented supporting detail. |

## Recheck

Run node docs/thesis/erd/generate.mjs --check for canonical source consistency. The exporter additionally checks actual rendered labels, print size, PDF page count and selectable fields.
