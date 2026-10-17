# ConstructSync audit coverage

Date: 16 October 2026. Read with [the findings](FULL_APP_AUDIT.md) and [verification summary](../../artifacts/app-audit/verification-summary.json).

## Environment and method

- Current working tree, starting HEAD `c62142118b243fab1abbc42984d81117cb20edef`; existing changes were retained. Node 24.19.0, Next 16.3.6, React 19.2.8, Windows headless Microsoft Edge.
- Production build/server on `http://127.0.0.1:3100`. Disposable browser profiles; each suite owns its storage. The independent sweep prevented external Drive and extraction calls. Other suites use their existing mocks; the live MRF import script was excluded.
- Initial 295 tests, ESLint and TypeScript passed. The production build passed after retrying Google Fonts downloads with network access. The final ESLint run also passed with the audit helpers present.
- Browser state was varied only in disposable profiles. Original app files and regression scripts were not edited. Audit-only copies live under the evidence directory, with their adaptations documented in `adapt-suites.mjs`.
- Results below distinguish **Passed**, **Failed**, and **Blocked**. A failed script does not establish that every feature it intended to cover is broken. Later unexecuted assertions are blocked until its setup/selector failures are repaired.

## Workflow and module outcomes

| Area/scenario | Outcome | Evidence and practical limit |
| --- | --- | --- |
| Populated workspace, first install, saved edits and replacement backup | Passed | Original showcase suite: generated local PDF/XLSX, persisted edits, interrupted-install recovery, storage failure, explicit clearing without reseeding. |
| Sign-in, department switching, remembered access and user revisions | Passed for exercised scenarios; broad suite failed | Showcase/shell/site-visibility suites and adapted user management passed. Broad smoke stops on obsolete revision 1. Wrong credentials/session rules also have domain tests. |
| User add/edit/reset/deactivate/reactivate and session invalidation | Passed in audit copy | Adapted user-management suite reaches its final assertions, including cross-tab account invalidation. Original suite remains failed. |
| Project creation, project code, budget/scopes and role restrictions | Passed for exercised scenarios | Adapted user-management suite and domain project/numbering tests. Original numbering/project-folder scripts still fail on obsolete selectors. |
| MRF form, material edit/view, review and modal focus | Passed in audit copy | Adapted material-row suite reaches its final assertions; independent mobile form rendering. Complete submit/return/resubmit branches are protected by domain tests; their original broad browser run is blocked. |
| MRF approval and local archive | Passed | Showcase UI approval creates real local archived copies and survives refresh. Core-flow commands cover the linked transition. |
| MRF AI import and input validation | Passed mocked/unit checks; live blocked | Existing extraction tests verify limits, malformed results, same-origin and signatures. Real provider accuracy/cost was not tested. |
| Quotation upload queue, supplier groups and worksheet | Passed in audit copies | Supplier-upload and worksheet suites complete; source preview, missing-file behavior, keyboard interactions and confirmation exclusions are exercised. |
| Large quotation editor and financial review | Passed in audit copies | 25 suppliers/100 lines, pagination, issue navigation, readonly records and saved/reloaded fields. Financial-review suite completes arithmetic/review controls. |
| Quotation extraction route | Failed | Cross-origin acceptance, forged MIME and malformed-body exceptions reproduced with a stubbed provider (AUD-01/02). |
| Quotation extraction-dialog and complete confirmation suites | Failed; remaining assertions blocked | Audit copies progress beyond the initial stock-step mismatch but still stop on reload/selector expectations. No passing claim for their full cancellation/reanalysis sequences. |
| Supplier comparison, split awards and PO creation | Passed for exercised cases | Original compare-allocate suite: 100 materials/five suppliers, quantities, bulk gap retention, atomic save, stale awards and explicit generation. Core command flow also creates/reviews orders. |
| PO review, supplier issuance, upfront proof, payment and separate clearance | Passed for exercised cases | Original full-disbursement and showcase suites; failed/retried archives and confirmation cancellation included. Date defaults fail a separate boundary probe. |
| Credit installments, unpaid delivery clearance, voids and Finance coordination | Passed | Original credit-terms suite, showcase and domain tests, with persistence and responsive controls. |
| Direct/warehouse delivery, forwarding limits and stock posting | Passed domain/command and selected browser checks | 77-command core walkthrough covers receipt/warehouse forwarding/posting; adapted material-row suite covers delivery inputs/dialogs. Full original delivery-document suite blocked by assignment fixture. |
| Cross-project transfer lifecycle | Passed command assertions; detailed browser journey blocked | Core walkthrough validates source release, dispatch, destination receipt/posting and Accounting evidence. Original transfer browser suite aborts in user setup; showcase retries a real local receipt archive. |
| Inventory filters and pooled balances | Passed | Original suggestions suite and domain tests cover search/scope/unit/stock filters and project reset. Accounting default action fails its independent probe (AUD-08). |
| Reports, totals and date boundaries | Failed | Rendering and role restrictions pass; Philippine midnight filter excludes an expected request (AUD-04). Financial values are checked against app rules, not a real company ledger. |
| Local documents, PDFs/XLSX, previews and downloads | Passed for sampled rendering/bytes; failed identity usability and source-link origin | Original showcase/document-gallery/suggestions suites pass. Project archive duplicates ambiguous MRF names (AUD-06). A real HTTP/XLSX check finds localhost links in a 127.0.0.1 download (AUD-14). |
| Network/error/retry/loading and cancellation | Passed for exercised suites; installation UX failed | Skeleton, full-disbursement, credit, gallery and worksheet scenarios pass. Temporary comparison-generation failure exposes workspace-clearing recovery (AUD-05). |
| Navigation, notifications, sidebar/drawer and themes | Passed for tested interactions; visibility usability failed | Original shell suite passes including short windows, keyboard labels and notification bounds. Restricted destinations remain offered to some roles (AUD-12). |
| Documentation and visible copy | Failed | Obsolete startup/reset instructions, missing setup reference and literal encoding artifacts (AUD-10/13). |

