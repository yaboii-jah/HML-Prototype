# ConstructSync core UML class diagram

This thesis domain diagram contains **11 classes, 53 essential attributes, 24 conceptual operations, and 17 associations**. It follows the approved [class specification](CLASS_MODEL.md) and the [core ERD](../erd/README.md).

[Academic description for the paper](PAPER_DESCRIPTION.md) explains the classes and their relationships in two paragraphs.

## Files for the paper

| Format | File | Use |
|---|---|---|
| PDF | [constructsync-class-diagram.pdf](constructsync-class-diagram.pdf) | One-page vector figure with selectable text. |
| PNG | [constructsync-class-diagram.png](constructsync-class-diagram.png) | High-resolution image for Word or Google Docs. |
| SVG | [constructsync-class-diagram.svg](constructsync-class-diagram.svg) | Scalable figure for editing or insertion. |
| Mermaid | [constructsync-class-diagram.mmd](constructsync-class-diagram.mmd) | Editable class-diagram source for Mermaid tools. |

Use a landscape page and insert the image at **230–240 mm wide**, preserving its proportions. The figure is 240 × 178.91 mm, and the PNG is 4950 × 3690 pixels. At 230 mm, every label is at least 8.30 pt. Place the paper's caption outside the figure; for example, **Figure X. ConstructSync Core UML Class Diagram**.

## Read the diagram

- Each class has three compartments: class name, essential typed attributes, and selected operations.
- Solid connectors are associations. `1`, `0..1`, and `0..*` indicate exactly one, optional one, and zero or many related objects at the corresponding endpoint.
- The filled diamond at MRF identifies composition: MRFItem belongs to its MRF. Draft requests may have no items; submission requires at least one valid item.
- The User-Project relationship represents Site Personnel assignments. Department roles remain values of User.role, rather than subclasses.
- Separate Project-StockTransfer routes identify source and destination. They must differ; the destination is the MRF's project.
- The Delivery note requires **exactly one owner: PurchaseOrder or StockTransfer**. The two individually optional associations do not permit both owners or neither.
- Header colors match the corresponding ERD entities and carry no relationship meaning. Sources and the operation-specific permissions are in [CLASS_MODEL.md](CLASS_MODEL.md).

Operations describe domain responsibilities, not implemented instance methods. Payment verification, delivery clearance, receiving, and stock posting remain distinct milestones. Supporting item, scope, document, and history classes are outside this overview. The two prototype delivery record types are represented by one conceptual Delivery class; no implemented inheritance is implied.

## Regenerate and check

```powershell
node docs/thesis/uml/generate.mjs
node docs/thesis/uml/generate.mjs --check
node docs/thesis/uml/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

[model.mjs](model.mjs) reads class members and relationship semantics from CLASS_MODEL.md and defines the fixed paper layout. The exporter reuses cached Mermaid CLI/Puppeteer, the existing headless Edge configuration, and the repo's PDF libraries. It validates geometry, text bounds, multiplicities, composition, PDF text, and Mermaid syntax. [VALIDATION.md](VALIDATION.md) records the result.

Mermaid uses an automatic layout, so its positions differ from the fixed SVG/PNG/PDF arrangement. Update the class specification and regenerate the Mermaid source together; position or membership changes must also satisfy the publication layout checks.
