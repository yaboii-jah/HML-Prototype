# ConstructSync Core Business Flow Figures

**36 screenshots · 1440 × 900 · light theme.**

This collection follows one connected upfront purchase, one credit purchase, and one site stock transfer. Shared purchasing steps appear once. Core figures explain the process; supporting figures provide additional detail and may be omitted from the final paper. Collection numbers are suggested ordering, not final thesis figure numbers.

[Open visual gallery](index.html) · [Caption spreadsheet](FIGURE_CAPTIONS.csv) · [Validation](VALIDATION.json)

## Process order

Project and scope budgets → MRF → Project Manager approval → Procurement stock check → Quotation review → Supplier comparison and awards → PO preparation → Accounting review.

Upfront: PO issuance → Finance coordination → Accounting payment verification → Delivery clearance → Logistics → Site receiving → Stock posting → Document review → Usage.

Credit: Agreed due date → Delivery clearance while unpaid → Verified installment → Verified settlement. Shared receiving steps follow the upfront example.

Transfer: Matching source stock → Source approval → Trip scheduling → Dispatch/source deduction → Destination receiving → Destination posting → Accounting evidence review.

## Capture method and limits

The native app is captured in an isolated browser profile. Connected fictional records progress through the app's domain commands; their snapshots are displayed through the normal role interfaces. No screenshot changes application text or layout. Real local PDF bytes support the fictional archived documents. Existing app data, earlier screenshots, and Google Docs are preserved.

Each image is a separate viewport capture. The collection demonstrates successful business processes, rather than every page, field, role, pagination page, or exception. Figure titles describe the stage shown; screenshots containing action buttons show the step before confirmation. Finance coordinates payment; Accounting verifies it. Transfer stock is deducted on dispatch and posted at the destination after receipt.

Reproduce with `node scripts/capture-core-business-flow.mjs`, then `python scripts/package-core-business-flow.py`. The app must be running at `http://127.0.0.1:3000` (override with `CORE_FLOW_APP_URL`).
