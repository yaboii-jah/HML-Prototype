# ConstructSync QA fixes

Source: **ConstructSync QA.pdf**, six pages. Updated: 2026-10-10.

This checklist tracks the agreed implementation. Finding 11 is explicitly deferred. Payment calculations, full-payment requirements, credit delivery clearance and role ownership remain unchanged.

| QA | Change | Verification |
| --- | --- | --- |
| 1 | Confirm deletion of unused projects by Administrator / Project Manager; reject linked records and active folder setup; retain Drive folders and audit ownership. | Domain regression + browser confirmation/cancellation. |
| 2 | Restore a centered 1,550px workspace; center the request wizard and import panel at 1,100px. | Browser checks at 1,920 / 2,560px. |
| 3 | Theme-aware autofill surface, text and caret. Browser suggestion popup is outside scope. | CSS and theme inspection; verify native autofill with saved browser values during acceptance. |
| 4 | Larger PDF.js previews, fit-width default, continuous scrolling, optional thumbnails and image/external fallbacks. | PDF viewer browser regression. |
| 5 | Prominent, consistent Close controls with keyboard focus and 44px targets. | Shared modal and preview browser checks. |
| 6 | Center `/requests/new`, retain its three-step layout and responsive spacing. | Request wizard responsive checks. |
| 7 | Add missing removal confirmations for request materials, supporting PDF, AI sources, empty supplier groups and editable PO materials/charges. | Browser cancel checks; existing quotation confirmation checks. |
| 8 | Accessible SVG Close icon for editable and read-only material modals. | Request wizard/modal checks. |
| 9 | Stronger pinned heading surface, rule and shadow. | Existing sticky heading geometry retained; browser scroll checks. |
| 10 | Prominent extraction spinner, current group/files and actual completed/failed counts. | Delayed mocked AI extraction browser check. |
| 11 | Complete quotation-review redesign. | **Deferred by agreement.** |
| 12 | Confirmed Finalize ready drafts; preflight domain rules and local files; separate finalization and archive outcomes; retain unresolved drafts. | Bulk browser check with invalid draft and archive failure. |
| 13 | Confirmed atomic Apply all edits; preserve partial sourcing and per-material Apply. | Domain rollback/permissions tests + multi-material browser check. |
| 14 | Compact PO detail summary and prominent preview, without duplicate static material/charge tables. | Browser presence/absence checks; editable Accounting materials retained. |
| 15 | Accounting document and VAT/withholding disclosures closed initially; reveal fields on validation failure. | Browser initial-state and failed-approval checks. |
| 16 | Editable Accounting materials table with local bounded scrolling and all rows mounted. | 50-row browser checks and cancellation. |
| 17 | Approved-PO archive actions aligned right with spacing and mobile wrapping. | Responsive Accounting view. |
| 18 | Shared labeled chooser/drop area for upfront and credit payment proof, requirements, working state, file status and retry/removal controls. | Full-disbursement and credit regression. |
| 19 | Explicit light/dark native date-input color scheme and visible calendar indicator. | Browser/theme inspection; native picker acceptance check. |
| 20 | Editable company warehouse address default; preserve typed destination when switching routes. | Browser default and route-switch checks. |
| 21 | Scheduling, receipt and stock-posting tables with sticky headings and bounded scrolling; all rows remain in FormData. | 50-row FormData check + receiving/posting browser regression. |
| 22 | Shared Accounting/delivery documents, current generated/signed evidence, collapsed earlier versions and PDF.js preview. | Delivery evidence/archive/version and responsive browser regression. |
| 23 | Current-version, role-specific receipt tasks and links to evidence; complete dashboard task list reachable from notifications. | Domain tests for missing/pending/failed/complete/corrected evidence and 12 batches. |
| 24 | Explicit Finance Active / Settled views, retained legacy disbursements and correct settlement history labels. | Finance settled/read-only browser check + existing payment reversal tests. |

## Checks

- `npm test`: 217 tests passed, including ten new QA domain regressions.
- `npx tsc --noEmit` and `npm run lint`: passed.
- `node scripts/qa-fixes-smoke.mjs http://127.0.0.1:3000`: passed, including request-wizard, date-theme and material-close checks.
- `node scripts/delivery-documents-smoke.mjs http://127.0.0.1:3000`: passed.
- `node scripts/full-disbursement-smoke.mjs http://127.0.0.1:3000`: passed.
- `node scripts/document-gallery-smoke.mjs http://127.0.0.1:3000`: passed.
- `node scripts/quotation-confirmations-smoke.mjs http://127.0.0.1:3000`: passed.
- `npm run build -- --webpack`: passed (this Windows environment blocks the native SWC extension).

Browser tests use isolated profiles and mock external Drive/AI responses. They verify app behavior rather than production service connectivity. Responsive checks cover both themes at 320, 375, 414, 768 and desktop widths. No stored schema migration or workspace reset is required.

## Design references

The upload component adapts labeled file selection, drag-and-drop and explicit feedback from [Carbon File uploader](https://v10.carbondesignsystem.com/components/file-uploader/usage/) and [GOV.UK File upload](https://design-system.service.gov.uk/components/file-upload/), using the existing app palette and typography.

## Acceptance follow-up

- Recheck native autofill using saved browser data; browser suggestion menus are controlled by the browser.
- Open the native date picker in light and dark themes on the client's browser.
- Verify a real supplier quotation, payment proof and signed receipt archive against the company Drive configuration.
- Keep [WORKFLOW.md](../WORKFLOW.md) and this checklist current when these behaviors change.
