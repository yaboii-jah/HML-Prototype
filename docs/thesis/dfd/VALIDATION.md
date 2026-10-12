# DFD validation

Verified against the revised workflow on 2026-10-11.

- **context**: 11 visible symbols; 20 labeled flows; minimum 12.34 pt at 277 mm width. PNG 4200 × 1950 pixels. Exactly one selectable-text PDF page.
- **level1**: 37 visible symbols; 57 labeled flows; minimum 10.66 pt at 277 mm width. PNG 4860 × 3270 pixels. Exactly one selectable-text PDF page, A4 landscape.

- Context contains one process and ten external entities; no stores or internal sub-processes.
- Level 1 contains six distinct processes, six distinct logical stores and ten external entities. Repeated symbols retain canonical identities.
- All 20 context inputs/outputs balance with the Level 1 boundary payloads; the generator compares exact data sets.
- All processes and stores have inputs and outputs. Every Level 1 flow touches a process; no direct external-to-store, store-to-store or external-to-external arrows.
- All arrows have named information labels and terminate on node borders.
- Level 1 connectors have zero crossings, overlapping segments or connector/label collisions. Repeated neighbors keep connections local; removing them would introduce long links across process groups.
- Boundary payloads and store endpoints match the fixed approved-flows.json baseline.
- Every visible label fits the canvas; labels do not overlap nodes or each other. Node labels fit their shapes.
- Finance plans, Accounting verification, credit/upfront clearance, reviewed AI drafts and warehouse/site quantities remain distinct information.
- Diagram sources and notes derive from one model. Run node docs/thesis/dfd/generate.mjs --check for consistency.

These are diagram/model checks; no app or database changes were made.