## Route and role review

The independent sweep recorded **77 main-route role visits**. “Viewed” means the page rendered for that role; it does not grant every mutation on the page. “Denied” is an observed access-unavailable screen and is expected for these restricted combinations. Sidebar visibility is a separate AUD-12 issue.

| Route | Site | PM | Procurement | Finance | Logistics | Accounting | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /dashboard | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /projects | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /requests | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /suppliers | Denied | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /purchase-orders | Denied | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /accounting | Denied | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /finance | Denied | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /deliveries | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /inventory | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed | Viewed |
| /reports | Denied | Viewed | Denied | Denied | Denied | Denied | Viewed |
| /admin | Denied | Denied | Denied | Denied | Denied | Denied | Viewed |

Additional routes were inspected primarily as Administrator, including expected missing-record and edit restrictions. The maintenance URL resolved to `/admin`, so it is recorded as an additional Administration visit rather than a separate route below. Working-role form interactions are documented in the module table and responsive matrix.

| Resolved route | Observed heading | Role |
| --- | --- | --- |
| /projects/showcase-project-1 | Pasig Community Health Center | Administrator |
| /requests/showcase-16c36027-438e-400c-a320-dcefaa3baafc-mrf-65 | PCH-MRF-0001 | Administrator |
| /requests/showcase-16c36027-438e-400c-a320-dcefaa3baafc-mrf-965/edit | Edit QOR-MRF-0006 | Administrator |
| /requests/showcase-16c36027-438e-400c-a320-dcefaa3baafc-mrf-65/quotes | Source requested materials | Administrator |
| /purchase-orders/showcase-16c36027-438e-400c-a320-dcefaa3baafc-po-382 | QOR-PO-0004 | Administrator |
| /purchase-orders/showcase-16c36027-438e-400c-a320-dcefaa3baafc-po-76/edit | Edit supplier purchase order | Administrator |
| /accounting/showcase-16c36027-438e-400c-a320-dcefaa3baafc-po-382 | Accounting record | Administrator |
| /finance/showcase-16c36027-438e-400c-a320-dcefaa3baafc-po-382 | Payment coordination | Administrator |
| /deliveries/showcase-16c36027-438e-400c-a320-dcefaa3baafc-batch-977 | PCH-DEL-0001 | Administrator |
| /inventory/showcase-project-1/mat-oxkn2z | Portland cement 40kg | Administrator |
| /stock-transfers/showcase-16c36027-438e-400c-a320-dcefaa3baafc-transfer-1188 | QOR-TRF-0001 | Administrator |
| /demo-files/local-16c36027-438e-400c-a320-dcefaa3baafc-387 | QOR-PO-0004.pdf | Administrator |
| /requests/new | Create MRF | Administrator |
| /deliveries/new | Delivery scheduling | Administrator |
| /requests/audit-missing | MRF not found | Administrator |
| /projects/audit-missing | Project not found | Administrator |
| /demo-files/audit-missing | Document unavailable | Administrator |

Root/legacy-link handling and route permissions have passing domain tests. A complete independent browser run of every legacy-link branch was **blocked** by the original broad suite's earlier failure. Framework 404 handling was build-checked; arbitrary unknown URL keyboard behavior was not separately exercised.

