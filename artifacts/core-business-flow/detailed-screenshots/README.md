# MRF 372 — Detailed Business Flow Screenshots

**93 separate screenshots · 1440 × 900 · light theme.**

Start with login, project creation, scope allocation and personnel assignments, then follow the same source MRF 372, original combined MRF/key-plan PDF, and all four original supplier quotations. One app MRF links two supplier POs and one stock transfer. Each process has its own folder.

[Open gallery](index.html) · [Caption spreadsheet](FIGURE_CAPTIONS.csv) · [Test results](SAMPLE_TEST_RESULTS.json)

## Connected example

Login → Project Manager dashboard → Project creation and confirmation → Architectural scope allocation → Site Personnel project assignments → MRF 372 import review and supporting attachment → Project Manager approval/archive → Source stock check/release → Four supplier quotation reviews → Comparison and awards → Two purchase orders.

Kestrel supplies seven materials through the upfront-payment example. Apex supplies 56 glass clamps through the credit/terms example. Four matching clamps come from a source project. The destination therefore receives all 60 requested clamps. Two delivered glass panels are subsequently recorded as used.

Both supplier deliveries and the transfer finish with receiving, stock posting, archived evidence, and Accounting review. Finance coordinates supplier payment; Accounting verifies it. Collection numbers are ordering aids; assign final thesis figure numbers in the paper.

## Original sources and testing

The five PDFs are read directly from `sample-data/`. They remain unchanged. Live app extraction endpoints verified eight MRF materials, eight lines per quotation, quantities, VAT-inclusive treatment, printed line amounts and supplier totals. See `SAMPLE_TEST_RESULTS.json` for file hashes and amounts. Original bytes are used in the app's source previews and supporting attachment. Approved MRFs, POs and delivery/transfer receipts use the app's document generator.

All original quotations specify 30-day payment terms. Kestrel's upfront arrangement is a subsequent **fictional supplier agreement** used to demonstrate that branch; it is not claimed to be printed in the quotation. Payment proofs, invoices and signed acknowledgements are demonstration evidence, not actual payments or deliveries. Source opening stock is also a demonstration fixture.

## Isolation and reproduction

An isolated browser profile displays connected snapshots advanced through the real domain commands. No app labels or layouts are altered for screenshots. Existing browser data, the original 36 screenshots, and Google Docs are preserved. Successful actions and their resulting states are separate figures where useful; no full-page or stitched images are used.

Run `node scripts/test-mrf372-samples.mjs` to refresh live extraction results, `node scripts/capture-core-business-flow.mjs --mrf372` to capture, `node scripts/core-flow-contact-sheet.mjs --mrf372` for the contact sheet, then `python scripts/package-detailed-screenshots.py` to validate and package. The local app must be running at port 3000; `CORE_FLOW_APP_URL` overrides its address.
