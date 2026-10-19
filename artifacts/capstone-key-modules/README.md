# ConstructSync — Key Module Screenshots

**16 figures · 12 primary modules + 4 supporting views · light theme**

Each PNG is a native desktop viewport screenshot at 3200 × 2000 pixels. Most use a 1600 × 1000 CSS viewport at 2× pixel density; the comparison uses 2000 × 1250 at 1.6× density. Its native horizontal scroll is positioned at the winning supplier and saved-award columns. Numbering gives collection order; assign final thesis figure numbers in the paper.

[Visual gallery](index.html) · [Figure captions](FIGURE_CAPTIONS.csv) · [Figure index](FIGURE_INDEX.md) · [Validation](VALIDATION.json)

## Data and test provenance

All figures follow the original MRF 372 and the four supplier quotation PDFs in `sample-data/`. The source PDFs are read without modification. Reviewed manual inputs are checked against their printed text, including the eight requested materials, quantities, units, prices, line amounts, VAT-inclusive treatment and quotation totals. Source hashes appear in `SAMPLE_TEST_RESULTS.json`. This run does not test live AI extraction or Google Drive.

The application assigns MSR-MRF-0001 while retaining MRF-372 as the source reference. Kestrel supplies seven materials through an upfront PO; Apex supplies 56 glass clamps through a credit PO. Four more clamps come from a source project, leaving 16 of its initial 20 clamps. One grouped usage entry consumes two 900 × 2100mm glass panels and one silicone cartridge, leaving 10 panels and 23 cartridges. Destination clamp stock is 60. Consumption reconciles all nine project/material rows with the stock ledger, and retrying the saved usage command creates no second deduction.

The original quotations specify 30-day terms. The Kestrel upfront arrangement is a subsequent fictional supplier agreement used to illustrate that branch. Project allocations, source opening stock, payment proofs, invoices and receiving acknowledgements are supplemental demonstration fixtures. Screenshots show different documented stages of one connected example; they are not all from its final state.

## Capture and selection

The isolated Edge profile uses the normal app screens and named department accounts. Record snapshots progress through the app's domain commands. Original supplier PDFs appear in the native source viewer, and generated company documents use the app's existing generators. Screenshots use native controls, scrolling and filters, with no altered application labels or layout. Existing browser workspaces and earlier figure collections are preserved.

Figures 1–12 each represent one module. Figures 13–16 show quotation review, comparative bidding, grouped usage and consumption. Administration shows a user editor and project assignments; no password or reset form is captured. Supporting files explain simulated transactions so the paper can distinguish screenshot evidence from live integration testing.

Tables and worksheets retain representative visible rows within their native scrolling areas. The comparative bid is scrolled to the winning supplier and saved-award columns; other offers remain accessible in the application. These are separate viewport screenshots, without stitching or layout changes.

## Reproduce

With the app running locally at `http://127.0.0.1:3000`:

```powershell
node --experimental-strip-types scripts/capstone-module-scenarios.mjs --validate-scenario
node --experimental-strip-types scripts/capture-core-business-flow.mjs --capstone
python scripts/package-capstone-figures.py
```

`CORE_FLOW_APP_URL` overrides the app address. Sample verification requires no temporary extraction cache or AI credentials. PNG files, captions, gallery links, unique images, module coverage and source hashes are verified during packaging. Visual review of all 16 images is recorded in `VALIDATION.json`.