## Browser suites

Original suites: **9 passed / 16 failed**. These are suite counts, not individual assertion counts. Failed suites may contain earlier passing assertions.

| Suite | Result | Duration | Interpretation | Evidence |
| --- | --- | --- | --- | --- |
| showcase | Passed | 71.2 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/showcase.log) |
| shell-controls | Passed | 22.2 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/shell-controls.log) |
| register | Failed | 23.4 s | Missing expected action selector after its earlier table checks; complete suite aborts. | [Log](../../artifacts/app-audit/logs/register.log) |
| user-management | Failed | 31.6 s | Original helper omits required project code. Full audit copy passed after updating that input and the retired maintenance destination. | [Log](../../artifacts/app-audit/logs/user-management.log) |
| site-visibility | Passed | 28.1 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/site-visibility.log) |
| skeleton-loading | Passed | 31.4 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/skeleton-loading.log) |
| browser | Failed | 25.6 s | Obsolete hard-coded Site Personnel account revision stops the suite before later workflow assertions. | [Log](../../artifacts/app-audit/logs/browser.log) |
| quotation | Failed | 30.7 s | Old quotation field selectors; the current worksheet edits materials inline/in dialogs. | [Log](../../artifacts/app-audit/logs/quotation.log) |
| compare-allocate | Passed | 51.5 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/compare-allocate.log) |
| full-disbursement | Passed | 19.5 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/full-disbursement.log) |
| credit-terms | Passed | 24.8 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/credit-terms.log) |
| site-stock-transfers | Failed | 17.4 s | Queries a user row without selecting the Users tab/current assignment setup; the detailed browser journey aborts. | [Log](../../artifacts/app-audit/logs/site-stock-transfers.log) |
| delivery-documents | Failed | 38.2 s | Legacy fixture project IDs are not assigned to the populated Site Personnel account. | [Log](../../artifacts/app-audit/logs/delivery-documents.log) |
| document-gallery | Passed | 29.4 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/document-gallery.log) |
| quotation-editor | Failed | 22.3 s | Assumes review editor is the initial quotation step; audit copy explicitly opens review/reopens it after reload. | [Log](../../artifacts/app-audit/logs/quotation-editor.log) |
| quotation-worksheet | Failed | 34.1 s | Assumes source preview exists before opening the review step. Audit copy passed. | [Log](../../artifacts/app-audit/logs/quotation-worksheet.log) |
| supplier-upload | Failed | 10.8 s | Queries upload controls while the initial stock step is selected. Audit copy passed. | [Log](../../artifacts/app-audit/logs/supplier-upload.log) |
| quotation-financial-review | Failed | 10.2 s | Assumes initial/reloaded quotation step is review. Audit copy passed. | [Log](../../artifacts/app-audit/logs/quotation-financial-review.log) |
| quotation-extraction | Failed | 32.5 s | Initial stock step and later reload assumptions; audit copy still stops at an editor wait after reload. | [Log](../../artifacts/app-audit/logs/quotation-extraction.log) |
| quotation-confirmations | Failed | 21.6 s | Obsolete step/action selectors and retry wording; audit copy still stops on a later selector. | [Log](../../artifacts/app-audit/logs/quotation-confirmations.log) |
| suggestions | Passed | 16.7 s | All assertions reached by this suite passed. | [Log](../../artifacts/app-audit/logs/suggestions.log) |
| project-folder | Failed | 21.6 s | Original required project-code omission; audit copy reaches later validation controls then stops on another obsolete selector. | [Log](../../artifacts/app-audit/logs/project-folder.log) |
| document-numbering | Failed | 13.3 s | Later form selector no longer exists. | [Log](../../artifacts/app-audit/logs/document-numbering.log) |
| material-rows | Failed | 24.2 s | Stale session identity/revision and assignment fixtures; audit copy passed. | [Log](../../artifacts/app-audit/logs/material-rows.log) |
| qa-fixes | Failed | 32.5 s | Legacy Site Personnel session shape/revision redirects to sign-in during a later form check. | [Log](../../artifacts/app-audit/logs/qa-fixes.log) |

Audit-only copies: **6 passed / 3 failed** after the latest adaptations. Their success does not change the original-suite result. Import paths, explicit quotation step selection/reselection, project codes, labels/redirects and current fixture sessions/assignments are the only adaptations; product behavior was not patched.

