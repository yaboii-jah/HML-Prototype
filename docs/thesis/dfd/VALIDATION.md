# DFD validation

Verified against the current workflow on 2026-10-15.

- **context**: 11 visible symbols; 20 labeled flows; minimum 13.46 pt at 277 mm width. PNG 5600 × 3000 pixels. Exactly one selectable-text PDF page.
- **level1**: 38 visible symbols; 59 labeled flows; minimum 11.06 pt at 277 mm width. PNG 8800 × 6000 pixels. Exactly one selectable-text PDF page, A4 landscape.

- Context contains one process and ten external entities; no stores or internal sub-processes.
- Level 1 contains six distinct processes, six distinct logical stores and ten external entities. Repeated symbols retain canonical identities.
- All 20 context inputs/outputs balance with the Level 1 boundary payloads; the generator compares exact data sets.
- All processes and stores have inputs and outputs. Every Level 1 flow touches a process; no direct external-to-store, store-to-store or external-to-external arrows.
- All arrows have named information labels and terminate on node borders.
- Level 1 connectors have zero crossings, overlapping segments or connector/label collisions. Repeated neighbors keep connections local; removing them would introduce long links across process groups.
- Boundary payloads and store endpoints match the fixed approved-flows.json baseline.
- Every visible label fits the canvas; labels do not overlap nodes or each other. Node labels fit their shapes.
- Stock availability, transfer proposals, source release decisions, trip schedules and transfer receipt evidence are represented; transfers have no payment or supplier-clearance dependency.
- Supplier quotations enter from Supplier and issued purchase orders return to Supplier at both levels. The accompanying documentation explains that Procurement mediates these exchanges; no direct supplier access is implied. The context figure contains no explanatory footer.
- Finance plans, Accounting verification, credit/upfront clearance, reviewed AI drafts and warehouse/site quantities remain distinct information.
- Diagram sources and notes derive from one model. Run node docs/thesis/dfd/generate.mjs --check for consistency.

These are diagram/model checks; no app or database changes were made.
