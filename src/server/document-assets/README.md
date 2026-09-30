# Supplied company forms

The blank PDF backgrounds were derived from the user's `SAMPLE P.O.pdf`, `SAMPLE PURCHASE REQUISITION.pdf`, and `SAMPLE COMPARISON.pdf`. Original artwork, vector grids, static wording and page dimensions are retained. Sample transaction text, link annotations and URL underlines were removed. Dynamic text is overlaid using Arial regular/bold and the source forms' coordinate systems.

`scripts/prepare-document-templates.mjs <PO.pdf> <comparison.pdf> <MRF.pdf>` regenerates these assets on Windows. It copies Arial from the system fonts and extracts original logos. Review the retained-text allowlist if the source forms change.

`node scripts/document-template-check.mjs` writes reproducible PDF and Excel fixtures under `.next/template-check/` for visual comparison. The PO fixture reproduces the supplied sample amounts; application references keep their existing numbering. Long cells use continuation pages rather than losing content.

On Windows, `scripts/render-document-templates.ps1` renders those PDF fixtures to PNGs for inspection.

Server deployment includes this directory through `outputFileTracingIncludes` in `next.config.ts`.
