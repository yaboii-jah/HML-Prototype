# Quotation worksheet prototype

Question: can Procurement review original supplier data comfortably in an editable, MRF-aligned bid worksheet before finalizing each quotation?

This is throwaway UI on `revision/procurement-process`. Its sample quotations, simulated archives, edits and Undo/Redo stay in memory. It does not call extraction, Drive, allocation or purchasing commands. The original quotation route remains available without the prototype parameter; production ignores the prototype parameter.

## Open it

Run `npm run prototype:quotation-review`. The preview uses port 3200 and its own build cache and TypeScript configuration. Sign in with a department account from [Presenter access](PRESENTER_ACCESS.md).

- [A — Full-width workbook](http://localhost:3200/requests/prototype/quotes?reviewPrototype=1&variant=A): a dense comparison worksheet with optional right-hand inspectors.
- [B — Source workbench](http://localhost:3200/requests/prototype/quotes?reviewPrototype=1&variant=B): the original document and editable worksheet side by side, with details below.
- [C — Review navigator](http://localhost:3200/requests/prototype/quotes?reviewPrototype=1&variant=C): a material/issue worklist, worksheet and docked details.

Use the floating arrows to change layout. Worksheet edits survive switching variants and disappear on reload. Reset restores the sample. Try 100 materials changes the sample density.

## Try these interactions

1. Select a quantity or price cell. Enter starts editing; Tab commits and moves to the next editable cell; Escape cancels. Shift-click or Shift-arrow selects a range. Ctrl+C copies selected values.
2. Select MetroBuild's plywood quantity cell. Open Paste values and paste `18`, `sheet`, `650`, `11700`, `20`, `sheet`, `620`, `12400` as one tab-separated row. Preview identifies both affected suppliers. Pasted amounts are retained as printed amounts; calculated totals remain controlled by the worksheet.
3. Cancel a paste and confirm nothing changed. Apply it, then use Undo/Redo or Ctrl+Z/Ctrl+Y. A paste into a finalized supplier or missing offer slot is blocked as a whole.
4. Expand the cement alternatives. Open Offer details to inspect descriptions and conversions. Confirm selected matches only after checking the originals and explaining unit differences.
5. Open Unmatched & extras and assign an extra to an MRF material. Undo returns it to the extra sheet without deleting the source line.
6. Toggle Originals. Selecting a known offer chooses its file/page. Unknown provenance is labelled; choose a file/page manually and use Link this file/page. Source pages are illustrative HTML documents containing immutable sample values, not actual uploaded PDFs.
7. Select a supplier header to edit reference, terms and charges. Finalize a ready supplier; the worksheet stays open while its archive is simulated. A simulated outage can be retried. Only archived PHP quotations enable the simulated allocation handoff.

The sample contains drafts, AI/manual entry, a finalized read-only supplier, an archive error, missing bids, alternatives, extras, USD pricing, conversion issues and printed-total discrepancies. Prototype state and simulated activity are available below the worksheet.

## Review and capture

Verdict: **pending user review**. Choose a layout or identify elements to combine. The real implementation will need atomic quotation saves, production-grade cell navigation/paste/undo, optional source-file provenance, an embeddable real document viewer, and integration tests. Preserve the prototype on this branch as the design reference; do not merge its sample controls or layout switcher into main.
