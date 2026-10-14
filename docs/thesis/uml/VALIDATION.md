# UML class diagram validation

Verified on 2026-10-14.

- 11 classes, 53 essential attributes, 24 conceptual operations, and 17 associations match CLASS_MODEL.md.
- Attributes and types match the core ERD; all operations have documented role responsibilities.
- 34 endpoint multiplicities; one filled composition diamond at MRF; one explicit Delivery XOR ownership note.
- Source/destination transfer associations have separate labeled routes.
- Orthogonal association routes have zero crossings, shared segments, or unrelated class intersections.
- Rendered text fits the class compartments, note, and canvas; endpoint and role labels do not overlap classes, labels, or connector paths.
- Every visible label is at least 8.66 pt at 240 mm insertion width.
- PNG is 4950 by 3690 pixels. SVG and PDF are approximately 240 by 178.91 mm.
- PDF is exactly one page with all class names, attributes, and operations selectable.
- The editable Mermaid source also renders successfully; its automatic layout differs from the fixed publication layout.

Business scenario acceptance checks remain in [CLASS_MODEL.md](CLASS_MODEL.md). These are documentation/export checks, not application behavior tests.

Recheck the source with `node docs/thesis/uml/generate.mjs --check`; regenerate exports with `node docs/thesis/uml/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"`.
