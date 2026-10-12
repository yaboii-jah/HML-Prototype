# Core ERD validation

Verified on 2026-10-11.

- Exactly 10 connected entities, 77 business fields and 12 unlabeled Crow's Foot relationships.
- Unique entity/field names, one PK per entity and valid type-matched FK targets.
- All connector endpoints terminate on their entity borders; orthogonal routes do not pass through boxes.
- No numeric relationship labels appear. Endpoint symbols retain cardinalities.
- Ten distinct header colors are retained; no legend is present and tables do not overlap.
- Visible text is limited to table names, fields and keys. No legend, numeric connector labels, diagram title or explanatory caption is present.
- All displayed fields and headers fit their boxes and canvas.
- Every label is at least 8.13 pt at the intended 160 mm width.
- SVG is 160 × 143.33 mm, preserving scalable text and colored headers.
- PNG is 3840 × 3440 pixels, generated from that SVG.
- PDF is exactly one figure-sized page, approximately 160 × 143.33 mm; every entity title and field is selectable text.
- Mermaid and publication outputs use the same entity and relationship definitions; Mermaid's automatic positions differ from the fixed paper layout.

## Scenario review

These checks concern the reduced model, not an installed database or runtime changes.

| Scenario | Representation |
|---|---|
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