| Audit copy | Result | Evidence |
| --- | --- | --- |
| quotation-editor | Passed | [Log](../../artifacts/app-audit/logs/adapted-quotation-editor.log) |
| quotation-worksheet | Passed | [Log](../../artifacts/app-audit/logs/adapted-quotation-worksheet.log) |
| supplier-upload | Passed | [Log](../../artifacts/app-audit/logs/adapted-supplier-upload.log) |
| quotation-financial-review | Passed | [Log](../../artifacts/app-audit/logs/adapted-quotation-financial-review.log) |
| quotation-extraction | Failed / remaining assertions blocked | [Log](../../artifacts/app-audit/logs/adapted-quotation-extraction.log) |
| quotation-confirmations | Failed / remaining assertions blocked | [Log](../../artifacts/app-audit/logs/adapted-quotation-confirmations.log) |
| user-management | Passed | [Log](../../artifacts/app-audit/logs/adapted-user-management.log) |
| project-folder | Failed / remaining assertions blocked | [Log](../../artifacts/app-audit/logs/adapted-project-folder.log) |
| material-rows | Passed | [Log](../../artifacts/app-audit/logs/adapted-material-rows.log) |

The connected in-memory walkthrough independently asserts 77 command transitions and 36 checkpoints. It verifies 20 upfront units received, five used, a fully settled two-installment credit order, ten stock units deducted from the source and ten posted at destination, and complete Accounting document review. [Probe summary](../../artifacts/app-audit/domain-probes.json). It is a command-level check, not 77 browser interactions.

## UI, accessibility and performance

- **Passed:** 22 page families × 6 widths × 2 themes = 264 rendering combinations. Widths: 320, 375, 414, 768, 1280 and 1440. Desktop matrix height 720, narrow matrix height 812. Seven role screenshots additionally use the desktop profile.
- **Passed:** zero detected page-root overflow cases, zero unnamed visible-control candidates under the helper's basic label algorithm, and zero uncaught page exceptions in the independent sweep.
- **Passed for sampled checks:** CSS viewport reflow equivalent to 200% zoom at 1280px; reduced-motion media emulation with animation reduced to 0.00001 seconds; project-dialog Escape and focus restoration; native modal and keyboard interactions in passing suites.
- **Passed for measured targets:** adapted quotation worksheet warning text has minimum 4.60:1 contrast. This does not establish all-screen text, focus or state contrast. Source tokens and focus styles were inspected; full contrast measurement remains **blocked/not comprehensively tested**.
- **Failed usability:** large mobile metric stack, Accounting's disabled selected action, ambiguous archive rows, repeated page titles, restricted navigation destinations and corrupted quotation copy; see findings.
- **Recorded, not automatically failed:** links below 24px in height. The evidence contains candidates; sufficient row/neighbor spacing and full-row actions require contextual judgment.
- Warmed-server sampled navigation: mean 384 ms, median 350 ms, p95 596 ms, range 293–877 ms. Includes deliberate settling waits and concurrent audit load; no network throttling, user performance target, cold-start or production capacity claim.
- Native browser-toolbar zoom, actual phone hardware, Safari/Firefox engines, screen-reader announcements and full keyboard traversals through every state are **blocked/not tested** in this Windows Edge audit.

## Server and integration coverage

| Surface | Outcome | Evidence / limitation |
| --- | --- | --- |
| MRF/PO document preview generation | Passed for exercised fixtures | Production startup, real local generated copies, PDF template/domain tests and gallery/preview suites. |
| Comparison XLSX/PDF generation | Passed generation; failed downloaded source-link origin | Fresh workspace makes actual files; showcase opens XLSX and renders local PDFs; bid/comparison tests validate frozen versions. Exact-origin check fails for 127.0.0.1 download links (AUD-14). |
| MRF extraction | Passed route/unit validation | Existing tests plus explicit foreign-Origin and forged-signature comparisons; upstream is stubbed. |
| Quotation extraction | Failed | [Direct handler probes](../../artifacts/app-audit/api-probes.json). Provider stub only; no live provider access. |
| Drive project/folder validation and creation | Passed exercised mocked cases; full suite blocked | Adapted user-management passes setup; original project-folder suite and remaining audit-copy selectors block additional cases. |
| Drive MRF/quotation/PO archive and upload chunks | Passed automated/mocked checks for exercised cases | Domain/upload routes and successful payment/quotation scenarios. No real company uploads or token-expiry tests. |
| Accounting/payment proof archives and downloads | Passed automated/mocked checks for exercised cases | Route/domain tests; full-disbursement/credit browser suites exercise retry, proof association and payment gates. |
| Delivery and transfer receipt/evidence routes | Passed automated/command checks; full browser sequences blocked | Existing route tests/core commands; detailed original suites fail earlier fixtures. Showcase verifies local transfer-receipt retry. |
| Deployment protection and real external services | Blocked / not exercised | No hosted target selected. No live Drive permission validation, OCR accuracy study, AI cost/rate-limit verification, company payment or supplier integration. |

Source route inventory (28 page adapters, 22 API handlers):

- `app/(workspace)/accounting/page.tsx`
- `app/(workspace)/accounting/[poId]/page.tsx`
- `app/(workspace)/admin/maintenance/page.tsx`
- `app/(workspace)/admin/page.tsx`
- `app/(workspace)/dashboard/page.tsx`
- `app/(workspace)/deliveries/new/page.tsx`
- `app/(workspace)/deliveries/page.tsx`
- `app/(workspace)/deliveries/[id]/page.tsx`
- `app/(workspace)/demo-files/[fileId]/page.tsx`
- `app/(workspace)/finance/page.tsx`
- `app/(workspace)/finance/[poId]/page.tsx`
- `app/(workspace)/inventory/page.tsx`
- `app/(workspace)/inventory/[siteId]/[materialId]/page.tsx`
- `app/(workspace)/projects/page.tsx`
- `app/(workspace)/projects/[siteId]/page.tsx`
- `app/(workspace)/purchase-orders/page.tsx`
- `app/(workspace)/purchase-orders/[id]/edit/page.tsx`
- `app/(workspace)/purchase-orders/[id]/page.tsx`
- `app/(workspace)/reports/page.tsx`
- `app/(workspace)/requests/new/page.tsx`
- `app/(workspace)/requests/page.tsx`
- `app/(workspace)/requests/[id]/edit/page.tsx`
- `app/(workspace)/requests/[id]/page.tsx`
- `app/(workspace)/requests/[id]/quotes/page.tsx`
- `app/(workspace)/stock-transfers/[id]/page.tsx`
- `app/(workspace)/suppliers/page.tsx`
- `app/page.tsx`
- `app/sign-in/page.tsx`

- `app/api/bid-comparisons/route.ts`
- `app/api/documents/preview/route.ts`
- `app/api/drive/accounting-documents/chunk/route.ts`
- `app/api/drive/accounting-documents/route.ts`
- `app/api/drive/archive/chunk/route.ts`
- `app/api/drive/archive/route.ts`
- `app/api/drive/bid-comparisons/chunk/route.ts`
- `app/api/drive/bid-comparisons/route.ts`
- `app/api/drive/delivery-receipts/route.ts`
- `app/api/drive/files/route.ts`
- `app/api/drive/payment-proof/chunk/route.ts`
- `app/api/drive/payment-proof/route.ts`
- `app/api/drive/projects/route.ts`
- `app/api/drive/purchase-orders/route.ts`
- `app/api/drive/quotes/chunk/route.ts`
- `app/api/drive/quotes/route.ts`
- `app/api/drive/transfer-evidence/chunk/route.ts`
- `app/api/drive/transfer-evidence/route.ts`
- `app/api/drive/transfer-receipts/route.ts`
- `app/api/drive/validate/route.ts`
- `app/api/quotes/extract/route.ts`
- `app/api/requests/extract/route.ts`

## Reproduction and completion

Start the built app on loopback port 3100. Reproduce original suite results using `node --experimental-strip-types scripts/<name>-smoke.mjs http://127.0.0.1:3100`. `run-suites.mjs` captures exit codes, timing and logs; it is an audit collector and does not return aggregate failure for an individual failed child suite. Read `verification-summary.json` for the authoritative results.

Run the independent sweep with `node --no-warnings --experimental-strip-types artifacts/app-audit/browser-audit.mjs`. It uses fresh profiles and blocks external integrations. Add `--resume` after an interrupted role sweep; `--resume --finish` reruns focused checks while preserving the earlier matrix. The initially written harness needed an Accounting label correction and a role correction before its focus check; those harness errors are not application findings. Earlier logs are retained.

Run `node --no-warnings --experimental-strip-types artifacts/app-audit/api-probes.mjs` for stubbed extraction probes and `domain-probes.mjs` for clock/document/command evidence. Both operate on synthetic data and restore temporary globals/environment state. `adapt-suites.mjs` rebuilds the clearly labelled audit copies from untouched original scripts.

The audit is complete as a review with explicit failed/blocked outcomes. It does **not** claim that all browser regressions pass or that the app is production-ready. Remaining blocked cases have identified fixture/selector or environment limits; recommended product corrections and original-suite repairs are separate follow-up work.
